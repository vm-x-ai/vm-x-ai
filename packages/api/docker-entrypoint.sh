#!/bin/sh
set -e

# Wait for vault to be ready and root token file to exist
if [ "$VAULT_ENCRYPTION_SERVICE" = "hashcorp" ]; then
  echo "Waiting for Vault to be ready..."
  MAX_WAIT=120
  WAIT_COUNT=0
  
  until vault status -address="$VAULT_HASHCORP_ADDR" > /dev/null 2>&1; do
    if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
      echo "Error: Vault is not ready after $MAX_WAIT seconds"
      exit 1
    fi
    echo "Vault is not ready yet. Waiting... ($WAIT_COUNT/$MAX_WAIT)"
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))
  done
  
  echo "Vault is ready."
  
  # Determine if we're in Kubernetes or local Docker environment
  # In Kubernetes, VAULT_HASHCORP_APPROLE_ROLE_ID and VAULT_HASHCORP_APPROLE_SECRET_ID
  # are typically provided via secrets/environment variables
  # In local Docker, we need to bootstrap and get them from the bootstrap script
  
  # Check if role-id and secret-id are already provided (Kubernetes mode)
  if [ -n "$VAULT_HASHCORP_APPROLE_ROLE_ID" ] && [ -n "$VAULT_HASHCORP_APPROLE_SECRET_ID" ]; then
    echo "Vault AppRole credentials already provided (Kubernetes mode), skipping bootstrap..."
  else
    # Local Docker mode - need to bootstrap
    echo "Vault AppRole credentials not found, running bootstrap script..."
    
    # Check for root token in various locations
    ROOT_TOKEN=""
    
    # 1. Check environment variable (Kubernetes secret)
    if [ -n "$VAULT_ROOT_TOKEN" ]; then
      ROOT_TOKEN="$VAULT_ROOT_TOKEN"
      echo "Using root token from VAULT_ROOT_TOKEN environment variable"
    # 2. Check mounted secret file (Kubernetes)
    elif [ -f "/vault/secrets/root-token" ]; then
      ROOT_TOKEN=$(cat /vault/secrets/root-token)
      echo "Using root token from /vault/secrets/root-token"
    # 3. Check config file (local Docker)
    elif [ -f "/vault/config/root-token.txt" ]; then
      ROOT_TOKEN=$(cat /vault/config/root-token.txt)
      echo "Using root token from /vault/config/root-token.txt"
    else
      echo "Error: Vault root token not found in any expected location"
      echo "Please provide VAULT_ROOT_TOKEN environment variable or mount root token file"
      exit 1
    fi
    
    # Export root token for bootstrap script
    export VAULT_TOKEN="$ROOT_TOKEN"
    
    # Run bootstrap script
    /app/script/bootstrap.sh
    
    # Source the exported environment variables and ensure they're exported
    if [ -f /tmp/vault-env.sh ]; then
      echo "Loading Vault environment variables from bootstrap script..."
      . /tmp/vault-env.sh
      # Ensure variables are exported (they should be from the sourced file, but be explicit)
      export VAULT_HASHCORP_APPROLE_ROLE_ID
      export VAULT_HASHCORP_APPROLE_SECRET_ID
    fi
  fi
else
  echo "VAULT_ENCRYPTION_SERVICE is not 'hashcorp', skipping bootstrap..."
fi

# Execute the main application
exec "$@"

