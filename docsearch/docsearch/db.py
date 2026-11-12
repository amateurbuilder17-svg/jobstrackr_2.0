"""SQLite storage: documents, pages (with line boxes), chunks and the keyword index."""
from __future__ import annotations

import json
import sqlite3
import threading
import zlib
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    size INTEGER, mtime REAL,
    file_hash TEXT, text_hash TEXT,
    state TEXT NOT NULL DEFAULT 'pending',   -- pending|done|error|duplicate|unsupported|missing
    error TEXT, duplicate_of INTEGER,
    title TEXT, doc_type TEXT, doc_number TEXT, doc_number_norm TEXT,
    issue_date TEXT, effective_date TEXT,
    supersedes TEXT,                          -- JSON list of normalised references
    status TEXT NOT NULL DEFAULT 'active',    -- active|superseded
    status_source TEXT NOT NULL DEFAULT 'auto',
    superseded_by INTEGER,
    n_pages INTEGER DEFAULT 0, ocr_pages INTEGER DEFAULT 0, mean_conf REAL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS documents_state ON documents(state);
CREATE INDEX IF NOT EXISTS documents_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS documents_thash ON documents(text_hash);
CREATE INDEX IF NOT EXISTS documents_num ON documents(doc_number_norm);
CREATE TABLE IF NOT EXISTS pages (
    doc_id INTEGER NOT NULL, page_no INTEGER NOT NULL,
    source TEXT NOT NULL,                     -- text|ocr
    conf REAL, n_chars INTEGER,
    lines BLOB NOT NULL,                      -- zlib(JSON [[text,x0,y0,x1,y1,conf,hlevel],...])
    PRIMARY KEY (doc_id, page_no)
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL, ord INTEGER NOT NULL,
    heading TEXT, text TEXT NOT NULL,
    page_start INTEGER, page_end INTEGER,
    spans TEXT,                               -- JSON [[page, first_line, last_line],...]
    min_conf REAL, ocr INTEGER DEFAULT 0,
    vec_row INTEGER
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS chunks_vec ON chunks(vec_row);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text, heading, content='chunks', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.id, new.text, new.heading);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
END;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


class Database:
    """One connection per thread; WAL so the UI can read while ingestion writes."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    @property
    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=60)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
            self._local.conn = c
        return c

    def q(self, sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
        return self.conn.execute(sql, args).fetchone()

    def x(self, sql: str, args: tuple | list = ()) -> sqlite3.Cursor:
        cur = self.conn.execute(sql, args)
        self.conn.commit()
        return cur

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        row = self.one("SELECT value FROM meta WHERE key=?", (key,))
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        self.x("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def clear_document(self, doc_id: int, keep_pages: bool = False) -> None:
        self.conn.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
        if not keep_pages:
            self.conn.execute("DELETE FROM pages WHERE doc_id=?", (doc_id,))
        self.conn.commit()


def pack_lines(lines: list[list]) -> bytes:
    return zlib.compress(json.dumps(lines, separators=(",", ":")).encode("utf-8"))


def unpack_lines(blob: bytes) -> list[list]:
    return json.loads(zlib.decompress(blob).decode("utf-8"))
