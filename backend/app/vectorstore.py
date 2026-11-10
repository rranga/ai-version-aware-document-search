"""FAISS index keyed by chunk id.

Uses ``IndexIDMap2(IndexFlatIP)`` so vectors carry the SQLite chunk id and
search can be restricted to an exact set of ids (the chunks belonging to the
requested document versions) with ``IDSelectorBatch`` — no over-fetching and
post-filtering.
"""

from __future__ import annotations

import os
from pathlib import Path

import faiss
import numpy as np


class VectorIndex:
    def __init__(self, path: Path, dim: int) -> None:
        self.path = path
        self.dim = dim
        self.index = self._load() or self._empty()

    def _empty(self) -> faiss.IndexIDMap2:
        return faiss.IndexIDMap2(faiss.IndexFlatIP(self.dim))

    def _load(self) -> faiss.IndexIDMap2 | None:
        if not self.path.exists():
            return None
        try:
            index = faiss.read_index(str(self.path))
        except RuntimeError:
            return None
        if index.d != self.dim:
            return None
        return index

    def reset(self) -> None:
        self.index = self._empty()

    @property
    def size(self) -> int:
        return int(self.index.ntotal)

    def add(self, ids: list[int], vectors: np.ndarray) -> None:
        if not ids:
            return
        self.index.add_with_ids(
            np.ascontiguousarray(vectors, dtype="float32"),
            np.asarray(ids, dtype="int64"),
        )

    def remove(self, ids: list[int]) -> None:
        if ids:
            self.index.remove_ids(np.asarray(ids, dtype="int64"))

    def search(self, query: np.ndarray, k: int, allowed_ids: list[int] | None = None) -> list[tuple[int, float]]:
        if self.size == 0 or k <= 0:
            return []
        params = None
        if allowed_ids is not None:
            if not allowed_ids:
                return []
            selector = faiss.IDSelectorBatch(np.asarray(allowed_ids, dtype="int64"))
            params = faiss.SearchParameters(sel=selector)
            k = min(k, len(allowed_ids))
        k = min(k, self.size)
        q = np.ascontiguousarray(query.reshape(1, -1), dtype="float32")
        scores, ids = self.index.search(q, k, params=params)
        return [(int(i), float(s)) for i, s in zip(ids[0], scores[0], strict=False) if i != -1]

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        faiss.write_index(self.index, str(tmp))
        os.replace(tmp, self.path)
