# VM-X AI Helm Chart

A production-ready Helm chart for deploying the VM-X AI Application, including UI, API, and all required infrastructure components.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- kubectl configured to access your Kubernetes cluster

## Installation

### Quick Start

```bash
# Install with default values
helm install vm-x-ai ./helm/vm-x-ai

# Install with custom values
helm install vm-x-ai ./helm/vm-x-ai -f my-values.yaml

# Install in a specific namespace
helm install vm-x-ai ./helm/vm-x-ai --namespace vm-x-ai --create-namespace
```

### Default Configuration

By default, the chart deploys:
- **API**: 2 replicas
- **UI**: 2 replicas
- **PostgreSQL**: Single instance with persistence
- **Redis**: Single node with persistence
- **QuestDB**: Single instance with persistence
- **Hashcorp Vault**: With self-sealed mode (useful for development/Minikube)
- **OTEL Services**: Disabled by default

## Configuration

### Ingress Type Selection

The chart supports two ingress options:

1. **Nginx Ingress** (default) - Standard Kubernetes Ingress, simpler setup
2. **Istio** - Service mesh with advanced features (recommended for production)

**When to use Istio:**
- Production environments requiring advanced traffic management
- Need for canary deployments, A/B testing, or traffic splitting
- Requirement for automatic mTLS between services
- Need for advanced observability (Kiali, distributed tracing)
- Complex routing requirements (header-based, weight-based)

**When to use Nginx:**
- Simpler deployments
- Development/test environments
- When Istio is not available or desired
- Basic ingress requirements

See the Ingress Configuration section below for examples.

### Vault Provider Selection

You can choose between Hashcorp Vault or AWS KMS for encryption:

```yaml
api:
  vault:
    encryptionService: hashcorp  # or "aws-kms"
    
    # For Hashcorp Vault
    hashcorp:
      addr: ""  # Auto-configured if vault is enabled
    
    # For AWS KMS
    awsKms:
      keyId: "arn:aws:kms:region:account:key/key-id"
```

### Timeseries Database Selection

Choose between QuestDB or AWS Timestream:

```yaml
api:
  timeseriesDb:
    provider: questdb  # or "aws-timestream"
    
    # For QuestDB
    questdb:
      host: ""  # Auto-configured if questdb is enabled
      port: 8812
      user: admin
      password: ""  # Auto-generated
      dbName: vmxai
    
    # For AWS Timestream
    awsTimestream:
      databaseName: "your-database-name"
```

### Redis Configuration

Choose between single-node or cluster mode:

```yaml
redis:
  enabled: true
  mode: single  # or "cluster"
  
  # Single node configuration
  single:
    persistence:
      enabled: true
      size: 10Gi
  
  # Cluster configuration
  cluster:
    nodes: 3
    replicas: 0
    persistence:
      enabled: true
      size: 10Gi
```

### Using External Services

#### External PostgreSQL

```yaml
postgresql:
  enabled: false
  external:
    host: "postgres.example.com"
    port: 5432
    database: "vmxai"
    username: "admin"
    password: ""  # Set via secret
```

#### External Redis

```yaml
redis:
  enabled: false
  external:
    host: "redis.example.com"
    port: 6379
    # For cluster mode
    nodes:
      - host: "redis-1.example.com"
        port: 6379
      - host: "redis-2.example.com"
        port: 6379
```

### Hashcorp Vault Self-Sealed Mode

For development or Minikube environments, you can enable self-sealed mode:

```yaml
vault:
  enabled: true
  selfSealed: true  # Enables auto-unsealing via transit key
  storage: file  # or "postgres"
```

**Note**: Self-sealed mode is not recommended for production. In production, use external unsealing mechanisms or AWS KMS.

### OpenTelemetry Services

Enable OTEL services for observability:

```yaml
otel:
  enabled: true
  
  collector:
    enabled: true
  
  jaeger:
    enabled: true
  
  prometheus:
    enabled: true
  
  loki:
    enabled: true
  
  grafana:
    enabled: true
```

### Ingress Configuration

You can choose between **Nginx Ingress** (standard Kubernetes Ingress) or **Istio** (service mesh with Gateway and VirtualService).

#### Nginx Ingress (Standard)

```yaml
ingress:
  type: nginx
  enabled: true
  nginx:
    className: "nginx"
    annotations:
      cert-manager.io/cluster-issuer: "letsencrypt-prod"
    hosts:
      - host: vm-x-ai.example.com
        paths:
          - path: /
            pathType: Prefix
            service: ui
          - path: /api
            pathType: Prefix
            service: api
    tls:
      - secretName: vm-x-ai-tls
        hosts:
          - vm-x-ai.example.com
```

#### Istio (Service Mesh) - Recommended for Production

Istio provides advanced features beyond simple ingress:
- **Service Mesh**: Automatic mTLS between services
- **Traffic Management**: Advanced routing, canary deployments, circuit breakers
- **Observability**: Integrated with Kiali, Grafana, Prometheus
- **Security**: Fine-grained access control, rate limiting

