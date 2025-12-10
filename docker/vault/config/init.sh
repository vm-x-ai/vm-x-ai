#!/bin/sh

apk add postgresql-client

set -e
echo "Creating vault schema..."

export PGPASSWORD="$DB_PASSWORD"
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f /vault/config/init.sql
echo "Vault schema created successfully"

echo "Starting vault server..."
vault server -config=/vault/config/vault.hcl &

export VAULT_ADDR=http://127.0.0.1:8200
echo "Waiting for vault server to be ready..."
sleep 3

echo "Vault server is ready"

if [ ! -f /vault/config/vault-init.out ]; then
  vault operator init > /vault/config/vault-init.out || true
  grep 'Initial Root Token:' /vault/config/vault-init.out | awk '{print $NF}' > /vault/config/root-token.txt || true
else
  echo "Vault already initialized, skipping init"
fi


echo "Vault unsealed successfully"
wait
