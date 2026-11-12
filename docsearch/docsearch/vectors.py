"""A small on-disk vector store.

Two flat files, appended to in lock-step:
  vectors.f16  float16 embeddings, memory-mapped, used for exact scoring
  vectors.bin  1 bit per dimension, held in RAM, used for a fast first pass

Up to EXACT_LIMIT rows the search is exact. Beyond that the 1-bit copy picks
candidates by Hamming distance and the float16 rows rescore them, which keeps
a million passages searchable in about 50 MB of RAM.
"""
from __future__ import annotations

import threading
from pathlib import Path

import numpy as np

EXACT_LIMIT = 150_000


class VectorStore:
    def __init__(self, directory: Path, dim: int):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.dim = dim
        self.nbytes = (dim + 7) // 8
        self.f16_path = self.dir / "vectors.f16"
        self.bin_path = self.dir / "vectors.bin"
        self.lock = threading.Lock()
        n16 = self.f16_path.stat().st_size // (dim * 2) if self.f16_path.exists() else 0
        nb = self.bin_path.stat().st_size // self.nbytes if self.bin_path.exists() else 0
        self.count = min(n16, nb)
        # A crash between the two appends can leave one file longer; trim both.
        for path, width in ((self.f16_path, dim * 2), (self.bin_path, self.nbytes)):
            if path.exists() and path.stat().st_size != self.count * width:
                with open(path, "r+b") as fh:
                    fh.truncate(self.count * width)
        self._bits = (
            np.fromfile(self.bin_path, dtype=np.uint8).reshape(self.count, self.nbytes)
            if self.count else np.zeros((0, self.nbytes), dtype=np.uint8)
        )
        self._pending: list[np.ndarray] = []

    def append(self, vecs: np.ndarray) -> int:
        """Append normalised float vectors; returns the row index of the first."""
        vecs = np.asarray(vecs, dtype=np.float32).reshape(-1, self.dim)
        bits = np.packbits(vecs > 0, axis=1)
        with self.lock:
            start = self.count
            with open(self.f16_path, "ab") as fh:
                fh.write(vecs.astype(np.float16).tobytes())
            with open(self.bin_path, "ab") as fh:
                fh.write(bits.tobytes())
            self._pending.append(bits)
            self.count += len(vecs)
        return start

    def _all_bits(self) -> np.ndarray:
        if self._pending:
            self._bits = np.concatenate([self._bits, *self._pending])
            self._pending = []
        return self._bits

    def search(self, query: np.ndarray, k: int) -> list[tuple[int, float]]:
        with self.lock:
            n = self.count
            if n == 0:
                return []
            q = np.asarray(query, dtype=np.float32).reshape(self.dim)
            mm = np.memmap(self.f16_path, dtype=np.float16, mode="r", shape=(n, self.dim))
            if n <= EXACT_LIMIT:
                scores = np.empty(n, dtype=np.float32)
                for s in range(0, n, 50_000):
                    scores[s:s + 50_000] = mm[s:s + 50_000].astype(np.float32) @ q
                rows = np.arange(n)
            else:
                qbits = np.packbits(q > 0)
                dist = np.bitwise_count(np.bitwise_xor(self._all_bits(), qbits)).sum(axis=1, dtype=np.uint16)
                m = min(n, max(k * 25, 1000))
                rows = np.argpartition(dist, m - 1)[:m]
                rows.sort()
                scores = mm[rows].astype(np.float32) @ q
            k = min(k, len(rows))
            top = np.argpartition(-scores, k - 1)[:k]
            top = top[np.argsort(-scores[top])]
            return [(int(rows[i]), float(scores[i])) for i in top]

    def reset(self) -> None:
        with self.lock:
            for p in (self.f16_path, self.bin_path):
                if p.exists():
                    p.unlink()
            self.count = 0
            self._bits = np.zeros((0, self.nbytes), dtype=np.uint8)
            self._pending = []
