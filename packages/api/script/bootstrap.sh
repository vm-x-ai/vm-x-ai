#!/bin/bash

VAULT_ADDR=${VAULT_HASHCORP_ADDR:-"http://localhost:8200"}

# Detect if running in Docker or locally
if [ -f "/vault/config/root-token.txt" ]; then
  # Running in Docker
  ROOT_TOKEN_FILE="/vault/config/root-token.txt"
  POLICY_FILE="/app/script/vault/policy.hcl"
  VAULT_ENV_FILE="/tmp/vault-env.sh"
  WORK_DIR="/app"
else
  # Running locally
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT_TOKEN_FILE="$SCRIPT_DIR/../../../docker/vault/config/root-token.txt"
  POLICY_FILE="$SCRIPT_DIR/vault/policy.hcl"
  VAULT_ENV_FILE=""
  WORK_DIR="$SCRIPT_DIR/.."
fi

export VAULT_ADDR="$VAULT_ADDR"

if [ ! -f "$ROOT_TOKEN_FILE" ]; then
  echo "Error: Root token file not found at $ROOT_TOKEN_FILE"
  exit 1
fi

export VAULT_TOKEN=$(cat "$ROOT_TOKEN_FILE")

if [ ! -f "$POLICY_FILE" ]; then
  echo "Error: Policy file not found at $POLICY_FILE"
  exit 1
fi

cd "$WORK_DIR"

echo "Writing VMXAI policy..."
vault policy write vmxai-policy "$POLICY_FILE"

echo "Enabling Approle authentication..."
if vault auth list | grep -q "^approle/"; then
    echo "Approle authentication already enabled"
else
    vault auth enable approle
fi

if vault read auth/approle/role/vmxai-app/role-id > /dev/null 2>&1; then
    echo "VMXAI approle role already exists"
else
  echo "Writing VMXAI approle role..."
  vault write auth/approle/role/vmxai-app \
      token_policies="vmxai-policy" \
      token_ttl=1h \
      token_max_ttl=4h
fi

if vault read transit/keys/vmxai-key > /dev/null 2>&1; then
    echo "VMXAI key already exists"
else
    echo "Writing VMXAI key..."
    if ! vault secrets list | grep -q "^transit/"; then
        vault secrets enable transit
    fi
    vault write -f transit/keys/vmxai-key type=aes256-gcm96
fi

# Enable KV v2 secrets engine if not already enabled
if vault secrets list | grep -q "^secret/"; then
    echo "KV v2 secrets engine already enabled at secret/"
else
    echo "Enabling KV v2 secrets engine at secret/..."
    vault secrets enable -version=2 -path=secret kv
fi

VAULT_HASHCORP_APPROLE_ROLE_ID=$(vault read auth/approle/role/vmxai-app/role-id --format=json | jq -r '.data.role_id')
VAULT_HASHCORP_APPROLE_SECRET_ID=$(vault write -f auth/approle/role/vmxai-app/secret-id --format=json | jq -r '.data.secret_id')

# Export the variables
export VAULT_HASHCORP_APPROLE_ROLE_ID
export VAULT_HASHCORP_APPROLE_SECRET_ID

echo "VAULT_HASHCORP_APPROLE_ROLE_ID=$VAULT_HASHCORP_APPROLE_ROLE_ID"
echo "VAULT_HASHCORP_APPROLE_SECRET_ID=$VAULT_HASHCORP_APPROLE_SECRET_ID"

# Write to environment file for Docker, or .env.local for local
if [ -n "$VAULT_ENV_FILE" ]; then
  # Running in Docker - write to file that can be sourced
  echo "export VAULT_HASHCORP_APPROLE_ROLE_ID=\"$VAULT_HASHCORP_APPROLE_ROLE_ID\"" > "$VAULT_ENV_FILE"
  echo "export VAULT_HASHCORP_APPROLE_SECRET_ID=\"$VAULT_HASHCORP_APPROLE_SECRET_ID\"" >> "$VAULT_ENV_FILE"
  echo "Environment variables exported to $VAULT_ENV_FILE"
else
  # Running locally - write to .env.local
  echo "Setting VAULT_HASHCORP_APPROLE_ROLE_ID and VAULT_HASHCORP_APPROLE_SECRET_ID in .env.local..."
  
  # Ensure .env.local exists
  touch .env.local
  
  # Function to set or update a variable in .env.local
  set_env_var() {
    local var="$1"
    local value="$2"
    if grep -q "^${var}=" .env.local; then
      # Update existing variable
      sed -i.bak "s|^${var}=.*|${var}=${value}|" .env.local
      rm -f .env.local.bak
    else
      # Add variable
      echo "${var}=${value}" >> .env.local
    fi
  }
  
  set_env_var "VAULT_HASHCORP_APPROLE_ROLE_ID" "$VAULT_HASHCORP_APPROLE_ROLE_ID"
  set_env_var "VAULT_HASHCORP_APPROLE_SECRET_ID" "$VAULT_HASHCORP_APPROLE_SECRET_ID"
fi
