"""Download a document from a link, with SSRF protection and a size cap."""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from pathlib import PurePosixPath
from urllib.parse import unquote, urljoin, urlparse

import httpx

from .loaders import IngestError

MAX_REDIRECTS = 5
USER_AGENT = "AIVersionAwareDocSearch/2.0 (document indexer)"


@dataclass
class Fetched:
    data: bytes
    content_type: str | None
    final_url: str
    filename: str


def _check_host(host: str, allow_private: bool) -> None:
    if allow_private:
        return
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise IngestError(f"Could not resolve host '{host}'.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise IngestError(
                f"Refusing to fetch '{host}': it resolves to a private or local address. "
                "Set AT_ALLOW_PRIVATE_URLS=true to allow intranet links."
            )


def _filename_for(url: str) -> str:
    parsed = urlparse(url)
    name = unquote(PurePosixPath(parsed.path).name)
    return name or parsed.hostname or "document"


def fetch_url(url: str, *, max_bytes: int, allow_private: bool, timeout: float = 20.0) -> Fetched:
    current = url.strip()
    with httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            parsed = urlparse(current)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise IngestError("Only http(s) links are supported.")
            _check_host(parsed.hostname, allow_private)
            try:
                with client.stream("GET", current, follow_redirects=False) as resp:
                    if resp.is_redirect:
                        location = resp.headers.get("location")
                        if not location:
                            raise IngestError("Redirect without a Location header.")
                        current = urljoin(current, location)
                        continue
                    if resp.status_code >= 400:
                        raise IngestError(f"The link returned HTTP {resp.status_code}.")
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in resp.iter_bytes():
                        total += len(chunk)
                        if total > max_bytes:
                            raise IngestError(f"The linked document is larger than {max_bytes // (1024 * 1024)} MB.")
                        chunks.append(chunk)
                    return Fetched(
                        data=b"".join(chunks),
                        content_type=resp.headers.get("content-type"),
                        final_url=current,
                        filename=_filename_for(current),
                    )
            except httpx.HTTPError as exc:
                raise IngestError(f"Could not download the link: {exc}") from exc
    raise IngestError("Too many redirects.")
