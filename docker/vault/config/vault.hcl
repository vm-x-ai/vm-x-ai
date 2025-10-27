storage "postgresql" {
  connection_url = "postgresql://admin:password@postgres:5432/vmxai?sslmode=disable&search_path=vault"
  # Use SSL in production environments with appropriate configuration
}

# Unseal with your Cloud provider for Production (e.g. AWS KMS)
seal "transit" {
  address         = "http://vault-kms:8200"
  token           = "root"
  key_name        = "autounseal"
  mount_path      = "transit/"
  tls_skip_verify = "true"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = "true"
}

ui = true
