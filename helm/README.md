# VM-X AI Helm Chart

A production-ready Helm chart for deploying the VM-X AI Application, including UI, API, and all required infrastructure components.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- kubectl configured to access your Kubernetes cluster

## Installation

### Quick Start

```bash
kubectl create namespace vm-x-ai
kubectl label namespace vm-x-ai istio-injection=enabled

# Install with default values
helm install vm-x-ai ./helm --namespace vm-x-ai

# Install with custom values
helm install vm-x-ai ./helm -f my-values.yaml --namespace vm-x-ai
```

### Default Configuration

By default, the chart deploys:
- **API**: 2 replicas
- **UI**: 2 replicas
- **PostgreSQL**: Single instance with persistence
- **Redis**: Single node with persistence
- **QuestDB**: Single instance with persistence
- **Encryption**: Libsodium (default, for local/small deployments)
- **OTEL Services**: Disabled by default

## Configuration

### Ingress Configuration

The chart uses **Istio Gateway and VirtualService** for ingress. Istio provides:
- Advanced traffic management (canary deployments, A/B testing, traffic splitting)
- Automatic mTLS between services
- Advanced observability (Kiali, distributed tracing)
- Complex routing requirements (header-based, weight-based)
- Circuit breakers and connection pooling

See the Ingress Configuration section below for examples.

### Encryption Provider Selection

You can choose between **Libsodium** (default, for local/small deployments) or **AWS KMS** (recommended for production):

```yaml
api:
  encryption:
    provider: libsodium  # libsodium or aws-kms
    
    # For Libsodium (default)
    # Encryption key will be auto-generated if not provided via secrets
    libsodium:
      encryptionKey: ""  # Will be set from secrets
    
    # For AWS KMS (production)
    awsKms:
      keyId: "arn:aws:kms:region:account:key/key-id"
```

**Libsodium** is suitable for:
- Local development and testing
- Small deployments
- Non-production environments
- When AWS KMS is not available

**AWS KMS** is recommended for:
- Production environments
- Compliance requirements
- High-security deployments
- Enterprise use cases

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

The chart uses **Istio Gateway and VirtualService** for ingress. Istio provides:
- **Service Mesh**: Automatic mTLS between services
- **Traffic Management**: Advanced routing, canary deployments, circuit breakers
- **Observability**: Integrated with Kiali, Grafana, Prometheus
- **Security**: Fine-grained access control, rate limiting

#### API Base Path

You can configure a custom base path for the API using `api.env.BASE_PATH`. If set, the API will be accessible at that path. If not set, it defaults to `/api` for backward compatibility.

```yaml
api:
  env:
    BASE_PATH: "/api"  # Optional: API will be accessible at /api/v1 instead of /v1
```

#### Istio Configuration

```yaml
ingress:
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
          consecutive5xxErrors: 3
          interval: 30s
```

**Prerequisites for Istio:**
- Istio must be installed in your cluster
- Gateway should be deployed in `istio-system` namespace
- TLS secret should exist in `istio-system` namespace

### Secrets Management

**⚠️ IMPORTANT: Never store secrets in values.yaml for production!**

The chart supports three methods for secret management, and **each secret can have its own method**. This allows you to, for example, use External Secrets Operator for the database while auto-generating the UI auth secret.

#### Method 1: Auto-generate (Development Only)

For development/testing only. Secrets are auto-generated:

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

#### Method 2: External Secrets (Production-Safe)

Reference existing Kubernetes secrets that you manage separately:

```yaml
secrets:
  database:
    method: external
    external:
      secretName: "postgresql-credentials"  # Existing secret name
      passwordKey: "password"  # Key name in the secret
      hostKey: "host"  # Optional, only if using external PostgreSQL
      portKey: "port"  # Optional, only if using external PostgreSQL
      databaseKey: "database"  # Optional, only if using external PostgreSQL
      usernameKey: "username"  # Optional, only if using external PostgreSQL
  questdb:
    method: external
    external:
      secretName: "questdb-credentials"
      passwordKey: "password"
  ui:
    method: create
  libsodium:
    # Only needed if api.encryption.provider is libsodium
    method: create
```

**Create secrets separately:**
```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=password='your-password'

kubectl create secret generic questdb-credentials \
  --from-literal=password='your-password'
```

#### Method 3: External Secrets Operator (Production-Safe, Recommended)

Use External Secrets Operator to sync secrets from external systems (AWS Secrets Manager, etc.):

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
  ui:
    method: create
    externalSecrets:
  libsodium:
    method: create
  # External Secrets Operator configuration (shared for all secrets using method: "eso")
  externalSecrets:
    enabled: true  # Set to true if any secret uses method: "eso"
    secretStore:
      name: "aws-secrets-manager"
      kind: SecretStore  # or ClusterSecretStore
```

**Prerequisites:**
- External Secrets Operator installed in cluster
- SecretStore configured to access your secret management system

See [External Secrets Operator documentation](https://external-secrets.io/) for setup instructions.

**For detailed secret management guidance, see [SECRETS.md](SECRETS.md).**

## Production Considerations

### Security

1. **Encryption**: Use AWS KMS for production environments. Libsodium is suitable for local testing and small deployments.
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

