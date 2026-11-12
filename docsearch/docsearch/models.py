"""Model back-ends: embedder, reranker and answer model.

Real models are loaded from the local models folder only; nothing is fetched
from the network unless download_models() is called explicitly.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
import urllib.request
from pathlib import Path

import numpy as np

from .textutil import content_terms, words

_BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


class ModelUnavailable(RuntimeError):
    pass


# ---------------------------------------------------------------- embedders

class HashEmbedder:
    """Bag-of-words hashing. No model file needed; used by tests only."""

    name = "hash"
    dim = 384

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        toks = content_terms(text)
        for tok in toks + [a + "_" + b for a, b in zip(toks, toks[1:])]:
            h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "little")
            v[h % self.dim] += 1.0 if (h >> 32) & 1 else -1.0
        n = float(np.linalg.norm(v))
        return v / n if n else v

    def embed_docs(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._vec(t) for t in texts]) if texts else np.zeros((0, self.dim), np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return self._vec(text)


class FastEmbedEmbedder:
    def __init__(self, model_name: str, cache_dir: Path, local_only: bool = True):
        from fastembed import TextEmbedding

        self.name = model_name
        try:
            self.model = TextEmbedding(model_name, cache_dir=str(cache_dir), local_files_only=local_only)
        except Exception as exc:  # missing files, unknown model, no network
            raise ModelUnavailable(f"embedding model '{model_name}' is not installed: {exc}") from exc
        self.dim = len(next(iter(self.model.embed(["dimension probe"]))))
        self.prefix = _BGE_QUERY_PREFIX if "bge" in model_name.lower() else ""

    @staticmethod
    def _norm(a: np.ndarray) -> np.ndarray:
        n = np.linalg.norm(a, axis=-1, keepdims=True)
        return (a / np.where(n == 0, 1, n)).astype(np.float32)

    def embed_docs(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        return self._norm(np.stack(list(self.model.embed(texts, batch_size=16))))

    def embed_query(self, text: str) -> np.ndarray:
        return self._norm(np.stack(list(self.model.embed([self.prefix + text]))))[0]


# ---------------------------------------------------------------- rerankers

class LexicalReranker:
    """Share of the question's key terms found in the passage. Fallback only."""

    name = "lexical"
    is_fallback = True

    def score(self, query: str, passages: list[str]) -> list[float]:
        q = set(content_terms(query))
        if not q:
            return [0.0] * len(passages)
        out = []
        for p in passages:
            terms = set(content_terms(p))
            out.append(len(q & terms) / len(q))
        return out


class FastEmbedReranker:
    is_fallback = False

    def __init__(self, model_name: str, cache_dir: Path, local_only: bool = True):
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        self.name = model_name
        try:
            self.model = TextCrossEncoder(model_name=model_name, cache_dir=str(cache_dir), local_files_only=local_only)
        except Exception as exc:
            raise ModelUnavailable(f"reranker '{model_name}' is not installed: {exc}") from exc

    def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        raw = list(self.model.rerank(query, passages, batch_size=8))
        return [1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, float(s))))) for s in raw]


# ---------------------------------------------------------------- answer model

