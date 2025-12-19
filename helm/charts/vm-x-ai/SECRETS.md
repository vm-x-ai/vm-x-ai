# Production Secret Management Guide

## ⚠️ Security Warning

**Never store secrets in `values.yaml` or commit them to version control!**

The Helm chart supports multiple production-safe methods for managing secrets.

## Recommended Approaches

### 1. External Secrets Operator (Recommended)

The External Secrets Operator syncs secrets from external secret management systems (AWS Secrets Manager, HashiCorp Vault, Google Secret Manager, etc.) into Kubernetes secrets.

#### Setup

1. Install External Secrets Operator:
```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets-system --create-namespace
```

2. Create a SecretStore (example for AWS Secrets Manager):
```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  namespace: vm-x-ai
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
```

3. Configure the Helm chart:
```yaml
secrets:
  database:
    method: eso
    externalSecrets:
      secretKey: "vmxai/production/postgresql"
      passwordKey: "password"
      hostKey: "host"
      portKey: "port"
      databaseKey: "database"
      usernameKey: "username"
  questdb:
    method: eso
    externalSecrets:
      secretKey: "vmxai/production/questdb"
      passwordKey: "password"
      hostKey: "host"
      portKey: "port"
      databaseKey: "database"
      usernameKey: "username"
  ui:
    method: eso
    externalSecrets:
      secretKey: "vmxai/production/ui"
      authSecretKey: "auth-secret"
  libsodium:
    method: eso
    externalSecrets:
      secretKey: "vmxai/production/libsodium-key"
      encryptionKeyKey: "encryption-key"
  # External Secrets Operator configuration (shared for all secrets using method: "eso")
  externalSecrets:
    enabled: true
    secretStore:
      name: aws-secrets-manager
      kind: SecretStore
```

### 2. Reference Existing Secrets

If you manage secrets separately (via CI/CD, manual creation, or other tools):

```yaml
secrets:
  database:
    method: external
    external:
      secretName: "postgresql-credentials"
      passwordKey: "password"
      hostKey: "host"  # Optional, only if using external PostgreSQL
      portKey: "port"  # Optional, only if using external PostgreSQL
      databaseKey: "database"  # Optional, only if using external PostgreSQL
      usernameKey: "username"  # Optional, only if using external PostgreSQL
  questdb:
    method: external
    external:
      secretName: "questdb-credentials"
      passwordKey: "password"
      hostKey: "host"  # Optional, only if using external QuestDB
      portKey: "port"  # Optional, only if using external QuestDB
      databaseKey: "database"  # Optional, only if using external QuestDB
      usernameKey: "username"  # Optional, only if using external QuestDB
  ui:
    method: external
    external:
      secretName: "ui-auth-secret"
      authSecretKey: "auth-secret"
  libsodium:
    method: external
    external:
      secretName: "libsodium-encryption-key"
      encryptionKeyKey: "encryption-key"
```

Create secrets separately:
```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=password='your-secure-password' \
  --namespace vm-x-ai

kubectl create secret generic questdb-credentials \
  --from-literal=password='your-secure-password' \
  --from-literal=host='questdb.example.com' \
  --from-literal=port='8812' \
  --from-literal=database='vmxai' \
  --from-literal=username='admin' \
  --namespace vm-x-ai

kubectl create secret generic ui-auth-secret \
  --from-literal=auth-secret='your-auth-secret' \
  --namespace vm-x-ai
```

### 3. Sealed Secrets

If using Bitnami Sealed Secrets:

1. Create sealed secrets:
```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=password='your-password' \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > postgresql-credentials-sealed.yaml
```

2. Apply sealed secrets:
```bash
kubectl apply -f postgresql-credentials-sealed.yaml
```

3. Reference in values:
```yaml
secrets:
  database:
    method: external
    external:
      secretName: "postgresql-credentials"
      passwordKey: "password"
```

## Development vs Production

### Development (Minikube/Local)

For development, auto-generation is acceptable:

```yaml
secrets:
  database:
    method: create
  questdb:
    method: create
  ui:
    method: create
  libsodium:
    method: create
```

### Production

**Always use external secrets or External Secrets Operator for sensitive secrets:**

```yaml
secrets:
  database:
    method: eso  # or "external"
    # ... configuration
  questdb:
    method: eso  # or "external"
    # ... configuration
  ui:
    method: create  # Less sensitive, can auto-generate
  libsodium:
    method: eso  # or "external" if using libsodium provider
    # ... configuration
```

**Note:** You can mix methods for different secrets. For example, use External Secrets Operator for the database while auto-generating the UI auth secret.

## Secret Rotation

### With External Secrets Operator

Secrets are automatically synced based on `refreshInterval`. Update the secret in your external system, and it will be synced to Kubernetes.

### With External Secrets

Manually update the Kubernetes secret:
```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=password='new-password' \
  --dry-run=client -o yaml | \
  kubectl apply -f -
```

Restart pods to pick up new secrets:
```bash
kubectl rollout restart deployment/vm-x-ai-api -n vm-x-ai
```

## Best Practices

1. **Never commit secrets to Git** - Use `.gitignore` for values files containing secrets
2. **Use secret management systems** - AWS Secrets Manager, HashiCorp Vault, etc.
3. **Enable secret rotation** - Regularly rotate secrets
4. **Use RBAC** - Limit who can read secrets
5. **Audit secret access** - Monitor who accesses secrets
6. **Encrypt at rest** - Ensure etcd encryption is enabled
7. **Use separate secrets per environment** - Don't share secrets between dev/prod

## Troubleshooting

### Secrets not found

Check if secrets exist:
```bash
kubectl get secrets -n vm-x-ai
```

### External Secrets Operator not syncing

Check ExternalSecret status:
```bash
kubectl get externalsecrets -n vm-x-ai
kubectl describe externalsecret vm-x-ai-database -n vm-x-ai
```

### Pods failing to start

Check pod events:
```bash
kubectl describe pod <pod-name> -n vm-x-ai
```

Look for errors related to secret mounting or environment variables.

