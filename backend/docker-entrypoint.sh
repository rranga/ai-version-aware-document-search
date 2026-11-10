#!/bin/sh
set -e

# Start the bundled Ollama (if installed and not disabled), then pull the
# model in the background so the API is reachable immediately. /api/health
# reports the model once the pull has finished.
if [ "${START_OLLAMA:-true}" != "false" ] && command -v ollama >/dev/null 2>&1; then
  ollama serve >/tmp/ollama.log 2>&1 &
  i=0
  until curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || [ "$i" -ge 30 ]; do
    i=$((i + 1))
    sleep 1
  done
  # Answer model, then any extra models to offer in the picker (space-separated
  # EXTRA_MODELS) and the optional safety model.
  (
    for m in "${AT_OLLAMA_MODEL}" ${EXTRA_MODELS:-} ${AT_MODERATION_MODEL:-}; do
      ollama pull "$m"
    done >/tmp/ollama-pull.log 2>&1 &
  )
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-7860}" --proxy-headers --forwarded-allow-ips "*"
