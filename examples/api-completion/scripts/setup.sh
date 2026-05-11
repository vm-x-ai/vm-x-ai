#!/usr/bin/env bash
# Provision a workspace + environment + per-provider connections +
# resources + a fresh API key, and write the IDs/key to
# `examples/api-completion/.env.local` so the Python examples can
# pick them up via `config.load()`.
#
# Re-runnable: existing workspace/env/connection/resource entities are
# reused; the API key is rotated each run (plaintext can't be recovered
# from the hash, so a fresh value is the only honest contract).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(cd ../.. && pwd)"
ENV_FILE="$(pwd)/.env.local"

echo "[setup] booting AppModule + seeding…" >&2
# Source the api package's .env.local (DB / Redis / encryption /
# `*_API_KEY` for upstream providers) so the seed process boots
# AppModule with the same config the api server uses. Nx loads these
# automatically for `nx run` targets — for our raw ts-node call, we
# load them by hand. `bash`'s native `source` chokes on values with
# spaces (`OIDC_FEDERATED_SCOPES=openid profile email`), so parse
# `KEY=value` lines manually instead.
load_env_file() {
  local file=$1
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    local key=${line%%=*}
    local value=${line#*=}
    # Strip a single leading + trailing matching pair of quotes.
    case "$value" in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
    esac
    export "$key=$value"
  done < "$file"
}
load_env_file "$ROOT_DIR/.env.local"
load_env_file "$ROOT_DIR/packages/api/.env.local"

# ts-node runs against the api package's tsconfig + node_modules so the
# seed script's imports (`@nestjs/*`, `../src/*`) resolve cleanly. The
# api project owns the decorator-metadata flags + module aliases the
# seed script relies on. `--transpile-only` skips typechecking — this
# is a one-off seed script, not the build.
output="$(cd "$ROOT_DIR/packages/api" && pnpm exec ts-node \
  --project tsconfig.app.json \
  --transpile-only \
  scripts/seed-examples.ts)"

# Pino (used by the api package) writes logs to stdout, so they end up
# mixed with our KEY=value lines. Strip ANSI colors and keep only lines
# that look like env-file content (`# comment` or `KEY=value`).
filtered="$(printf '%s\n' "$output" | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E '^(#|[A-Z_][A-Z0-9_]*=)' || true)"
printf '%s\n' "$filtered" | tee "$ENV_FILE"
echo "[setup] wrote $ENV_FILE" >&2
