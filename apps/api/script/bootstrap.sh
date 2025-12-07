#!/bin/bash

export VAULT_ADDR=http://localhost:8200
export VAULT_TOKEN=$(cat ../../docker/vault/config/root-token.txt)

echo "Writing VMXAI policy..."
vault policy write vmxai-policy ./src/vault/hashcorp/policy.hcl

echo "Enabling Approle authentication..."
vault auth enable approle

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
    vault secrets enable transit
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

echo "Appending .env.local with VAULT_APPROLE_ROLE_ID and VAULT_APPROLE_SECRET_ID..."
echo "VAULT_HASHCORP_APPROLE_ROLE_ID=$VAULT_HASHCORP_APPROLE_ROLE_ID" >> .env.local
echo "VAULT_HASHCORP_APPROLE_SECRET_ID=$VAULT_HASHCORP_APPROLE_SECRET_ID" >> .env.local
