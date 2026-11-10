"""Embedding providers. All return L2-normalised float32 vectors so that
inner product == cosine similarity in the FAISS index."""

from __future__ import annotations

import hashlib
import re
from typing import Protocol

import numpy as np

from .config import Settings

_TOKEN = re.compile(r"\w+", re.UNICODE)


class Embedder(Protocol):
    name: str
    dim: int

    def embed_documents(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...


def _normalise(mat: np.ndarray) -> np.ndarray:
    mat = np.asarray(mat, dtype="float32")
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


class HashEmbedder:
    """Deterministic bag-of-words hashing embedder.

    No model download, no PyTorch. Similarity reflects shared words, which is
    enough for tests, CI and very small deployments — not real semantics.
    """

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim
        self.name = f"hash-{dim}"

    def _vec(self, text: str) -> np.ndarray:
        vec = np.zeros(self.dim, dtype="float32")
        tokens = [t.lower() for t in _TOKEN.findall(text)]
        grams = tokens + [f"{a} {b}" for a, b in zip(tokens, tokens[1:], strict=False)]
        for i, gram in enumerate(grams):
            digest = hashlib.blake2b(gram.encode(), digest_size=8).digest()
            idx = int.from_bytes(digest[:4], "little") % self.dim
            sign = 1.0 if digest[4] & 1 else -1.0
            vec[idx] += sign * (1.0 if i < len(tokens) else 0.5)
        return vec

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype="float32")
        return _normalise(np.stack([self._vec(t) for t in texts]))

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]


class SentenceTransformerEmbedder:
    """Semantic embeddings through LangChain's HuggingFace integration."""

    def __init__(self, model_name: str) -> None:
        from langchain_huggingface import HuggingFaceEmbeddings  # heavy import

        self.name = model_name
        self._model = HuggingFaceEmbeddings(
            model_name=model_name,
            encode_kwargs={"normalize_embeddings": True},
        )
        self.dim = len(self._model.embed_query("dimension probe"))

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype="float32")
        return _normalise(np.array(self._model.embed_documents(texts)))

    def embed_query(self, text: str) -> np.ndarray:
        return _normalise(np.array([self._model.embed_query(text)]))[0]


def build_embedder(settings: Settings) -> Embedder:
    if settings.embedding_provider == "hash":
        return HashEmbedder()
    return SentenceTransformerEmbedder(settings.embedding_model)
