import os
import pickle
import hashlib
import json
import streamlit as st
from typing import Tuple, Optional
from langchain_community.vectorstores import FAISS

CACHE_DIR = "./cache"
os.makedirs(CACHE_DIR, exist_ok=True)


def _sanitize_name(name: str) -> str:
    """Replace path separators so names never create nested dirs."""
    return name.replace("/", "_").replace("\\", "_")


def get_cache_path(name: str) -> str:
    """Return cache file path for a given (unsanitized) name."""
    safe = _sanitize_name(name)
    return os.path.join(CACHE_DIR, f"{safe}.pkl")


def get_metadata_path(name: str) -> str:
    safe = _sanitize_name(name)
    return os.path.join(CACHE_DIR, f"{safe}_meta.json")


def compute_doc_hash(file_path: str) -> str:
    """Compute hash of file content for change detection."""
    with open(file_path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def get_all_doc_hashes(docs_dir: str) -> dict:
    """Generate a dict of {relative_path: hash} for all docs in docs_dir."""
    hashes = {}
    for root, _, files in os.walk(docs_dir):
        for file in files:
            path = os.path.join(root, file)
            rel = os.path.relpath(path, docs_dir)
            hashes[rel] = compute_doc_hash(path)
    return hashes


def load_cached_vectorstore(model_name: str) -> Tuple[Optional[FAISS], Optional[dict]]:
    """Load FAISS vectorstore and metadata if present and readable."""
    vs_path = get_cache_path(f"vectorstore_{model_name}")
    meta_path = get_metadata_path(f"vectorstore_{model_name}")

    if os.path.exists(vs_path) and os.path.exists(meta_path):
        try:
            with open(vs_path, "rb") as f:
                vectorstore = pickle.load(f)
            with open(meta_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
            return vectorstore, metadata
        except Exception as e:
            st.warning(f"⚠️ Cache corrupted or unreadable. Rebuilding index... ({e})")
            # attempt to remove corrupted cache files so future runs don't keep failing
            try:
                os.remove(vs_path)
            except Exception:
                pass
            try:
                os.remove(meta_path)
            except Exception:
                pass
    return None, None


def save_vectorstore_to_cache(model_name: str, vectorstore: FAISS, metadata: dict) -> None:
    """Save FAISS index and metadata to disk (ensures directories exist)."""
    vs_path = get_cache_path(f"vectorstore_{model_name}")
    meta_path = get_metadata_path(f"vectorstore_{model_name}")

    # ensure parent dir exists (defensive)
    parent = os.path.dirname(vs_path) or CACHE_DIR
    os.makedirs(parent, exist_ok=True)

    with open(vs_path, "wb") as f:
        pickle.dump(vectorstore, f)

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    st.success("💾 Cached vectorstore and document metadata.")


def is_cache_valid(model_name: str, current_doc_hashes: dict) -> bool:
    """Compare current docs with cached metadata to detect changes.

    current_doc_hashes should be the dict returned by get_all_doc_hashes(docs_dir).
    """
    _, cached_meta = load_cached_vectorstore(model_name)
    if not cached_meta:
        return False
    return cached_meta.get("doc_hashes") == current_doc_hashes
