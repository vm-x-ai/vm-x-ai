path "transit/encrypt/vmxai-key" {
  capabilities = ["update"]
}

path "transit/decrypt/vmxai-key" {
  capabilities = ["update"]
}

path "transit/rewrap/vmxai-key" {
  capabilities = ["update"]
}

path "secret/data/oidc/provider/jwks" {
  capabilities = ["create", "read", "update"]
}

path "secret/data/oidc/provider/cookie-keys" {
  capabilities = ["create", "read", "update"]
}
