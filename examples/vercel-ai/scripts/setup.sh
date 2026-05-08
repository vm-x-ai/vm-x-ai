#!/usr/bin/env bash
# Provision the example workspace + connections + resources + a fresh API key,
# and write the IDs/key to `examples/vercel-ai/.env.local` so the TS examples
# can pick them up via `config.ts`.
#
# Reuses the same workspace ("api-completion-examples") as
# `examples/api-completion` — both example projects share one seed so we
# don't double-seed.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(cd ../.. && pwd)"
ENV_FILE="$(pwd)/.env.local"

echo "[setup] booting AppModule + seeding…" >&2
load_env_file() {
  local file=$1
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    local key=${line%%=*}
    local value=${line#*=}
    case "$value" in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
    esac
    export "$key=$value"
  done < "$file"
}
load_env_file "$ROOT_DIR/.env.local"
load_env_file "$ROOT_DIR/packages/api/.env.local"

output="$(cd "$ROOT_DIR/packages/api" && pnpm exec ts-node \
  --project tsconfig.app.json \
  --transpile-only \
  scripts/seed-examples.ts)"

filtered="$(printf '%s\n' "$output" | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E '^(#|[A-Z_][A-Z0-9_]*=)' || true)"
printf '%s\n' "$filtered" | tee "$ENV_FILE"
echo "[setup] wrote $ENV_FILE" >&2