class LlamaCppGenerator:
    def __init__(self, model_path: Path, n_ctx: int = 4096, n_threads: int = 0):
        try:
            from llama_cpp import Llama
        except Exception as exc:
            raise ModelUnavailable(f"llama-cpp-python is not installed: {exc}") from exc
        if not n_threads:
            n_threads = max(1, min(6, (os.cpu_count() or 2) // 2 or 1))
        self.name = model_path.name
        self.lock = threading.Lock()
        try:
            self.llm = Llama(model_path=str(model_path), n_ctx=n_ctx, n_threads=n_threads, verbose=False)
        except Exception as exc:
            raise ModelUnavailable(f"could not load {model_path.name}: {exc}") from exc

    def complete_json(self, system: str, user: str, schema: dict, max_tokens: int = 500) -> dict:
        with self.lock:
            out = self.llm.create_chat_completion(
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.0, max_tokens=max_tokens,
                response_format={"type": "json_object", "schema": schema},
            )
        return json.loads(out["choices"][0]["message"]["content"])


class LettuceChecker:
    """TinyLettuce: a small encoder trained to mark answer words the context does not support."""

    def __init__(self, model_dir: Path, min_conf: float = 0.5):
        if not (model_dir / "config.json").exists():
            raise ModelUnavailable("answer checker model is not downloaded")
        try:
            from lettucedetect.models.inference import HallucinationDetector
        except Exception as exc:
            raise ModelUnavailable(f"the lettucedetect package is not installed: {exc}") from exc
        self.name = model_dir.name
        self.min_conf = min_conf
        self.lock = threading.Lock()
        try:
            self.detector = HallucinationDetector(method="transformer", model_path=str(model_dir))
        except Exception as exc:
            raise ModelUnavailable(f"could not load the answer checker: {exc}") from exc

    def unsupported(self, passage: str, question: str, statement: str) -> list[str]:
        """Parts of the statement the model judges unsupported by the passage."""
        with self.lock:
            spans = self.detector.predict(context=[passage], question=question, answer=statement,
                                          output_format="spans", min_confidence=self.min_conf)
        return [str(sp.get("text", "")) for sp in spans if str(sp.get("text", "")).strip()]


def checker_dir(settings, models: Path) -> Path:
    return models / "checker" / settings.checker_model.replace("/", "--")


def find_llm_file(settings, models: Path) -> Path | None:
    if settings.llm_file:
        p = Path(settings.llm_file)
        p = p if p.is_absolute() else models / p
        return p if p.exists() else None
    ggufs = sorted(models.glob("*.gguf"))
    return ggufs[0] if ggufs else None


# ---------------------------------------------------------------- registry

class Models:
    """Lazily loads each model once and remembers why one is missing."""

    def __init__(self, settings, models_path: Path):
        self.settings = settings
        self.path = models_path
        self.lock = threading.Lock()
        self._cache: dict[str, object] = {}
        self.problems: dict[str, str] = {}
        self.download = {"running": False, "step": "", "done": 0, "total": 0, "error": ""}

    def reset(self) -> None:
        with self.lock:
            self._cache.clear()
            self.problems.clear()

    def _get(self, key: str, loader):
        with self.lock:
            if key not in self._cache:
                try:
                    self._cache[key] = loader()
                    self.problems.pop(key, None)
                except ModelUnavailable as exc:
                    self._cache[key] = None
                    self.problems[key] = str(exc)
            return self._cache[key]

    @property
    def embedder(self):
        s = self.settings
        return self._get("embedder", lambda: HashEmbedder() if s.embed_model == "hash"
                         else FastEmbedEmbedder(s.embed_model, self.path))

    @property
    def reranker(self):
        s = self.settings

        def load():
            if s.rerank_model == "lexical":
                return LexicalReranker()
            try:
                return FastEmbedReranker(s.rerank_model, self.path)
            except ModelUnavailable as exc:
                self.problems["reranker"] = str(exc)
                return LexicalReranker()
        return self._get("reranker_", load)

    @property
    def generator(self):
        def load():
            f = find_llm_file(self.settings, self.path)
            if f is None:
                raise ModelUnavailable("no answer model (.gguf) in the models folder")
            return LlamaCppGenerator(f, self.settings.llm_ctx, self.settings.llm_threads)
        return self._get("generator", load)

    @property
    def checker(self):
        if not self.settings.checker_model:
            return None
        return self._get("checker", lambda: LettuceChecker(checker_dir(self.settings, self.path),
                                                           self.settings.checker_min_conf))

    def status(self) -> dict:
        emb, rer, gen, chk = self.embedder, self.reranker, self.generator, self.checker
        return {
            "checker": {"ok": chk is not None, "name": getattr(chk, "name", self.settings.checker_model),
                        "problem": self.problems.get("checker", "")},
            "embedder": {"ok": emb is not None, "name": getattr(emb, "name", self.settings.embed_model),
                         "problem": self.problems.get("embedder", "")},
            "reranker": {"ok": not getattr(rer, "is_fallback", True) or self.settings.rerank_model == "lexical",
                         "name": getattr(rer, "name", ""), "problem": self.problems.get("reranker", "")},
            "generator": {"ok": gen is not None, "name": getattr(gen, "name", ""),
                          "problem": self.problems.get("generator", "")},
            "download": dict(self.download),
        }

    # -- explicit, user-triggered download (the only code path that uses the network)
    def download_models(self, with_llm: bool = True) -> None:
        d = self.download
        if d["running"]:
            return
        d.update(running=True, step="embedding model", done=0, total=0, error="")
        try:
            s = self.settings
            if s.embed_model != "hash":
                FastEmbedEmbedder(s.embed_model, self.path, local_only=False)
            d["step"] = "reranker"
            if s.rerank_model != "lexical":
                FastEmbedReranker(s.rerank_model, self.path, local_only=False)
            if s.checker_model:
                d["step"] = "answer checker"
                from huggingface_hub import snapshot_download

                snapshot_download(s.checker_model, local_dir=str(checker_dir(s, self.path)),
                                  allow_patterns=["*.json", "*.txt", "*.safetensors"])
            if with_llm and find_llm_file(s, self.path) is None and s.llm_url:
                d["step"] = "answer model"
                name = s.llm_url.rsplit("/", 1)[-1]
                tmp = self.path / (name + ".part")
                req = urllib.request.Request(s.llm_url, headers={"User-Agent": "docsearch"})
                with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as fh:
                    d["total"] = int(resp.headers.get("Content-Length") or 0)
                    while True:
                        block = resp.read(1 << 20)
                        if not block:
                            break
                        fh.write(block)
                        d["done"] += len(block)
                tmp.replace(self.path / name)
            d["step"] = "finished"
        except Exception as exc:
            d["error"] = f"{d['step']}: {exc}"
        finally:
            d["running"] = False
            self.reset()