```yaml
ingress:
  type: istio
  enabled: true
  istio:
    gateway:
      name: vm-x-ai-gateway
      namespace: istio-system
      selector:
        istio: ingressgateway
      servers:
        - port:
            number: 80
            name: http
            protocol: HTTP
          hosts:
            - vm-x-ai.example.com
        - port:
            number: 443
            name: https
            protocol: HTTPS
          tls:
            mode: SIMPLE
            credentialName: vm-x-ai-tls  # Secret in istio-system namespace
          hosts:
            - vm-x-ai.example.com
    
    virtualService:
      hosts:
        - vm-x-ai.example.com
      gateways:
        - istio-system/vm-x-ai-gateway
      
      # Optional: Traffic management policies
      trafficPolicy:
        loadBalancer:
          simple: LEAST_CONN
        connectionPool:
          tcp:
            maxConnections: 100
        outlierDetection:
          consecutiveErrors: 3
          interval: 30s
```

**Prerequisites for Istio:**
- Istio must be installed in your cluster
- Gateway should be deployed in `istio-system` namespace
- TLS secret should exist in `istio-system` namespace

See `values-istio.yaml` for a complete example.

### Secrets Management

**⚠️ IMPORTANT: Never store secrets in values.yaml for production!**

The chart supports three methods for secret management:

#### Method 1: Auto-generate (Development Only)

For development/testing only. Secrets are auto-generated:

```yaml
secrets:
  method: create
```

#### Method 2: External Secrets (Production-Safe)

Reference existing Kubernetes secrets that you manage separately:

```yaml
secrets:
  method: external
  external:
    database:
      secretName: "postgresql-credentials"  # Existing secret name
      passwordKey: "password"  # Key name in the secret
    questdb:
      secretName: "questdb-credentials"
      passwordKey: "password"
    ui:
      secretName: "ui-auth-secret"
      authSecretKey: "auth-secret"
    vault:
      secretName: "vault-root-token"
      rootTokenKey: "root-token"
```

**Create secrets separately:**
```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=password='your-password'

kubectl create secret generic questdb-credentials \
  --from-literal=password='your-password'
```

#### Method 3: External Secrets Operator (Production-Safe, Recommended)

Use External Secrets Operator to sync secrets from external systems (AWS Secrets Manager, HashiCorp Vault, etc.):

```yaml
secrets:
  method: eso
  externalSecrets:
    enabled: true
    secretStore:
      name: "aws-secrets-manager"
      kind: SecretStore  # or ClusterSecretStore
    database:
      secretKey: "vmxai/production/postgresql"
      passwordKey: "password"
    questdb:
      secretKey: "vmxai/production/questdb"
      passwordKey: "password"
    ui:
      secretKey: "vmxai/production/ui"
      authSecretKey: "auth-secret"
```

**Prerequisites:**
- External Secrets Operator installed in cluster
- SecretStore configured to access your secret management system

See [External Secrets Operator documentation](https://external-secrets.io/) for setup instructions.

**For detailed secret management guidance, see [SECRETS.md](SECRETS.md).**

## Production Considerations

### Security

1. **Vault**: Do not use self-sealed mode in production. Configure proper unsealing mechanisms.
2. **Secrets**: **CRITICAL** - Never store secrets in `values.yaml`. Use External Secrets Operator or reference existing secrets. See [SECRETS.md](SECRETS.md) for detailed guidance.
3. **TLS**: Enable TLS for all services and use proper certificate management.
4. **Network Policies**: Implement network policies to restrict pod-to-pod communication.
5. **RBAC**: Use least-privilege access control for service accounts.
6. **Secret Rotation**: Implement regular secret rotation policies.

### High Availability

1. **API/UI**: Increase replica counts and configure pod disruption budgets.
2. **PostgreSQL**: Consider using a managed database service or PostgreSQL operator for HA.
3. **Redis**: Use cluster mode for production with proper persistence.
4. **QuestDB**: Consider using a managed timeseries database service for production.

### Resource Management

Adjust resource requests and limits based on your workload:

```yaml
api:
  resources:
    requests:
      cpu: 1000m
      memory: 1Gi
    limits:
      cpu: 4000m
      memory: 4Gi
```

### Persistence

Ensure proper storage classes are configured for persistent volumes:

```yaml
postgresql:
  persistence:
    storageClass: "fast-ssd"
    
redis:
  single:
    persistence:
      storageClass: "fast-ssd"
```

## Troubleshooting

### Vault Bootstrap Issues

If the vault bootstrap job fails:

1. Check if vault is unsealed:
   ```bash
   kubectl exec -it <vault-pod> -- vault status
   ```

2. Manually update the approle secret:
   ```bash
   # Get credentials from bootstrap job logs
   kubectl logs <vault-bootstrap-job>
   
   # Update secret manually
   kubectl patch secret <release-name>-vault-approle \
     --type=json \
     -p='[{"op":"replace","path":"/data/role-id","value":"<base64-role-id>"},{"op":"replace","path":"/data/secret-id","value":"<base64-secret-id>"}]'
   ```

### API Not Connecting to Services

1. Check service endpoints:
   ```bash
   kubectl get endpoints
   ```

2. Verify DNS resolution:
   ```bash
   kubectl exec -it <api-pod> -- nslookup <service-name>
   ```

### Redis Cluster Issues

If using Redis cluster mode, ensure the cluster init job completes successfully:

```bash
kubectl logs <redis-cluster-init-job>
```

## Uninstallation

```bash
helm uninstall vm-x-ai

# Remove persistent volumes (optional)
kubectl delete pvc -l app.kubernetes.io/instance=vm-x-ai
```

## Values Reference

See [values.yaml](values.yaml) for all available configuration options.

## Support

For issues and questions, please refer to the project repository.

