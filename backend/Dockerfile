# AI Version-Aware Document Search API — FastAPI + FAISS + sentence-transformers (+ optional bundled Ollama)
#
#   docker build -t ai-version-aware-document-search backend                       # with Ollama inside (HF Spaces)
#   docker build -t ai-version-aware-document-search --build-arg WITH_OLLAMA=false backend   # use an external Ollama
FROM python:3.12-slim

ARG WITH_OLLAMA=true

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf \
    AT_DATA_DIR=/data \
    AT_OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    AT_OLLAMA_MODEL=llama3.2:1b \
    PORT=7860

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/*

RUN if [ "$WITH_OLLAMA" = "true" ]; then curl -fsSL https://ollama.com/install.sh | sh; fi

WORKDIR /app

# CPU-only PyTorch keeps the image ~1.5 GB smaller than the default CUDA build
COPY requirements.txt requirements-ml.txt ./
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install -r requirements-ml.txt

# Bake the embedding model into the image so cold starts don't download it
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Hugging Face Spaces run containers as uid 1000
RUN useradd -m -u 1000 user \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data /home/user/.ollama \
    && chown -R user /data /home/user /opt/hf
USER user
ENV HOME=/home/user OLLAMA_MODELS=/home/user/.ollama/models

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
