#!/bin/sh
set -e

# Wait for vault to be ready and root token file to exist
if [ "$VAULT_ENCRYPTION_SERVICE" = "hashcorp" ]; then
  echo "Waiting for Vault root token file to be available..."
  ROOT_TOKEN_FILE="/vault/config/root-token.txt"
  MAX_WAIT=60
  WAIT_COUNT=0
  
  while [ ! -f "$ROOT_TOKEN_FILE" ] && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    echo "Root token file not found. Waiting... ($WAIT_COUNT/$MAX_WAIT)"
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))
  done
  
  if [ ! -f "$ROOT_TOKEN_FILE" ]; then
    echo "Error: Root token file not found after waiting $MAX_WAIT seconds"
    exit 1
  fi
  
  echo "Waiting for Vault to be ready..."
  until vault status -address="$VAULT_HASHCORP_ADDR" > /dev/null 2>&1; do
    echo "Vault is not ready yet. Waiting..."
    sleep 2
  done
  
  echo "Vault is ready. Running bootstrap script..."
  /app/script/bootstrap.sh
  
  # Source the exported environment variables and ensure they're exported
  if [ -f /tmp/vault-env.sh ]; then
    echo "Loading Vault environment variables..."
    . /tmp/vault-env.sh
    # Ensure variables are exported (they should be from the sourced file, but be explicit)
    export VAULT_HASHCORP_APPROLE_ROLE_ID
    export VAULT_HASHCORP_APPROLE_SECRET_ID
  fi
else
  echo "VAULT_ENCRYPTION_SERVICE is not 'hashcorp', skipping bootstrap..."
fi

# Execute the main application
exec "$@"

