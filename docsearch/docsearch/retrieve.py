"""Hybrid retrieval: keyword + vector search, fused, then reranked."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .textutil import STOPWORDS, norm_ref, words

_CODE = re.compile(r"[A-Za-z0-9]+(?:[/\-_.][A-Za-z0-9]+)+")
_COLS = ("c.id, c.doc_id, c.ord, c.heading, c.text, c.page_start, c.page_end, c.spans, c.min_conf, c.ocr, "
         "d.path, d.title, d.doc_type, d.doc_number, d.issue_date, d.effective_date, d.status, d.superseded_by")


@dataclass
class Hit:
    chunk_id: int
    doc_id: int
    heading: str
    text: str
    page_start: int
    page_end: int
    spans: list
    min_conf: float
    ocr: bool
    path: str
    title: str
    doc_type: str
    doc_number: str | None
    issue_date: str | None
    effective_date: str | None
    status: str
    superseded_by: int | None
    score: float = 0.0

    @classmethod
    def from_row(cls, r) -> "Hit":
        return cls(r["id"], r["doc_id"], r["heading"] or "", r["text"], r["page_start"], r["page_end"],
                   json.loads(r["spans"] or "[]"), r["min_conf"] if r["min_conf"] is not None else 1.0, bool(r["ocr"]),
                   r["path"], r["title"] or "", r["doc_type"] or "Document", r["doc_number"], r["issue_date"],
                   r["effective_date"], r["status"], r["superseded_by"])


def fts_query(question: str) -> str:
    terms = []
    for w in words(question):
        if w not in STOPWORDS and (len(w) > 1 or w.isdigit()) and w not in terms:
            terms.append(w)
    parts = ['"%s"' % t for t in terms]
    # A reference code such as HR/2023/045 is also searched as an exact phrase.
    for m in _CODE.finditer(question):
        if any(c.isdigit() for c in m.group()):
            parts.append('"%s"' % " ".join(words(m.group())))
    return " OR ".join(parts)


class Retriever:
    def __init__(self, db, settings, models, store_getter):
        self.db, self.settings, self.models, self.store_getter = db, settings, models, store_getter

    def _status_sql(self, include_superseded: bool) -> str:
        return "d.state='done'" + ("" if include_superseded else " AND d.status='active'")

    def lexical(self, question: str, k: int, include_superseded: bool) -> list[Hit]:
        q = fts_query(question)
        if not q:
            return []
        rows = self.db.q(
            f"SELECT {_COLS} FROM chunks_fts f JOIN chunks c ON c.id=f.rowid JOIN documents d ON d.id=c.doc_id "
            f"WHERE chunks_fts MATCH ? AND {self._status_sql(include_superseded)} "
            "ORDER BY bm25(chunks_fts, 1.0, 0.6) LIMIT ?", (q, k))
        return [Hit.from_row(r) for r in rows]

    def dense(self, question: str, k: int, include_superseded: bool) -> list[Hit]:
        emb, store = self.models.embedder, self.store_getter()
        if emb is None or store is None or store.count == 0:
            return []
        found = store.search(emb.embed_query(question), k * 3)
        if not found:
            return []
        order = {row: i for i, (row, _) in enumerate(found)}
        marks = ",".join("?" * len(order))
        rows = self.db.q(
            f"SELECT {_COLS}, c.vec_row FROM chunks c JOIN documents d ON d.id=c.doc_id "
            f"WHERE c.vec_row IN ({marks}) AND {self._status_sql(include_superseded)}", list(order))
        rows.sort(key=lambda r: order[r["vec_row"]])
        return [Hit.from_row(r) for r in rows[:k]]

    def referenced_docs(self, question: str) -> set[int]:
        ids: set[int] = set()
        for m in _CODE.finditer(question):
            ref = norm_ref(m.group())
            if len(ref) >= 4 and any(c.isdigit() for c in ref):
                ids.update(r["id"] for r in self.db.q("SELECT id FROM documents WHERE doc_number_norm=?", (ref,)))
        return ids

    def search(self, question: str, include_superseded: bool | None = None) -> list[Hit]:
        """Candidates sorted by reranker score, best first."""
        s = self.settings
        inc = s.include_superseded if include_superseded is None else include_superseded
        named = self.referenced_docs(question)
        if named:
            inc = True  # the user asked about a specific document by number
        fused: dict[int, float] = {}
        hits: dict[int, Hit] = {}
        for ranked in (self.lexical(question, s.top_k_lexical, inc), self.dense(question, s.top_k_dense, inc)):
            for rank, h in enumerate(ranked):
                hits[h.chunk_id] = h
                fused[h.chunk_id] = fused.get(h.chunk_id, 0.0) + 1.0 / (60 + rank)
        for cid, h in hits.items():
            if h.doc_id in named:
                fused[cid] += 1.0 / 60
        top = sorted(hits.values(), key=lambda h: -fused[h.chunk_id])[: s.rerank_n]
        if not top:
            return []
        scores = self.models.reranker.score(question, [f"{h.heading}\n{h.text}" for h in top])
        for h, sc in zip(top, scores):
            h.score = float(sc)
        top.sort(key=lambda h: -h.score)
        return self.drop_copies(top)

    def drop_copies(self, ranked: list[Hit]) -> list[Hit]:
        """Remove passages that are near-copies of a better-ranked one.

        The same circular is often filed (and scanned) several times; without
        this the top results can be five copies of one paragraph.
        """
        limit = self.settings.dedup_similarity
        kept: list[tuple[Hit, set[str]]] = []
        for h in ranked:
            toks = set(words(h.text))
            if any(toks and len(toks & other) / len(toks | other) >= limit for _, other in kept):
                continue
            kept.append((h, toks))
        return [h for h, _ in kept]

    def threshold(self) -> float:
        fallback = getattr(self.models.reranker, "is_fallback", False)
        return self.settings.min_coverage if fallback else self.settings.min_score
