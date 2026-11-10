# 🔍 AI Version-Aware Document Search

*Formerly **Aavanam Thedal** (Tamil for "document search").*

Upload documents or add links, keep **every version**, and search or ask questions against **the latest version, a specific version, a range of versions, or all of them**. See exactly what changed between versions, and get answers from a local LLM that cite their sources and say which version they come from.

**Live site:** `https://rranga.github.io/ai-version-aware-document-search/`. It runs in demo mode until a backend is connected in **Settings**.

| | |
|---|---|
| **Frontend** | React + TypeScript + Vite + Tailwind, deployed to GitHub Pages |
| **Backend** | FastAPI · FAISS · LangChain · sentence-transformers · SQLite |
| **LLM** | Ollama (local, or bundled into the Hugging Face Space image) |

---

## Features

- **Versioned ingestion.** Uploading a file with the same name, or refreshing a link, creates `v2`, `v3`, and so on. You can also choose *New version of…* to version a file that has a different name. If the content is identical to the latest version, no new version is created.
- **Incremental indexing.** Passages are stored by their content hash, so a new version only embeds the passages that changed. Unchanged text is shared between versions and embedded once.
- **Search by version.** Choose *Latest*, *Specific version*, *Version range* or *All versions*. FAISS searches only the passages that belong to the selected versions, using `IDSelectorBatch`, so results are exact rather than filtered afterwards.
- **Hybrid retrieval.** Semantic search (FAISS) and keyword search (SQLite FTS5 / BM25) are combined with reciprocal-rank fusion.
- **Answers with citations.** Answers stream as they are generated and cite their sources as `[1]`, `[2]`. Each source is labelled with its document, version, page and section, and the prompt tells the model to say which version says what.
- **Model picker.** A ChatGPT-style menu next to the search box shows the active model and lets you switch between the chat models installed on the backend's Ollama (with size and family). Switching re-asks the current question, and every answer is labelled with the model that wrote it.
- **Compare versions.** Paragraph-level differences with word-level highlighting, plus a one-click AI summary of the changes.
- **Links.** Supports PDF, DOCX, HTML and text URLs. *Refresh* downloads the link again and records a new version only if the content changed. Links to private or loopback addresses are blocked (SSRF protection).
- **Formats.** PDF (with page numbers), DOCX (with headings and tables), Markdown, plain text and HTML.
- **Guardrails.** API key for changes, rate limits and a storage cap, prompt-injection hardening, a relevance floor so unrelated questions never reach the model, a citation check on every answer, a model allow-list, safe file parsing, and optional safety moderation and personal-data masking. See [Guardrails](#guardrails).
- **UI.** Light and dark themes, works on phones, and links are shareable (the query and version scope are kept in the URL).

## Architecture

```
frontend/  (GitHub Pages)                 backend/  (Hugging Face Space · Docker · or local)
┌────────────────────────┐   HTTPS/SSE   ┌─────────────────────────────────────────────────┐
│ Search · Library ·     │ ────────────▶ │ FastAPI  app/main.py                            │
│ Document · Compare ·   │               │  ├─ ingest/  loaders · link fetch · chunker      │
│ Settings               │               │  ├─ engine.py  versions, scoped hybrid search   │
│ Demo API (in-browser)  │               │  ├─ SQLite: documents → versions → chunks + FTS5 │
└────────────────────────┘               │  ├─ FAISS IndexIDMap2(IndexFlatIP) by chunk id   │
                                         │  └─ rag.py ──▶ Ollama (LangChain ChatOllama)     │
                                         └─────────────────────────────────────────────────┘
```

SQLite is the source of truth. The FAISS index is rebuilt automatically if it is missing, out of sync, or if the embedding model changes.

## API

Interactive OpenAPI docs are served at `/docs` (Swagger UI) and `/redoc`. All endpoints are under `/api`.

### Endpoints

| Method | Path | Body / query | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | | Status, embedding model, Ollama reachability, the chat models users may pick (`llm.models`, `llm.model_details` with size/family), index stats, limits, `auth`, and `guardrails` (moderation model, PII masking) |
| `GET` | `/api/auth/check` | header: `X-API-Key` | `204` if the key is accepted for changes, `401` if not |
| `GET` | `/api/documents` | | List documents |
| `POST` | `/api/documents` | multipart: `file`, optional `title`, `document_id`, `label` | Upload a file. Same file name (or `document_id`) → new version |
| `POST` | `/api/documents/url` | JSON: `url`, optional `title`, `document_id`, `label` | Add a document from a link |
| `GET` | `/api/documents/{id}` | | One document with all its versions |
| `PATCH` | `/api/documents/{id}` | JSON: `title` | Rename a document |
| `DELETE` | `/api/documents/{id}` | | Delete a document, its versions and passages no longer used |
| `POST` | `/api/documents/{id}/refresh` | query: optional `label` | Download the link again; new version only if the content changed |
| `GET` | `/api/documents/{id}/versions/{n}` | | Full text of version `n` |
| `PATCH` | `/api/documents/{id}/versions/{n}` | JSON: `label` (max 80 chars, or `null`) | Label a version, e.g. "2025 edition" |
| `DELETE` | `/api/documents/{id}/versions/{n}` | | Delete one version |
| `GET` | `/api/documents/{id}/diff` | query: `from`, `to` | Structured difference between two versions |
| `POST` | `/api/documents/{id}/diff/summary` | query: `from`, `to`, optional `model` | Streamed AI summary of the changes (SSE) |
| `POST` | `/api/search` | JSON: `query`, optional `scope`, `k` (1–50) | Hybrid search |
| `POST` | `/api/ask` | JSON: `query`, optional `scope`, `k`, `model` | Streamed answer with sources (SSE). `model` must be one of `llm.models` or the default |

Uploading content identical to the latest version returns `"status": "unchanged"` and creates no version. Otherwise the status is `created` or `new_version`, and the response reports `new_chunks` (passages embedded) and `reused_chunks` (passages shared with earlier versions).

### Version scope

`/api/search` and `/api/ask` take an optional `scope`. Leave it out to search the latest version of every document.

| `mode` | Searches | Also needs |
|---|---|---|
| `latest` (default) | Newest version of each selected document | |
| `all` | Every version of each selected document | |
| `version` | One exact version | exactly one entry in `document_ids`, plus `version` |
| `range` | Versions `version_from` to `version_to`, inclusive | exactly one entry in `document_ids`, plus `version_from` and `version_to` |

`document_ids` limits the search to particular documents; leave it out or set it to `null` for all documents.

```json
{ "mode": "latest" }
{ "document_ids": [3], "mode": "version", "version": 2 }
{ "document_ids": [3], "mode": "range", "version_from": 2, "version_to": 4 }
{ "document_ids": [3], "mode": "all" }
```

Each search hit includes the passage `text`, its `score`, the `document`, and the `versions` that contain the passage (with page and section heading). This shows whether a passage is unchanged across versions or appears in only one.

### Examples

```bash
API=http://localhost:8000

# Upload v1, then v2 of the same file (same name → new version)
curl -F file=@handbook.docx -F label="2024 edition" $API/api/documents
curl -F file=@handbook.docx -F label="2025 edition" $API/api/documents

# Add a document from a link, and later check it for changes
curl -H "Content-Type: application/json" -d '{"url": "https://www.rfc-editor.org/rfc/rfc2119.txt"}' $API/api/documents/url
curl -X POST $API/api/documents/2/refresh

# Search only version 1 of document 1
curl -H "Content-Type: application/json" \
  -d '{"query": "annual leave", "scope": {"document_ids": [1], "mode": "version", "version": 1}}' \
  $API/api/search

# Compare versions 1 and 2
curl "$API/api/documents/1/diff?from=1&to=2"

# Ask a question across all versions (streamed)
curl -N -H "Content-Type: application/json" \
  -d '{"query": "How many remote days are allowed?", "scope": {"document_ids": [1], "mode": "all"}}' \
  $API/api/ask
```

### Streaming responses (SSE)

`/api/ask` and `/api/documents/{id}/diff/summary` return `text/event-stream`. Each event's `data` is JSON.

| Event | Data | When |
|---|---|---|
| `sources` | array of search hits | First (`/api/ask` only). Citations `[1]`, `[2]`… refer to this list |
| `model` | string | Before the first token: the model that is answering |
| `blocked` | `{categories, labels}` | The safety check refused the question (`/api/ask` only, when moderation is on) |
| `token` | string | Each piece of the answer as it is generated |
| `error` | string | Ollama is unreachable or failed. Sources already sent are still valid |
| `check` | `{cited, invalid, uncited, source_count, suspicious_sources}` | After the answer (`/api/ask` only). See [Guardrails](#guardrails) |
| `done` | `{}` | Always last |

### Errors

Errors return JSON `{"detail": "..."}`:

- `401`: missing or wrong API key (when `AT_API_KEY` is set).
- `404`: unknown document or version.
- `413`: file larger than the upload limit.
- `422`: unsupported or unreadable file, a file over a parsing limit, blocked link, a model that isn't offered, or invalid request.
- `429`: rate limit reached. The `Retry-After` header says how many seconds to wait.
- `503`: the safety check is configured but unavailable, or Ollama is unreachable so a model can't be verified.
- `507`: storage limit reached (`AT_MAX_STORAGE_MB`).

## Guardrails

| Guardrail | What it does | Settings |
|---|---|---|
| **API key** | When set, every change (upload, add link, refresh, rename, label, delete) needs the header `X-API-Key: <key>`; otherwise the API returns `401`. Search and questions stay open unless `AT_PROTECT_READS=true`. Users enter the key once on the Settings page; it is stored only in their browser. Keys are compared in constant time | `AT_API_KEY`, `AT_PROTECT_READS` |
| **Rate limits** | Per-client sliding-window limits on asking (including change summaries), searching and adding documents, plus a global limit on asking so one client can't monopolise the model. Over the limit returns `429` with `Retry-After` | `AT_RATE_LIMIT_*` |
| **Storage cap** | New versions are refused (`507`) once all stored versions together reach the cap | `AT_MAX_STORAGE_MB` |
| **Prompt-injection hardening** | Document text is untrusted: anyone can write a web page saying "ignore your instructions". Each passage is wrapped in `<excerpt>` tags that its content cannot close; control and invisible characters are stripped; the rules are stated before the passages and repeated after them; and passages containing text aimed at an AI are detected, named to the model, flagged in the `check` event and marked in the UI | — |
| **Relevance floor** | A passage is sent to the model only if it matches a query keyword or its semantic similarity is at least the floor. If none qualify, the model isn't called and the answer is a fixed "couldn't find anything" reply, so the model can't improvise from loosely related text | `AT_MIN_RELEVANCE` |
| **Model allow-list** | `model` must be the server default or a chat model installed in Ollama (embedding and safety models are never offered), or one of `AT_ALLOWED_MODELS` if set. Anything else returns `422` listing the valid choices | `AT_ALLOWED_MODELS` |
| **Safe file parsing** | DOCX files are zip archives, so their declared unpacked size and number of parts are checked *before* anything is decompressed (Python's zipfile never inflates past the declared size). PDFs have a page limit, password-protected PDFs are rejected, and pypdf's built-in stream cap stops PDF bombs. Parsing has a time budget, and the extracted text has a size limit | `AT_MAX_UNPACKED_MB`, `AT_MAX_PAGES`, `AT_PARSE_TIMEOUT_S`, `AT_MAX_TEXT_CHARS` |
| **Safety moderation** (optional) | Each question is classified by a [Llama Guard](https://ollama.com/library/llama-guard3) model in Ollama before any search or answer. Unsafe questions get a refusal naming the hazard category (e.g. "indiscriminate weapons") and never reach the answer model. If the safety model is configured but unreachable, questions are refused (`503`) rather than let through | `AT_MODERATION_MODEL` |
| **Personal-data masking** (optional) | Emails, phone numbers, card numbers (Luhn-checked), IBANs and US SSNs are replaced with `[EMAIL]`, `[PHONE]`, … in search results, answers' sources, version text, comparisons and everything sent to the model. Names and addresses are not detected. Keyword search still matches the original text | `AT_REDACT_PII` |
| **Citation check** | After each answer the server lists citations that refer to non-existent sources (`invalid`) and flags answers with no citations (`uncited`). The UI shows a warning, and invalid citation numbers are struck through instead of being clickable | — |

Already in place from before: SSRF protection for links, upload size limit, input validation, parameterised SQL, and AI output rendered without raw HTML.

**Tested against a real model** (`qwen2.5-coder:7b`): three injection payloads hidden in a document (a fake "SYSTEM NOTICE", a polite "note for AI assistants", and a role-play prompt) all failed. The answer gave the document's real content with a citation. Before the last two defenses (the repeated rules and the detector), the "SYSTEM NOTICE" payload succeeded. No defense is complete, especially with very small models, which is why the citation check and the UI warnings remain as a backstop.

Limits apply per backend process, which is how the app runs (one worker). The container trusts the proxy's forwarded client address so per-client limits work on Hugging Face; if you expose the container directly, remove `--forwarded-allow-ips` from `docker-entrypoint.sh`.

## Setup

### Prerequisites

| | Version | Needed for |
|---|---|---|
| Python | 3.12 | Backend |
| Node.js | 22 | Frontend |
| [Ollama](https://ollama.com) | latest | AI answers and change summaries. Search works without it |
| Docker | optional | Running in containers |

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate              # macOS/Linux: source .venv/bin/activate
pip install -r requirements-ml.txt  # includes requirements.txt + sentence-transformers
uvicorn app.main:app --reload --port 8000
```

The first start downloads the embedding model (about 90 MB). The API runs at http://localhost:8000, with docs at http://localhost:8000/docs. Data is stored in `backend/data/`.

For a lightweight install without PyTorch, run `pip install -r requirements.txt` and set `AT_EMBEDDING_PROVIDER=hash`. Search then matches keywords rather than meaning.

To run the tests and linter, also install `requirements-dev.txt`.

### 2. Ollama

```bash
ollama pull llama3.2                # or any chat model; choose it on the Settings page
```

Ollama must be running at `AT_OLLAMA_BASE_URL` (default `http://localhost:11434`). The models you have pulled appear in **Settings**.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

In development the frontend connects to `http://localhost:8000`. You can point it at a different backend in **Settings**; the choice is saved in your browser.

### Or run with Docker

```bash
docker compose up --build           # API on http://localhost:8000, plus an Ollama container
docker compose exec ollama ollama pull llama3.2
```

Then start the frontend as in step 3. To build the all-in-one image used for the Hugging Face Space, which bundles Ollama and `llama3.2:1b`:

```bash
docker build -t ai-version-aware-document-search ./backend
docker run -p 7860:7860 -v at-data:/data ai-version-aware-document-search
```

## Configuration

### Backend

Every setting is an environment variable with the `AT_` prefix. Settings can also go in a `backend/.env` file. See [backend/app/config.py](backend/app/config.py).

| Variable | Default | Description |
|---|---|---|
| `AT_DATA_DIR` | `data` | Folder for the SQLite database and FAISS index (`/data` in Docker) |
| `AT_EMBEDDING_PROVIDER` | `sentence-transformers` | `sentence-transformers` for semantic search, or `hash` for a lightweight keyword-hash embedder without PyTorch (tests and CI) |
| `AT_EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Any sentence-transformers model. Changing it re-embeds all passages on the next start |
| `AT_LLM_PROVIDER` | `ollama` | `ollama`, or `fake` for canned answers (tests) |
| `AT_OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama is running |
| `AT_OLLAMA_MODEL` | `llama3.2` | Default answer model. Users can choose another in Settings. The Space image uses `llama3.2:1b` |
| `AT_LLM_TEMPERATURE` | `0.2` | Lower values keep answers closer to the sources |
| `AT_CHUNK_SIZE` | `1000` | Passage size in characters |
| `AT_CHUNK_OVERLAP` | `150` | Characters shared between neighbouring passages |
| `AT_DEFAULT_TOP_K` | `6` | Passages returned when a request doesn't set `k` |
| `AT_MAX_UPLOAD_MB` | `25` | Largest accepted upload or downloaded link |
| `AT_MAX_STORAGE_MB` | `1000` | Total size of all stored versions; new uploads are refused beyond this. `0` = no limit |
| `AT_API_KEY` | *(unset)* | Key required for changes, sent as `X-API-Key`. **Set this on any public deployment.** Unset = anyone can change documents (a warning is logged) |
| `AT_PROTECT_READS` | `false` | Also require the key for listing, search and questions |
| `AT_RATE_LIMIT_ASK_PER_MINUTE` | `10` | Questions and change summaries per client per minute |
| `AT_RATE_LIMIT_ASK_GLOBAL_PER_MINUTE` | `60` | Questions and change summaries per minute across all clients |
| `AT_RATE_LIMIT_SEARCH_PER_MINUTE` | `60` | Searches per client per minute |
| `AT_RATE_LIMIT_INGEST_PER_HOUR` | `30` | Uploads, links and refreshes per client per hour. For all limits, `0` = no limit |
| `AT_MIN_RELEVANCE` | `0.25` | Minimum cosine similarity for a passage without a keyword match to be sent to the model. `0` = send every hit |
| `AT_ALLOWED_MODELS` | *(unset)* | JSON list of models users may pick, e.g. `["llama3.2:1b", "qwen2.5:3b"]`. Unset = any installed chat model |
| `AT_MODERATION_MODEL` | *(unset)* | Llama Guard model for the safety check, e.g. `llama-guard3:1b` (run `ollama pull llama-guard3:1b`). Unset = off |
| `AT_REDACT_PII` | `false` | Mask emails, phone numbers, card numbers, IBANs and SSNs in API output and model input |
| `AT_MAX_UNPACKED_MB` | `200` | Largest unpacked size of a DOCX |
| `AT_MAX_PAGES` | `2000` | Most pages in a PDF |
| `AT_PARSE_TIMEOUT_S` | `120` | Time budget for extracting text from one file |
| `AT_MAX_TEXT_CHARS` | `5000000` | Most characters of text extracted from one version |
| `AT_ALLOW_PRIVATE_URLS` | `false` | Allow links to private or loopback addresses, such as intranet pages. Keep it off on public servers |
| `AT_CORS_ORIGINS` | `["http://localhost:5173", "http://127.0.0.1:5173", "https://rranga.github.io"]` | JSON list of sites allowed to call the API. Add your own Pages domain if you fork the repo |

Example `backend/.env`:

```env
AT_OLLAMA_MODEL=qwen2.5:7b
AT_CHUNK_SIZE=800
AT_API_KEY=change-me-to-a-long-random-string
AT_CORS_ORIGINS=["http://localhost:5173", "https://your-user.github.io"]
```

New values for `AT_CHUNK_SIZE` and `AT_CHUNK_OVERLAP` apply only to versions added afterwards.

### Frontend (build time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` in dev; empty in production builds | Backend URL. When empty, the site runs in demo mode with sample documents until a backend is set in Settings |
| `VITE_BASE` | `/` | Base path for the built site. The Pages workflow sets `/<repo-name>/` |

## CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| [ci.yml](.github/workflows/ci.yml) | Every push and pull request | Ruff + pytest (backend); type check + Vitest + build (frontend); Docker build check on pull requests |
| [pages.yml](.github/workflows/pages.yml) | Push to `main` (`frontend/**`) | Builds the frontend and deploys it to GitHub Pages |
| [backend-deploy.yml](.github/workflows/backend-deploy.yml) | Push to `main` (`backend/**`) | Publishes the image to GHCR; syncs to the Hugging Face Space |

### One-time setup

1. **GitHub Pages:** go to *Settings → Pages → Build and deployment → Source* and choose **GitHub Actions**.
2. **Hugging Face Space:**
   - Create a write token at huggingface.co → *Settings → Access Tokens*.
   - In the GitHub repo, go to *Settings → Secrets and variables → Actions*.
   - Add the secret `HF_TOKEN` (your token) and the variable `HF_SPACE` (for example `your-hf-user/ai-version-aware-document-search`).
   - The workflow creates the Docker Space if it doesn't exist yet.
3. **Protect the backend:** in the Space, go to *Settings → Variables and secrets* and add a **secret** named `AT_API_KEY` (a long random string, e.g. from `python -c "import secrets; print(secrets.token_urlsafe(32))"`). Without it, anyone who finds the Space URL can delete your documents.
4. **Point the site at the backend:** add the repository variable `API_URL` set to `https://<hf-user>-ai-version-aware-document-search.hf.space`, then re-run the Pages workflow.

The Space image runs Ollama inside the container with `llama3.2:1b` by default; set `AT_OLLAMA_MODEL` in the Space settings to change it. To offer more models in the picker, set the Space variable `EXTRA_MODELS` (space-separated, e.g. `qwen2.5:1.5b gemma3:1b`); to turn on the safety check, set `AT_MODERATION_MODEL=llama-guard3:1b`. The container downloads these on start. Each model uses disk space and memory, so keep to small ones on the free tier. The first answer after a cold start waits for the model download, and answers on the free CPU tier take tens of seconds. Free Spaces also **don't persist data** across restarts unless you enable persistent storage, which is mounted at `/data`, the same path the app uses.

## Tests

```bash
cd backend && pytest              # 77 tests, no model downloads
cd frontend && npm test           # diff, demo-mode and API-client tests (9)
```

## License

[MIT](LICENSE) © 2026 Rangaprasad Rekkamalli
