"""Ingestion: scan folders, extract/OCR pages, chunk, embed. Resumable.

Progress is committed page by page, so stopping the app in the middle of a
large scan loses at most the page in flight.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import traceback
from pathlib import Path

from . import extract as ex
from .chunking import chunk_pages
from .db import Database, pack_lines, unpack_lines
from .metadata import extract_metadata
from .textutil import squash
from .vectors import VectorStore


def file_hash(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class Ingestor:
    def __init__(self, db: Database, settings, models, home: Path):
        self.db, self.settings, self.models, self.home = db, settings, models, home
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._store: VectorStore | None = None
        self.progress = {
            "running": False, "phase": "idle", "file": "", "page": 0, "pages": 0,
            "docs_done": 0, "docs_total": 0, "pages_done": 0, "started": 0.0, "pages_per_min": 0.0,
            "last_error": "",
        }

    # ------------------------------------------------------------ vector store
    def store(self) -> VectorStore | None:
        emb = self.models.embedder
        if emb is None:
            return None
        if self._store is None or self._store.dim != emb.dim:
            self._store = VectorStore(self.home / "index", emb.dim)
            tag = f"{emb.name}:{emb.dim}"
            if self.db.get_meta("embed_model") != tag:
                # A different embedding model: old vectors are meaningless.
                self._store.reset()
                self.db.x("UPDATE chunks SET vec_row=NULL")
                self.db.set_meta("embed_model", tag)
        return self._store

    # ------------------------------------------------------------ scanning
    def scan(self) -> int:
        """Register new and changed files from every watched folder."""
        new = 0
        seen: set[str] = set()
        for row in self.db.q("SELECT path FROM folders"):
            root = Path(row["path"])
            if not root.is_dir():
                continue
            for path in sorted(root.rglob("*")):
                if not path.is_file() or path.name.startswith(("~$", ".")):
                    continue
                ext = path.suffix.lower()
                if ext not in ex.SUPPORTED and ext not in ex.UNSUPPORTED_OFFICE:
                    continue
                seen.add(str(path))
                st = path.stat()
                cur = self.db.one("SELECT id,size,mtime,state FROM documents WHERE path=?", (str(path),))
                if cur is None:
                    state = "pending" if ext in ex.SUPPORTED else "unsupported"
                    self.db.conn.execute("INSERT INTO documents(path,size,mtime,state) VALUES(?,?,?,?)",
                                         (str(path), st.st_size, st.st_mtime, state))
                    new += state == "pending"
                elif (cur["size"], cur["mtime"]) != (st.st_size, st.st_mtime) or cur["state"] == "missing":
                    self.db.clear_document(cur["id"])
                    self.db.conn.execute(
                        "UPDATE documents SET size=?,mtime=?,state=?,error=NULL,file_hash=NULL,text_hash=NULL WHERE id=?",
                        (st.st_size, st.st_mtime, "pending" if ext in ex.SUPPORTED else "unsupported", cur["id"]))
                    new += 1
            self.db.conn.commit()
        for row in self.db.q("SELECT id,path FROM documents WHERE state!='missing'"):
            if row["path"] not in seen and not Path(row["path"]).exists():
                self.db.clear_document(row["id"])
                self.db.x("UPDATE documents SET state='missing' WHERE id=?", (row["id"],))
        return new

    # ------------------------------------------------------------ control
    def start(self) -> bool:
        if self._thread and self._thread.is_alive():
            return False
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, name="ingest", daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        p = self.progress
        p.update(running=True, phase="scanning", started=time.time(), pages_done=0, docs_done=0, last_error="")
        try:
            self.scan()
            pending = self.db.q("SELECT id FROM documents WHERE state='pending' ORDER BY size")
            p.update(docs_total=len(pending), phase="reading")
            for row in pending:
                if self._stop.is_set():
                    break
                self.process(row["id"])
                p["docs_done"] += 1
            if not self._stop.is_set():
                p["phase"] = "indexing"
                self.embed_missing()
        except Exception:
            p["last_error"] = traceback.format_exc(limit=3)
        finally:
            p.update(running=False, phase="stopped" if self._stop.is_set() else "idle", file="")

    # ------------------------------------------------------------ one document
    def process(self, doc_id: int) -> None:
        doc = self.db.one("SELECT * FROM documents WHERE id=?", (doc_id,))
        path = Path(doc["path"])
        p = self.progress
        p.update(file=path.name, page=0, pages=0)
        try:
            fh = doc["file_hash"] or file_hash(path)
            dup = self.db.one("SELECT id FROM documents WHERE file_hash=? AND id!=? AND state='done'", (fh, doc_id))
            if dup:
                self.db.clear_document(doc_id)
                self.db.x("UPDATE documents SET file_hash=?,state='duplicate',duplicate_of=? WHERE id=?", (fh, dup["id"], doc_id))
                return
            self.db.x("UPDATE documents SET file_hash=? WHERE id=?", (fh, doc_id))

            done = {r["page_no"] for r in self.db.q("SELECT page_no FROM pages WHERE doc_id=?", (doc_id,))}
            p["pages"] = ex.page_count(path)
            p["page"] = len(done)
            for page in ex.extract(path, self.settings, done):
                self.db.x("INSERT OR REPLACE INTO pages(doc_id,page_no,source,conf,n_chars,lines) VALUES(?,?,?,?,?,?)",
                          (doc_id, page["page_no"], page["source"], page["conf"], page["n_chars"], pack_lines(page["lines"])))
                p["page"] += 1
                p["pages_done"] += 1
                mins = (time.time() - p["started"]) / 60
                p["pages_per_min"] = round(p["pages_done"] / mins, 1) if mins > 0.05 else 0.0
                if self._stop.is_set():
                    return  # stays 'pending'; resumes from the next page

            self.finish(doc_id, path)
        except Exception as exc:
            self.db.conn.rollback()
            self.db.x("UPDATE documents SET state='error',error=? WHERE id=?", (f"{type(exc).__name__}: {exc}"[:500], doc_id))
            p["last_error"] = f"{path.name}: {exc}"

    def load_pages(self, doc_id: int) -> list[dict]:
        return [
            {"page_no": r["page_no"], "source": r["source"], "conf": r["conf"], "lines": unpack_lines(r["lines"])}
            for r in self.db.q("SELECT * FROM pages WHERE doc_id=? ORDER BY page_no", (doc_id,))
        ]

    def finish(self, doc_id: int, path: Path) -> None:
        """Pages are stored; derive metadata and passages."""
        pages = self.load_pages(doc_id)
        all_text = "\n".join(ln[0] for pg in pages for ln in pg["lines"])
        th = hashlib.sha1(squash(all_text).encode()).hexdigest() if all_text.strip() else None
        if th:
            dup = self.db.one("SELECT id FROM documents WHERE text_hash=? AND id!=? AND state='done'", (th, doc_id))
            if dup:
                self.db.clear_document(doc_id)
                self.db.x("UPDATE documents SET text_hash=?,state='duplicate',duplicate_of=? WHERE id=?", (th, dup["id"], doc_id))
                return
        first = [ln[0] for pg in pages[:2] for ln in pg["lines"]]
        hint = next((ln[0] for pg in pages[:1] for ln in pg["lines"][:5] if len(ln) > 6 and ln[6] == 1), None)
        meta = extract_metadata(path, first, self.settings.date_order, title_hint=hint)
        chunks = chunk_pages(pages, meta["title"], self.settings.chunk_words, self.settings.chunk_min_words)
        ocr_pages = [pg for pg in pages if pg["source"] == "ocr"]
        mean_conf = round(sum(pg["conf"] for pg in ocr_pages) / len(ocr_pages), 3) if ocr_pages else 1.0

        c = self.db.conn
        c.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
        for i, ch in enumerate(chunks):
            c.execute(
                "INSERT INTO chunks(doc_id,ord,heading,text,page_start,page_end,spans,min_conf,ocr) VALUES(?,?,?,?,?,?,?,?,?)",
                (doc_id, i, ch.heading, ch.text, ch.lines[0][0], ch.lines[-1][0], json.dumps(ch.spans()),
                 round(min(ln[3] for ln in ch.lines), 3), int(ch.ocr)))
        c.execute(
            "UPDATE documents SET state='done',error=NULL,text_hash=?,title=?,doc_type=?,doc_number=?,doc_number_norm=?,"
            "issue_date=?,effective_date=?,supersedes=?,n_pages=?,ocr_pages=?,mean_conf=? WHERE id=?",
            (th, meta["title"], meta["doc_type"], meta["doc_number"], meta["doc_number_norm"], meta["issue_date"],
             meta["effective_date"], json.dumps(meta["supersedes"]), len(pages), len(ocr_pages), mean_conf, doc_id))
        c.commit()
        self.resolve_supersession(doc_id)

    # ------------------------------------------------------------ supersession
    def resolve_supersession(self, doc_id: int) -> None:
        """Link this document with the ones it replaces or is replaced by.

        Only exact document-number matches count, a document set by hand is
        never changed, and an older document can never supersede a newer one.
        """
        me = self.db.one("SELECT * FROM documents WHERE id=?", (doc_id,))

        def mark(old, new) -> None:
            if old["status_source"] == "manual" or old["id"] == new["id"]:
                return
            if old["issue_date"] and new["issue_date"] and new["issue_date"] < old["issue_date"]:
                return
            self.db.x("UPDATE documents SET status='superseded',superseded_by=? WHERE id=?", (new["id"], old["id"]))

        for ref in json.loads(me["supersedes"] or "[]"):
            for old in self.db.q("SELECT * FROM documents WHERE doc_number_norm=? AND state='done'", (ref,)):
                mark(old, me)
        if me["doc_number_norm"]:
            like = f'%"{me["doc_number_norm"]}"%'
            for new in self.db.q("SELECT * FROM documents WHERE supersedes LIKE ? AND state='done'", (like,)):
                mark(me, new)

    # ------------------------------------------------------------ embeddings
    def embed_missing(self, batch: int = 32) -> int:
        store = self.store()
        emb = self.models.embedder
        if store is None or emb is None:
            return 0
        total = 0
        while not self._stop.is_set():
            rows = self.db.q("SELECT id,heading,text FROM chunks WHERE vec_row IS NULL ORDER BY id LIMIT ?", (batch,))
            if not rows:
                break
            vecs = emb.embed_docs([f"{r['heading']}\n{r['text']}" for r in rows])
            start = store.append(vecs)
            self.db.conn.executemany("UPDATE chunks SET vec_row=? WHERE id=?",
                                     [(start + i, r["id"]) for i, r in enumerate(rows)])
            self.db.conn.commit()
            total += len(rows)
            self.progress["file"] = f"{total} passages indexed"
        return total
