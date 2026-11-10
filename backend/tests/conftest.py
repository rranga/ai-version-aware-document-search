from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engine import Engine
from app.ingest.fetch import Fetched
from app.main import create_app
from app.rag import FakeLLM


class FakeFetcher:
    """Serves in-memory pages instead of hitting the network."""

    def __init__(self) -> None:
        self.pages: dict[str, tuple[bytes, str]] = {}

    def __call__(self, url: str, *, max_bytes: int, allow_private: bool) -> Fetched:
        data, ctype = self.pages[url]
        return Fetched(data=data, content_type=ctype, final_url=url, filename=url.rsplit("/", 1)[-1])


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        embedding_provider="hash",
        llm_provider="fake",
        chunk_size=200,
        chunk_overlap=0,
    )


@pytest.fixture
def fetcher() -> FakeFetcher:
    return FakeFetcher()


@pytest.fixture
def engine(settings, fetcher) -> Engine:
    return Engine(settings, llm=FakeLLM(), fetcher=fetcher)


@pytest.fixture
def client(settings, engine) -> TestClient:
    return TestClient(create_app(settings, engine))


POLICY_V1 = b"""# Refund Policy

Customers may request a refund within 30 days of purchase.

# Shipping

Standard shipping takes 5 business days. Express shipping is available.

# Support

Support is available by email around the clock.
"""

POLICY_V2 = b"""# Refund Policy

Customers may request a refund within 14 days of purchase. Digital goods are non-refundable.

# Shipping

Standard shipping takes 5 business days. Express shipping is available.

# Support

Support is available by email around the clock.
"""
