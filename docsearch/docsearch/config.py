"""Settings and on-disk locations. Everything lives under one data folder."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, fields
from pathlib import Path

APP_NAME = "DocSearch"


def default_home() -> Path:
    env = os.environ.get("DOCSEARCH_HOME")
    if env:
        return Path(env)
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / APP_NAME


@dataclass
class Settings:
    # Models. "hash" / "lexical" are built-in stand-ins used by the tests and as
    # a visible fallback when the real model files are not installed.
    embed_model: str = "BAAI/bge-small-en-v1.5"
    rerank_model: str = "Xenova/ms-marco-MiniLM-L-12-v2"
    llm_file: str = ""  # empty: use the first *.gguf found in the models folder
    llm_url: str = (
        "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/"
        "resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf"
    )
    # Optional small model that flags unsupported words in a generated answer
    # (TinyLettuce, MIT). Used only if the `lettucedetect` package is installed.
    checker_model: str = "KRLabsOrg/tinylettuce-ettin-17m-en-v1"
    checker_min_conf: float = 0.5
    llm_ctx: int = 4096
    llm_threads: int = 0  # 0: physical cores, capped at 6

    # OCR
    ocr_dpi: int = 200
    ocr_low_conf: float = 0.85  # below this a page/passage gets a warning
    min_text_chars: int = 40  # a PDF page with less text than this is OCR'd

    # Chunking
    chunk_words: int = 220
    chunk_min_words: int = 40

    # Retrieval
    top_k_lexical: int = 40
    top_k_dense: int = 40
    rerank_n: int = 24
    final_k: int = 5
    min_score: float = 0.30  # reranker score below this => "not found"
    min_coverage: float = 0.60  # same, when the lexical fallback reranker is used
    tail_ratio: float = 0.35  # drop passages scoring far below the best one
    dedup_similarity: float = 0.85  # passages more alike than this count as copies
    include_superseded: bool = False

    # Dates like 03/04/2023 are read as day/month/year unless this is "MDY".
    date_order: str = "DMY"

    @classmethod
    def load(cls, home: Path) -> "Settings":
        path = home / "settings.json"
        s = cls()
        if path.exists():
            try:
                data = json.loads(path.read_text("utf-8"))
            except (OSError, ValueError):
                data = {}
            known = {f.name: f.type for f in fields(cls)}
            for k, v in data.items():
                if k in known and isinstance(v, type(getattr(s, k))):
                    setattr(s, k, v)
        return s

    def save(self, home: Path) -> None:
        home.mkdir(parents=True, exist_ok=True)
        (home / "settings.json").write_text(json.dumps(asdict(self), indent=2), "utf-8")

    def update(self, data: dict) -> None:
        for f in fields(self):
            if f.name in data:
                cur = getattr(self, f.name)
                val = data[f.name]
                if isinstance(cur, bool):
                    val = bool(val)
                elif isinstance(cur, int):
                    val = int(val)
                elif isinstance(cur, float):
                    val = float(val)
                else:
                    val = str(val)
                setattr(self, f.name, val)


def models_dir(home: Path) -> Path:
    d = home / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d
