#!/bin/sh
set -e

echo "Installing jq..."
apk update
apk add jq

vault server -config=/vault/config/vault.hcl &
VAULT_PID=$!
sleep 3

export VAULT_ADDR=http://127.0.0.1:8200

# Check if Vault is initialized
if vault status | grep -q "Initialized.*false"; then
  echo "Initializing Vault..."
  # Initialize with a single unseal key
  INIT_OUTPUT=$(vault operator init -key-shares=1 -key-threshold=1 -format=json)
  echo "$INIT_OUTPUT" > /vault/config/vault-init.out
  UNSEAL_KEY=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
  ROOT_TOKEN=$(echo "$INIT_OUTPUT" | jq -r '.root_token')
  
  echo "Unsealing Vault..."
  vault operator unseal "$UNSEAL_KEY"
  
  echo "Logging in with root token..."
  vault login "$ROOT_TOKEN"
  
  # Set the root token to "root" if it's not already
  if [ "$ROOT_TOKEN" != "root" ]; then
    vault token create -id=root -policy=root -orphan || true
    vault login root
    vault token revoke "$ROOT_TOKEN" || true
  fi
else
  # Vault is already initialized, check if it's sealed
  if vault status | grep -q "Sealed.*true"; then
    echo "Vault is sealed. Unsealing..."
    INIT_OUTPUT=$(cat /vault/config/vault-init.out)
    UNSEAL_KEY=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
    vault operator unseal "$UNSEAL_KEY"
  fi
  
  # Try to login with root token
  vault login root || {
    echo "Root token not working. Vault may need to be unsealed or reinitialized."
    exit 1
  }
fi

vault secrets enable transit || true

if ! vault read transit/keys/autounseal > /dev/null 2>&1; then
   vault write -f transit/keys/autounseal || true
   vault policy write autounseal -<<EOF
path "transit/encrypt/autounseal" {
   capabilities = [ "update" ]
}

path "transit/decrypt/autounseal" {
   capabilities = [ "update" ]
}
EOF
else
   echo "Autounseal key already exists"
fi

wait $VAULT_PID
