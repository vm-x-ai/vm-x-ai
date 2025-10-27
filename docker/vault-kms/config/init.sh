#!/bin/sh
set -e

vault server -dev -dev-root-token-id=root -config=/vault/config/vault.hcl &
sleep 3

export VAULT_ADDR=http://127.0.0.1:8200
vault login root
vault secrets enable transit || true
vault write -f transit/keys/autounseal || true
vault policy write autounseal -<<EOF
path "transit/encrypt/autounseal" {
   capabilities = [ "update" ]
}

path "transit/decrypt/autounseal" {
   capabilities = [ "update" ]
}
EOF

wait
