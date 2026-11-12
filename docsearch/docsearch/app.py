"""Wires the pieces together around one data folder."""
from __future__ import annotations

from pathlib import Path

from .answer import Answerer
from .config import Settings, default_home, models_dir
from .db import Database
from .ingest import Ingestor
from .models import Models
from .retrieve import Retriever


class App:
    def __init__(self, home: Path | None = None, settings: Settings | None = None):
        self.home = Path(home) if home else default_home()
        self.home.mkdir(parents=True, exist_ok=True)
        self.settings = settings or Settings.load(self.home)
        self.db = Database(self.home / "docsearch.db")
        self.models = Models(self.settings, models_dir(self.home))
        self.ingestor = Ingestor(self.db, self.settings, self.models, self.home)
        self.retriever = Retriever(self.db, self.settings, self.models, self.ingestor.store)
        self.answerer = Answerer(self.retriever, self.settings, self.models)

    def add_folder(self, path: str) -> None:
        p = Path(path).expanduser().resolve()
        if not p.is_dir():
            raise ValueError(f"not a folder: {path}")
        self.db.x("INSERT OR IGNORE INTO folders(path) VALUES(?)", (str(p),))

    def counts(self) -> dict:
        by_state = {r["state"]: r["n"] for r in self.db.q("SELECT state, COUNT(*) n FROM documents GROUP BY state")}
        row = self.db.one("SELECT COUNT(*) n, SUM(vec_row IS NOT NULL) v FROM chunks")
        pages = self.db.one("SELECT COUNT(*) n, SUM(source='ocr') o FROM pages")
        low = self.db.one("SELECT COUNT(*) n FROM pages WHERE source='ocr' AND conf < ?", (self.settings.ocr_low_conf,))
        sup = self.db.one("SELECT COUNT(*) n FROM documents WHERE state='done' AND status='superseded'")
        return {"documents": by_state, "passages": row["n"], "embedded": row["v"] or 0, "pages": pages["n"],
                "ocr_pages": pages["o"] or 0, "low_conf_pages": low["n"], "superseded": sup["n"]}
