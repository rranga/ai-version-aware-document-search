# 🔍 AI Version-Aware Document Search

[![CI](https://github.com/rranga/ai-version-aware-document-search/actions/workflows/ci.yml/badge.svg)](https://github.com/rranga/ai-version-aware-document-search/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Search, compare and ask questions across **every version** of your documents.

Upload files or add links, and each new upload of the same document becomes a new version. Then ask a question against the latest version, one specific version, a range of versions, or all of them. Answers come from a local LLM (Ollama), cite their sources, and say which version each fact comes from. A compare view shows exactly what changed between two versions.

**Live demo:** https://rranga.github.io/ai-version-aware-document-search/. It runs in demo mode, with sample documents and keyword search, until you connect a backend in **Settings**.

*Formerly **Aavanam Thedal** (Tamil for "document search"). Version 2 replaces the original Streamlit app; see [What changed from v1](#what-changed-from-v1).*

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Installation guide](#installation-guide)
- [Using the app](#using-the-app)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Guardrails](#guardrails)
- [Deployment](#deployment)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [What changed from v1](#what-changed-from-v1)
- [License](#license)

---

## Features

### Documents and versions
- **Upload or link:** PDF (with page numbers), Word `.docx` (with headings and tables), Markdown, plain text and HTML, from a file or a URL.
- **Automatic versioning:** uploading a file with the same name, or refreshing a link, creates `v2`, `v3` and so on. To version a file saved under a different name, choose **New version of…**. Identical re-uploads are detected and ignored.
- **Version labels:** name versions, for example "2025 edition" or "Draft for legal".
- **Incremental indexing:** passages are stored by content hash, so a new version only embeds the passages that changed.

### Search and answers
- **Search by version:** *Latest version*, *Specific version*, *Version range* or *All versions*, for one document or all of them.
- **Hybrid retrieval:** meaning-based search (FAISS + sentence-transformers) combined with keyword search (SQLite FTS5 / BM25).
- **Answers with citations:** streamed from a local Ollama model, with clickable `[1]`, `[2]` citations. When versions disagree, the answer says which version says what.
- **Version spread:** each result shows which versions contain that passage, or marks it "only in this version".
- **Model picker:** a ChatGPT-style menu lists every chat model installed in Ollama, with size and family. Switching re-asks the question, and each answer shows which model wrote it.

### Compare
- **Version differences:** paragraph-level changes with word-level highlighting, plus a one-click AI summary of what changed.

### Safety
- **Protection for a shared deployment:**
  - API key for changes, rate limits and a storage cap.
  - Prompt-injection hardening, a relevance floor and a citation check.
  - Model allow-list and safe file parsing.
  - Link protection (SSRF), plus optional safety moderation and personal-data masking.

  See [Guardrails](#guardrails).

### Interface
- **Responsive:** works from 320 px phones to wide desktops, with light and dark themes.
- **Shareable links:** the question and version scope are kept in the URL.
- **Demo mode:** runs entirely in the browser when no backend is connected, so the GitHub Pages site always works.

---

## How it works

```
 Browser (GitHub Pages or localhost:5173)              Backend (localhost:8000, Docker or Hugging Face Space)
┌──────────────────────────────────────┐   HTTPS    ┌──────────────────────────────────────────────────────────┐
│ React app                            │  JSON/SSE  │ FastAPI  (app/main.py)                                   │
│  Search · Library · Document ·       │ ─────────▶ │  ├─ guardrails: API key, rate limits, model allow-list   │
│  Compare · Settings                  │            │  ├─ ingest/: loaders · link fetch · chunker              │
│                                      │            │  ├─ engine.py: versions, scoped hybrid search, diffs     │
│ Demo API (in-browser, no backend)    │            │  │    ├─ SQLite: documents → versions → passages + FTS5  │
└──────────────────────────────────────┘            │  │    └─ FAISS: one vector per unique passage            │
                                                    │  └─ rag.py ──▶ Ollama (LangChain ChatOllama)             │
                                                    └──────────────────────────────────────────────────────────┘
```

**Adding a document:**
1. The file is parsed into sections, with page numbers and headings kept.
2. The sections are split into passages of about 1000 characters.
3. Each passage is identified by a hash of its text. Passages that already exist from an earlier version are reused; only new ones are embedded and added to FAISS.

**Asking a question:**
1. The selected scope (for example "document 3, versions 2–4") is turned into the exact set of passages in those versions.
2. FAISS searches only those passages (using `IDSelectorBatch`), and SQLite FTS5 runs a keyword search over the same set. The two rankings are merged with reciprocal-rank fusion.
3. Passages that are neither keyword matches nor semantically close are dropped.
4. The remaining passages, each labelled with its document, version, page and section, go to the model with instructions to cite them.
5. The answer streams back and is then checked for citations that don't exist.

SQLite is the source of truth. The FAISS index is rebuilt automatically if it is missing, out of sync, or if the embedding model changes.

---

## Tech stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 6, Tailwind CSS 4, React Router, react-markdown, lucide-react, Vitest |
| **Backend** | Python 3.12, FastAPI, Uvicorn, Pydantic Settings |
| **Search** | FAISS (`IndexIDMap2` + `IndexFlatIP`), sentence-transformers `all-MiniLM-L6-v2`, SQLite FTS5 (BM25) |
| **LLM** | Ollama via LangChain (`langchain-ollama`); optional Llama Guard for moderation |
| **Parsing** | pypdf, python-docx, BeautifulSoup, LangChain text splitters |
| **CI/CD** | GitHub Actions, GitHub Pages, GitHub Container Registry, Hugging Face Spaces (Docker) |

---

## Project structure

```
ai-version-aware-document-search/
│
├── backend/                         # FastAPI service
│   ├── app/
│   │   ├── main.py                  # API routes, streaming (SSE), error handling
│   │   ├── config.py                # All settings (AT_* environment variables)
│   │   ├── engine.py                # Core: versioned ingestion, scoped hybrid search, diffs
│   │   ├── db.py                    # SQLite schema (documents, versions, passages, FTS5)
│   │   ├── vectorstore.py           # FAISS index keyed by passage id
│   │   ├── embeddings.py            # sentence-transformers embedder (+ lightweight hash embedder)
│   │   ├── rag.py                   # Prompts, citations, prompt-injection defenses, Ollama client
│   │   ├── diff.py                  # Paragraph and word-level version differences
│   │   ├── guardrails.py            # API key, rate limiter, citation check
│   │   ├── safety.py                # Personal-data masking, Llama Guard moderation
│   │   ├── schemas.py               # Request/response models (incl. version scope)
│   │   └── ingest/
│   │       ├── loaders.py           # PDF, DOCX, Markdown, text, HTML parsing + safety limits
│   │       ├── fetch.py             # Link download with SSRF protection
│   │       └── chunker.py           # Passage splitting and content hashing
│   ├── tests/                       # pytest suite (77 tests, no model downloads)
│   ├── Dockerfile                   # Image for Docker / Hugging Face Spaces (optionally bundles Ollama)
│   ├── docker-entrypoint.sh         # Starts Ollama, pulls models, runs the API
│   ├── requirements.txt             # Core dependencies
│   ├── requirements-ml.txt          # + sentence-transformers (semantic search)
│   ├── requirements-dev.txt         # + pytest, ruff
│   └── pyproject.toml               # Ruff and pytest settings
│
├── frontend/                        # React single-page app
│   ├── src/
│   │   ├── main.tsx                 # Routes
│   │   ├── pages/                   # Search, Library, Document, Compare, Settings
│   │   ├── components/              # Layout, ScopeBar, ModelPicker, Dropdown, AnswerView,
│   │   │                            # SourceCard, DiffView, UploadPanel, shared UI
│   │   ├── api/
│   │   │   ├── client.ts            # HTTP client + streaming reader
│   │   │   ├── demo.ts              # In-browser demo backend
│   │   │   ├── demoData.ts          # Sample documents for demo mode
│   │   │   └── types.ts             # Types shared with the API
│   │   ├── lib/                     # Settings/state, diff algorithm, text helpers
│   │   └── index.css                # Theme tokens (light/dark)
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
│
├── .github/workflows/
│   ├── ci.yml                       # Lint + tests + builds on every push and PR
│   ├── pages.yml                    # Deploy frontend to GitHub Pages
│   └── backend-deploy.yml           # Publish image to GHCR, sync to Hugging Face Space
│
├── docker-compose.yml               # Backend + Ollama for local use
├── LICENSE
└── README.md
```

Runtime data (the SQLite database and FAISS index) is written to `backend/data/` and is not committed.

---

## Installation guide

### Prerequisites

| Tool | Version | Needed for | Check with |
|---|---|---|---|
| **Python** | 3.11 or newer (CI uses 3.12) | Backend | `python --version` |
| **Node.js** | 22 or newer | Frontend | `node --version` |
| **Git** | any | Cloning | `git --version` |
| **[Ollama](https://ollama.com/download)** | latest | AI answers and change summaries. Search works without it | `ollama --version` |
| Docker | optional | Running in containers | `docker --version` |

Plan for about 1.5 GB of disk space for Python packages (PyTorch is the largest). You'll also need room for the Ollama model you choose, from about 1.3 GB for `llama3.2:1b` up to about 5 GB for a 7B model.

### 1. Clone the repository

```bash
git clone https://github.com/rranga/ai-version-aware-document-search.git
cd ai-version-aware-document-search
```

### 2. Set up the backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

| OS / shell | Command |
|---|---|
| Windows (PowerShell) | `.venv\Scripts\Activate.ps1` |
| Windows (Command Prompt) | `.venv\Scripts\activate.bat` |
| macOS / Linux | `source .venv/bin/activate` |

Install the dependencies:

```bash
python -m pip install --upgrade pip
pip install -r requirements-ml.txt
```

`requirements-ml.txt` includes everything in `requirements.txt` plus sentence-transformers for meaning-based search.

On Linux, if you don't have an NVIDIA GPU, install the much smaller CPU build of PyTorch **first**:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

### 3. Install a model in Ollama

Install Ollama from https://ollama.com/download, then pull a chat model:

```bash
ollama pull llama3.2          # about 2 GB; good default
# or a smaller / larger one:
ollama pull llama3.2:1b       # about 1.3 GB, fastest
ollama pull qwen2.5:7b        # about 4.7 GB, better answers
```

Every chat model you pull appears in the app's model picker.

### 4. Start the backend

From the `backend` folder, with the virtual environment active:

```bash
uvicorn app.main:app --reload --port 8000
```

The first start downloads the embedding model (about 90 MB). When it's running:
- The API is at http://localhost:8000.
- The interactive API docs are at http://localhost:8000/docs.
- http://localhost:8000/api/health should return `"status": "ok"`, with `"reachable": true` under `llm` if Ollama is running.

### 5. Set up and start the frontend

In a **second terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. In development the frontend connects to `http://localhost:8000` automatically. The sidebar should show **Connected**.

### Alternative: run with Docker

```bash
docker compose up --build                          # API on http://localhost:8000 + an Ollama container
docker compose exec ollama ollama pull llama3.2    # first time only
```

Then start the frontend as in step 5.

You can also build the all-in-one image used on Hugging Face, which bundles Ollama and `llama3.2:1b`:

```bash
docker build -t ai-version-aware-document-search ./backend
docker run -p 7860:7860 -v docsearch-data:/data ai-version-aware-document-search
```

### Lightweight install (no PyTorch)

For a quick try or a very small server, you can skip sentence-transformers:

```bash
pip install -r requirements.txt
```

Then set `AT_EMBEDDING_PROVIDER=hash` before starting. Search then matches keywords rather than meaning.

---

## Using the app

1. **Add documents (Library):**
   - Drag in files or paste a link.
   - Upload the same file name again to create a new version, or choose **New version of…** to version a file with a different name.
   - Add an optional label to each version.
2. **Search or ask (Search):**
   - Type a question and pick **Ask AI** for a cited answer, or **Search only** for passages without an AI answer.
   - Choose a document and a version scope from the **Versions** menu: latest version, all versions, a specific version, or a range.
3. **Switch models:** use the model menu next to the search box. Your choice is remembered, and the current question is re-asked with the new model.
4. **Compare versions (Compare):** pick a document and two versions to see what was added, removed and changed. **Summarize changes** asks the model for a short summary.
5. **Manage a document (Library → a document):** view each version's full text, label or delete versions, rename the document, or **Refresh** a link to check it for changes.
6. **Settings:**
   - Connect to a different backend, or switch to demo mode.
   - Enter the API key if the backend requires one.
   - Choose the default model and the theme.
   - See which safety features are on.

---

## Configuration

### Backend

All settings are environment variables with the `AT_` prefix. You can also put them in a `backend/.env` file. Defaults are in [backend/app/config.py](backend/app/config.py).

**General**

| Variable | Default | Description |
|---|---|---|
| `AT_DATA_DIR` | `data` | Folder for the SQLite database and FAISS index (`/data` in Docker) |
| `AT_CORS_ORIGINS` | `["http://localhost:5173", "http://127.0.0.1:5173", "https://rranga.github.io"]` | JSON list of sites allowed to call the API. Add your own Pages domain if you fork |
| `AT_MAX_UPLOAD_MB` | `25` | Largest upload or downloaded link |
| `AT_MAX_STORAGE_MB` | `1000` | Total size of all stored versions. `0` = no limit |
| `AT_ALLOW_PRIVATE_URLS` | `false` | Allow links to private or loopback addresses (for example, intranet pages). Keep this off on public servers |

**Search and models**

| Variable | Default | Description |
|---|---|---|
| `AT_EMBEDDING_PROVIDER` | `sentence-transformers` | `sentence-transformers` for meaning-based search; `hash` for the lightweight keyword embedder |
| `AT_EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Any sentence-transformers model. Changing it re-embeds everything on the next start |
| `AT_LLM_PROVIDER` | `ollama` | `ollama`, or `fake` for canned answers (tests) |
| `AT_OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama is running |
| `AT_OLLAMA_MODEL` | `llama3.2` | Default answer model |
| `AT_ALLOWED_MODELS` | *(unset)* | JSON list of models users may pick, e.g. `["llama3.2:1b", "qwen2.5:3b"]`. Unset = any installed chat model |
| `AT_LLM_TEMPERATURE` | `0.2` | Lower keeps answers closer to the sources |
| `AT_CHUNK_SIZE` / `AT_CHUNK_OVERLAP` | `1000` / `150` | Passage size and overlap in characters. Applies to versions added afterwards |
| `AT_DEFAULT_TOP_K` | `6` | Passages returned when a request doesn't set `k` |
| `AT_MIN_RELEVANCE` | `0.25` | Minimum similarity for a passage without a keyword match to reach the model. `0` = off |

**Security and safety**

| Variable | Default | Description |
|---|---|---|
| `AT_API_KEY` | *(unset)* | Key required for changes, sent as the `X-API-Key` header. **Set this on any public deployment** |
| `AT_PROTECT_READS` | `false` | Also require the key for listing, search and questions |
| `AT_RATE_LIMIT_ASK_PER_MINUTE` | `10` | Questions and change summaries per client per minute |
| `AT_RATE_LIMIT_ASK_GLOBAL_PER_MINUTE` | `60` | Questions and change summaries per minute across all clients |
| `AT_RATE_LIMIT_SEARCH_PER_MINUTE` | `60` | Searches per client per minute |
| `AT_RATE_LIMIT_INGEST_PER_HOUR` | `30` | Uploads, links and refreshes per client per hour. For all rate limits, `0` = no limit |
| `AT_MODERATION_MODEL` | *(unset)* | Llama Guard model for the safety check, e.g. `llama-guard3:1b`. Unset = off |
| `AT_REDACT_PII` | `false` | Mask emails, phone numbers, card numbers, IBANs and SSNs in results and model input |
| `AT_MAX_UNPACKED_MB` | `200` | Largest unpacked size of a DOCX file |
| `AT_MAX_PAGES` | `2000` | Most pages in a PDF |
| `AT_PARSE_TIMEOUT_S` | `120` | Time limit for reading one file |
| `AT_MAX_TEXT_CHARS` | `5000000` | Most characters of text in one version |

Example `backend/.env`:

```env
AT_OLLAMA_MODEL=qwen2.5:7b
AT_API_KEY=change-me-to-a-long-random-string
AT_CORS_ORIGINS=["http://localhost:5173", "https://your-user.github.io"]
```

Generate a strong key with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

### Frontend (build time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` in dev; empty in production builds | Backend URL. Empty = demo mode until a backend is set in Settings |
| `VITE_BASE` | `/` | Base path of the built site. The Pages workflow sets `/<repo-name>/` |

---

## API reference

Interactive docs are at `/docs` (Swagger UI) and `/redoc`. All endpoints are under `/api`. When `AT_API_KEY` is set, send it as `X-API-Key: <key>`.

| Method | Path | Body / query | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | | Status, models, index stats, limits, auth and safety settings |
| `GET` | `/api/auth/check` | header `X-API-Key` | `204` if the key allows changes, `401` if not |
| `GET` | `/api/documents` | | List documents |
| `POST` | `/api/documents` | multipart: `file`, optional `title`, `document_id`, `label` | Upload a file. Same name or `document_id` → new version |
| `POST` | `/api/documents/url` | JSON: `url`, optional `title`, `document_id`, `label` | Add a document from a link |
| `GET` | `/api/documents/{id}` | | A document with all its versions |
| `PATCH` | `/api/documents/{id}` | JSON: `title` | Rename |
| `DELETE` | `/api/documents/{id}` | | Delete a document and its versions |
| `POST` | `/api/documents/{id}/refresh` | query: optional `label` | Download the link again; new version only if changed |
| `GET` | `/api/documents/{id}/versions/{n}` | | Full text of version `n` |
| `PATCH` | `/api/documents/{id}/versions/{n}` | JSON: `label` | Label a version |
| `DELETE` | `/api/documents/{id}/versions/{n}` | | Delete a version |
| `GET` | `/api/documents/{id}/diff` | query: `from`, `to` | Differences between two versions |
| `POST` | `/api/documents/{id}/diff/summary` | query: `from`, `to`, optional `model` | AI summary of the changes (streamed) |
| `POST` | `/api/search` | JSON: `query`, optional `scope`, `k` | Hybrid search |
| `POST` | `/api/ask` | JSON: `query`, optional `scope`, `k`, `model` | Answer with sources (streamed) |

### Version scope

`/api/search` and `/api/ask` take an optional `scope`. Leave it out to search the latest version of every document.

```json
{ "mode": "latest" }
{ "mode": "all", "document_ids": [3] }
{ "mode": "version", "document_ids": [3], "version": 2 }
{ "mode": "range", "document_ids": [3], "version_from": 2, "version_to": 4 }
```

`version` and `range` need exactly one document. Each result lists the `versions` that contain the passage.

### Streaming events

`/api/ask` and `/api/documents/{id}/diff/summary` return Server-Sent Events. Each event's `data` is JSON.

| Event | Data | When |
|---|---|---|
| `sources` | search hits | First (ask only). `[1]`, `[2]`… refer to this list |
| `blocked` | `{categories, labels}` | The safety check refused the question |
| `model` | model name | Before the answer: which model is answering |
| `token` | text | Each piece of the answer |
| `check` | `{cited, invalid, uncited, source_count, suspicious_sources}` | After the answer (ask only) |
| `error` | message | Ollama failed. Sources already sent remain valid |
| `done` | `{}` | Always last |

### Examples

```bash
API=http://localhost:8000
KEY="X-API-Key: your-key"   # only if AT_API_KEY is set

# Upload v1, then v2 of the same file
curl -H "$KEY" -F file=@handbook.docx -F label="2024 edition" $API/api/documents
curl -H "$KEY" -F file=@handbook.docx -F label="2025 edition" $API/api/documents

# Add a link
curl -H "$KEY" -H "Content-Type: application/json" \
  -d '{"url": "https://www.rfc-editor.org/rfc/rfc2119.txt"}' $API/api/documents/url

# Search only version 1 of document 1
curl -H "Content-Type: application/json" \
  -d '{"query": "annual leave", "scope": {"document_ids": [1], "mode": "version", "version": 1}}' \
  $API/api/search

# Ask across all versions with a chosen model (streamed)
curl -N -H "Content-Type: application/json" \
  -d '{"query": "How many remote days are allowed?", "model": "llama3.2", "scope": {"document_ids": [1], "mode": "all"}}' \
  $API/api/ask
```

### Error codes

Errors return `{"detail": "..."}`.

| Code | Meaning |
|---|---|
| `401` | Missing or wrong API key |
| `404` | Unknown document or version |
| `413` | File larger than `AT_MAX_UPLOAD_MB` |
| `422` | Unsupported or unreadable file, a parsing limit exceeded, blocked link, model not offered, or invalid request |
| `429` | Rate limit reached; `Retry-After` gives the seconds to wait |
| `503` | Safety check configured but unavailable, or Ollama unreachable while checking a model |
| `507` | Storage limit reached |

---

## Guardrails

| Guardrail | What it does |
|---|---|
| **API key** | With `AT_API_KEY` set, uploads, links, refreshes, renames, labels and deletes need the key. Search and questions stay open unless `AT_PROTECT_READS=true`. Users enter the key once in Settings; it stays in their browser |
| **Rate limits and storage cap** | Per-client limits on asking, searching and uploading, plus a global limit on asking. Total storage is capped |
| **Prompt-injection defense** | Documents are treated as untrusted data. Each passage is wrapped in delimiters its text can't forge, hidden characters are stripped, and the rules are repeated after the passages. Text aimed at an AI ("ignore previous instructions…") is detected, flagged to the model, and marked in the UI with a warning |
| **Relevance floor** | Only passages that match a keyword or are semantically close reach the model. An unrelated question gets "couldn't find anything relevant" instead of an improvised answer |
| **Citation check** | Flags citations to sources that don't exist and answers with no citations |
| **Model allow-list** | Only the default model and installed chat models (or `AT_ALLOWED_MODELS`) can be requested |
| **Safe file parsing** | Checks a DOCX's unpacked size before decompressing it, limits PDF pages, rejects password-protected PDFs, and limits parsing time and text size |
| **Link protection (SSRF)** | Links to private, loopback and internal addresses are blocked, including after redirects |
| **Safety moderation** *(optional)* | `AT_MODERATION_MODEL=llama-guard3:1b` screens each question with Llama Guard before searching. Refused questions name the category. If the safety model is down, questions are refused rather than allowed |
| **Personal-data masking** *(optional)* | `AT_REDACT_PII=true` masks emails, phone numbers, card numbers, IBANs and SSNs in everything returned and everything sent to the model. Names and addresses are not detected |

These reduce risk but can't remove it. Very small models are easier to mislead, which is why the citation check and the warnings stay in place as a backstop.

---

## Deployment

The frontend runs on **GitHub Pages** (free). The backend runs on a **Hugging Face Docker Space**: the free tier gives 2 vCPU and 16 GB RAM, enough to run the backend with a small Ollama model.

| Workflow | Runs on | What it does |
|---|---|---|
| [ci.yml](.github/workflows/ci.yml) | every push and pull request | Ruff + pytest; type check + Vitest + build; Docker build check on PRs |
| [pages.yml](.github/workflows/pages.yml) | push to `main` that changes `frontend/` | Builds the frontend and deploys it to GitHub Pages |
| [backend-deploy.yml](.github/workflows/backend-deploy.yml) | push to `main` that changes `backend/` | Publishes the image to GHCR and syncs it to the Hugging Face Space |

### One-time setup

1. **GitHub Pages:** in the repo, go to *Settings → Pages → Build and deployment → Source* and choose **GitHub Actions**.
2. **Hugging Face token:**
   - At huggingface.co, go to *Settings → Access Tokens* and create a **write** token.
   - In the GitHub repo, go to *Settings → Secrets and variables → Actions*.
   - Add the secret `HF_TOKEN` (the token) and the variable `HF_SPACE` (e.g. `your-hf-user/ai-version-aware-document-search`).
   - The workflow creates the Space on the first deploy.
3. **Protect the backend:** in the Space, go to *Settings → Variables and secrets* and add a secret `AT_API_KEY`.
4. **Connect the site:**
   - Add the repo variable `API_URL` = `https://<hf-user>-ai-version-aware-document-search.hf.space`.
   - Re-run the Pages workflow.

### Hugging Face Space options

Set these as Space variables:

| Variable | Example | Effect |
|---|---|---|
| `AT_OLLAMA_MODEL` | `llama3.2:1b` (default) | Default answer model, downloaded on start |
| `EXTRA_MODELS` | `qwen2.5:1.5b gemma3:1b` | More models for the picker |
| `AT_MODERATION_MODEL` | `llama-guard3:1b` | Turns on the safety check |
| `AT_REDACT_PII` | `true` | Turns on personal-data masking |

Things to know about the free tier:
- **Startup:** the Space sleeps when idle, and the first answer after a cold start waits for the model download.
- **Speed:** answers take tens of seconds on CPU.
- **Data:** documents are lost on restart unless you enable persistent storage, which is mounted at `/data`, the path the app uses.

---

## Testing

```bash
# Backend: 77 tests, no model downloads (uses a hash embedder and a fake LLM)
cd backend
pip install -r requirements-dev.txt
pytest
ruff check . && ruff format --check .

# Frontend: type check, unit tests and production build
cd frontend
npm run typecheck
npm test
npm run build
```

CI runs all of these on every push and pull request.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Sidebar says **Backend offline** | Check the backend is running at the URL in **Settings** and that http://localhost:8000/api/health opens |
| **Connected · LLM offline** | Start Ollama (`ollama serve`, or open the Ollama app) and pull a model with `ollama pull llama3.2`. Search still works meanwhile |
| "Cannot reach the backend … (CORS)" | Add the site's address to `AT_CORS_ORIGINS` and restart the backend |
| Uploads fail with **401** | The backend has `AT_API_KEY` set. Enter the key in **Settings → API key** |
| "Model … isn't available" | Pull it with `ollama pull <model>`, or choose one from the model menu |
| PowerShell won't run `Activate.ps1` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt |
| Port 8000 or 5173 already in use | Use another port (`uvicorn … --port 8001`) and set it in **Settings**; for Vite, run `npm run dev -- --port 5174` |
| First backend start is slow | It's downloading the embedding model (about 90 MB) once |
| "No extractable text found" in a PDF | It's a scanned, image-only PDF; OCR isn't supported |

---

## What changed from v1

Version 2 is a complete rewrite of the original Streamlit app.

| | v1 (Aavanam Thedal) | v2 |
|---|---|---|
| UI | Streamlit | React + TypeScript, responsive, light/dark |
| Backend | In-process Streamlit app | FastAPI service with a documented REST API |
| Versions | None (a re-upload replaced the index) | Every version kept, searchable by version, comparable |
| Sources | Uploaded files | Files and links, with refresh |
| Search | FAISS only | FAISS + keyword search, scoped to versions |
| Answers | No citations | Streamed, cited, version-aware, with model picker |
| Safety | None | API key, rate limits, injection defense, file limits and more |
| Deployment | Local only | GitHub Pages + Hugging Face Space via GitHub Actions |

The v1 files (`app.py`, `core/`, `ui/`) have been removed. Documents indexed by v1 are not migrated; upload them again.

---

## License

[MIT](LICENSE) © 2026 Rangaprasad Rekkamalli
