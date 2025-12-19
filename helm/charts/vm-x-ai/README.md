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
helm install vm-x-ai ./helm/charts/vm-x-ai --namespace vm-x-ai

# Install with custom values
helm install vm-x-ai ./helm/charts/vm-x-ai -f my-values.yaml --namespace vm-x-ai
```

### Default Configuration

By default, the chart deploys:
- **API**: 1 replicas (with autoscaling enabled: 1-10 replicas based on CPU)
- **UI**: 1 replicas (with autoscaling enabled: 1-10 replicas based on CPU)
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
      secretName: "questdb-credentials"  # Existing secret name
      passwordKey: "password"  # Key name in the secret
      hostKey: "host"  # Optional, only if using external QuestDB
      portKey: "port"  # Optional, only if using external QuestDB
      databaseKey: "database"  # Optional, only if using external QuestDB
      usernameKey: "username"  # Optional, only if using external QuestDB
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
  --from-literal=password='your-password' \
  --from-literal=host='questdb.example.com' \
  --from-literal=port='8812' \
  --from-literal=database='vmxai' \
  --from-literal=username='admin'
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
      hostKey: "host"
      portKey: "port"
      databaseKey: "database"
      usernameKey: "username"
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

### Autoscaling

The chart includes HorizontalPodAutoscaler (HPA) for both API and UI services, enabling automatic scaling based on CPU utilization.

#### Default Autoscaling Configuration

By default, autoscaling is enabled for both services:
- **Min replicas**: 1
- **Max replicas**: 10
- **Target CPU**: 70%
- **Scaling behavior**: Aggressive scale-up, conservative scale-down

#### Customizing Autoscaling

```yaml
api:
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: null  # Optional: enable memory-based scaling
    # Optional: Custom scaling behavior
    behavior:
      scaleDown:
        stabilizationWindowSeconds: 300
        policies:
        - type: Percent
          value: 50
          periodSeconds: 60
      scaleUp:
        stabilizationWindowSeconds: 0
        policies:
        - type: Percent
          value: 100
          periodSeconds: 15

ui:
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

**Note**: When autoscaling is enabled, the HPA will manage replica counts automatically. The static `replicaCount` in the deployment will be overridden by the HPA.

#### Disabling Autoscaling

To disable autoscaling and use static replica counts:

```yaml
api:
  autoscaling:
    enabled: false
  replicaCount: 3  # Static replica count

ui:
  autoscaling:
    enabled: false
  replicaCount: 2  # Static replica count
```

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

**Important**: Resource requests and limits should be properly configured for autoscaling to work effectively. The HPA uses these values to calculate CPU utilization percentages.

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

### Complete Configuration Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| **Global Settings** |
| `global.imageRegistry` | string | `""` | Global Docker image registry |
| `global.imagePullSecrets` | array | `[]` | Global image pull secrets |
| **Images** |
| `images.api.repository` | string | `vmxai/api` | API Docker image repository |
| `images.api.tag` | string | `latest` | API Docker image tag |
| `images.api.pullPolicy` | string | `Always` | API image pull policy |
| `images.ui.repository` | string | `vmxai/ui` | UI Docker image repository |
| `images.ui.tag` | string | `latest` | UI Docker image tag |
| `images.ui.pullPolicy` | string | `Always` | UI image pull policy |
| **API Configuration** |
| `api.enabled` | boolean | `true` | Enable API deployment |
| `api.replicaCount` | integer | `1` | Static replica count (ignored if autoscaling enabled) |
| `api.service.type` | string | `ClusterIP` | API service type |
| `api.service.port` | integer | `3000` | API service port |
| `api.service.targetPort` | integer | `3000` | API container port |
| `api.resources.requests.cpu` | string | `500m` | API CPU request |
| `api.resources.requests.memory` | string | `512Mi` | API memory request |
| `api.resources.limits.cpu` | string | `2000m` | API CPU limit |
| `api.resources.limits.memory` | string | `2Gi` | API memory limit |
| `api.env.LOG_LEVEL` | string | `info` | API log level |
| `api.env.NODE_ENV` | string | `production` | Node environment |
| `api.env.PORT` | integer | `3000` | API port |
| `api.env.BASE_PATH` | string | `""` | API base path prefix |
| `api.env.BASE_URL` | string | `""` | API base URL (auto-set) |
| `api.env.UI_BASE_URL` | string | `""` | UI base URL (auto-set) |
| `api.env.OIDC_PROVIDER_ISSUER` | string | `""` | OIDC provider issuer (auto-set) |
| `api.env.DATABASE_WRITER_POOL_MAX` | integer | `25` | Database writer pool max connections |
| `api.env.DATABASE_READER_POOL_MAX` | integer | `50` | Database reader pool max connections |
| `api.env.BATCH_QUEUE_VISIBILITY_TIMEOUT` | integer | `120000` | Batch queue visibility timeout |
| `api.env.OTEL_TRACES_SAMPLER` | string | `always_on` | OTEL traces sampler |
| `api.encryption.provider` | string | `libsodium` | Encryption provider (`libsodium` or `aws-kms`) |
| `api.encryption.libsodium.encryptionKey` | string | `""` | Libsodium encryption key (from secrets) |
| `api.encryption.awsKms.keyId` | string | `""` | AWS KMS key ID |
| `api.aws.region` | string | `""` | AWS region (required for AWS services) |
| `api.timeseriesDb.provider` | string | `questdb` | Timeseries DB provider (`questdb` or `aws-timestream`) |
| `api.timeseriesDb.questdb.host` | string | `""` | QuestDB host (auto-set when questdb.enabled=true, ignored when using external QuestDB) |
| `api.timeseriesDb.questdb.port` | integer | `8812` | QuestDB port (used when questdb.enabled=true, otherwise uses questdb.external.port) |
| `api.timeseriesDb.questdb.user` | string | `admin` | QuestDB user (used when questdb.enabled=true, otherwise uses questdb.external.username) |
| `api.timeseriesDb.questdb.password` | string | `""` | QuestDB password (always from secrets via secrets.questdb, this value is ignored) |
| `api.timeseriesDb.questdb.dbName` | string | `vmxai` | QuestDB database name (used when questdb.enabled=true, otherwise uses questdb.external.database) |
| `api.timeseriesDb.awsTimestream.databaseName` | string | `""` | AWS Timestream database name |
| `api.oidcFederated.enabled` | boolean | `false` | Enable OIDC federated login |
| `api.oidcFederated.issuer` | string | `""` | OIDC issuer URL |
| `api.oidcFederated.clientId` | string | `""` | OIDC client ID |
| `api.oidcFederated.clientSecret` | string | `""` | OIDC client secret (optional) |
| `api.oidcFederated.scope` | string | `openid profile email` | OIDC scope |
| `api.oidcFederated.defaultRole` | string | `power-user` | Default OIDC role |
| `api.nodeSelector` | object | `{}` | API node selector |
| `api.tolerations` | array | `[]` | API tolerations |
| `api.affinity` | object | `{}` | API affinity rules |
| `api.istio.sidecar.enabled` | boolean | `true` | Enable Istio sidecar for API |
| `api.podDisruptionBudget.enabled` | boolean | `true` | Enable pod disruption budget |
| `api.podDisruptionBudget.minAvailable` | integer | `1` | Minimum available pods |
| `api.healthcheck.enabled` | boolean | `true` | Enable healthchecks |
| `api.healthcheck.liveness.enabled` | boolean | `true` | Enable liveness probe |
| `api.healthcheck.liveness.path` | string | `/healthcheck` | Liveness probe path |
| `api.healthcheck.liveness.initialDelaySeconds` | integer | `30` | Liveness initial delay |
| `api.healthcheck.liveness.periodSeconds` | integer | `10` | Liveness period |
| `api.healthcheck.liveness.timeoutSeconds` | integer | `5` | Liveness timeout |
| `api.healthcheck.liveness.successThreshold` | integer | `1` | Liveness success threshold |
| `api.healthcheck.liveness.failureThreshold` | integer | `3` | Liveness failure threshold |
| `api.healthcheck.readiness.enabled` | boolean | `true` | Enable readiness probe |
| `api.healthcheck.readiness.path` | string | `/healthcheck` | Readiness probe path |
| `api.healthcheck.readiness.initialDelaySeconds` | integer | `10` | Readiness initial delay |
| `api.healthcheck.readiness.periodSeconds` | integer | `5` | Readiness period |
| `api.healthcheck.readiness.timeoutSeconds` | integer | `3` | Readiness timeout |
| `api.healthcheck.readiness.successThreshold` | integer | `1` | Readiness success threshold |
| `api.healthcheck.readiness.failureThreshold` | integer | `3` | Readiness failure threshold |
| `api.healthcheck.startup.enabled` | boolean | `true` | Enable startup probe |
| `api.healthcheck.startup.path` | string | `/healthcheck` | Startup probe path |
| `api.healthcheck.startup.initialDelaySeconds` | integer | `0` | Startup initial delay |
| `api.healthcheck.startup.periodSeconds` | integer | `5` | Startup period |
| `api.healthcheck.startup.timeoutSeconds` | integer | `3` | Startup timeout |
| `api.healthcheck.startup.successThreshold` | integer | `1` | Startup success threshold |
| `api.healthcheck.startup.failureThreshold` | integer | `30` | Startup failure threshold |
| `api.autoscaling.enabled` | boolean | `true` | Enable autoscaling |
| `api.autoscaling.minReplicas` | integer | `1` | Minimum replicas |
| `api.autoscaling.maxReplicas` | integer | `10` | Maximum replicas |
| `api.autoscaling.targetCPUUtilizationPercentage` | integer | `70` | Target CPU utilization percentage |
| `api.autoscaling.targetMemoryUtilizationPercentage` | integer | `null` | Target memory utilization percentage (optional) |
| `api.autoscaling.behavior` | object | `null` | Custom scaling behavior (optional) |
| **UI Configuration** |
| `ui.enabled` | boolean | `true` | Enable UI deployment |
| `ui.replicaCount` | integer | `1` | Static replica count (ignored if autoscaling enabled) |
| `ui.service.type` | string | `ClusterIP` | UI service type |
| `ui.service.port` | integer | `3001` | UI service port |
| `ui.service.targetPort` | integer | `3001` | UI container port |
| `ui.resources.requests.cpu` | string | `200m` | UI CPU request |
| `ui.resources.requests.memory` | string | `256Mi` | UI memory request |
| `ui.resources.limits.cpu` | string | `1000m` | UI CPU limit |
| `ui.resources.limits.memory` | string | `1Gi` | UI memory limit |
| `ui.env.AUTH_URL` | string | `""` | Auth URL (auto-set) |
| `ui.env.AUTH_SECRET` | string | `""` | Auth secret (from secrets) |
| `ui.env.AUTH_OIDC_ISSUER` | string | `""` | OIDC issuer (auto-set) |
| `ui.env.AUTH_OIDC_CLIENT_ID` | string | `ui` | OIDC client ID |
| `ui.env.AUTH_OIDC_CLIENT_SECRET` | string | `ui` | OIDC client secret |
| `ui.env.AUTH_REDIRECT_PROXY_URL` | string | `""` | Auth redirect proxy URL (auto-set) |
| `ui.env.API_BASE_URL` | string | `""` | API base URL (auto-set) |
| `ui.env.NEXT_AUTH_DEBUG` | string | `false` | NextAuth debug mode |
| `ui.env.OTEL_TRACES_SAMPLER` | string | `always_on` | OTEL traces sampler |
| `ui.nodeSelector` | object | `{}` | UI node selector |
| `ui.tolerations` | array | `[]` | UI tolerations |
| `ui.affinity` | object | `{}` | UI affinity rules |
| `ui.istio.sidecar.enabled` | boolean | `true` | Enable Istio sidecar for UI |
| `ui.healthcheck.enabled` | boolean | `true` | Enable healthchecks |
| `ui.healthcheck.liveness.enabled` | boolean | `true` | Enable liveness probe |
| `ui.healthcheck.liveness.path` | string | `/api/healthcheck` | Liveness probe path |
| `ui.healthcheck.liveness.initialDelaySeconds` | integer | `30` | Liveness initial delay |
| `ui.healthcheck.liveness.periodSeconds` | integer | `10` | Liveness period |
| `ui.healthcheck.liveness.timeoutSeconds` | integer | `5` | Liveness timeout |
| `ui.healthcheck.liveness.successThreshold` | integer | `1` | Liveness success threshold |
| `ui.healthcheck.liveness.failureThreshold` | integer | `3` | Liveness failure threshold |
| `ui.healthcheck.readiness.enabled` | boolean | `true` | Enable readiness probe |
| `ui.healthcheck.readiness.path` | string | `/api/healthcheck` | Readiness probe path |
| `ui.healthcheck.readiness.initialDelaySeconds` | integer | `10` | Readiness initial delay |
| `ui.healthcheck.readiness.periodSeconds` | integer | `5` | Readiness period |
| `ui.healthcheck.readiness.timeoutSeconds` | integer | `3` | Readiness timeout |
| `ui.healthcheck.readiness.successThreshold` | integer | `1` | Readiness success threshold |
| `ui.healthcheck.readiness.failureThreshold` | integer | `3` | Readiness failure threshold |
| `ui.healthcheck.startup.enabled` | boolean | `true` | Enable startup probe |
| `ui.healthcheck.startup.path` | string | `/api/healthcheck` | Startup probe path |
| `ui.healthcheck.startup.initialDelaySeconds` | integer | `0` | Startup initial delay |
| `ui.healthcheck.startup.periodSeconds` | integer | `5` | Startup period |
| `ui.healthcheck.startup.timeoutSeconds` | integer | `3` | Startup timeout |
| `ui.healthcheck.startup.successThreshold` | integer | `1` | Startup success threshold |
| `ui.healthcheck.startup.failureThreshold` | integer | `30` | Startup failure threshold |
| `ui.autoscaling.enabled` | boolean | `true` | Enable autoscaling |
| `ui.autoscaling.minReplicas` | integer | `1` | Minimum replicas |
| `ui.autoscaling.maxReplicas` | integer | `10` | Maximum replicas |
| `ui.autoscaling.targetCPUUtilizationPercentage` | integer | `70` | Target CPU utilization percentage |
| `ui.autoscaling.targetMemoryUtilizationPercentage` | integer | `null` | Target memory utilization percentage (optional) |
| `ui.autoscaling.behavior` | object | `null` | Custom scaling behavior (optional) |
| **PostgreSQL Configuration** |
| `postgresql.enabled` | boolean | `true` | Enable PostgreSQL deployment |
| `postgresql.image.repository` | string | `postgres` | PostgreSQL image repository |
| `postgresql.image.tag` | string | `15` | PostgreSQL image tag |
| `postgresql.image.pullPolicy` | string | `IfNotPresent` | PostgreSQL image pull policy |
| `postgresql.auth.postgresPassword` | string | `""` | PostgreSQL password (auto-generated) |
| `postgresql.auth.database` | string | `vmxai` | Database name |
| `postgresql.auth.username` | string | `admin` | Database username |
| `postgresql.persistence.enabled` | boolean | `true` | Enable persistence |
| `postgresql.persistence.size` | string | `20Gi` | Persistent volume size |
| `postgresql.persistence.storageClass` | string | `""` | Storage class |
| `postgresql.resources.requests.cpu` | string | `500m` | PostgreSQL CPU request |
| `postgresql.resources.requests.memory` | string | `512Mi` | PostgreSQL memory request |
| `postgresql.resources.limits.cpu` | string | `2000m` | PostgreSQL CPU limit |
| `postgresql.resources.limits.memory` | string | `2Gi` | PostgreSQL memory limit |
| `postgresql.service.type` | string | `ClusterIP` | PostgreSQL service type |
| `postgresql.service.port` | integer | `5432` | PostgreSQL service port |
| `postgresql.istio.sidecar.enabled` | boolean | `false` | Enable Istio sidecar |
| `postgresql.external.host` | string | `""` | External PostgreSQL host |
| `postgresql.external.port` | integer | `5432` | External PostgreSQL port |
| `postgresql.external.database` | string | `""` | External database name |
| `postgresql.external.username` | string | `""` | External database username |
| `postgresql.external.password` | string | `""` | External database password (from secrets) |
| `postgresql.external.roHost` | string | `""` | External read replica host |
| `postgresql.external.ssl` | boolean | `false` | Enable SSL for external PostgreSQL |
| **Redis Configuration** |
| `redis.enabled` | boolean | `true` | Enable Redis deployment |
| `redis.mode` | string | `single` | Redis mode (`single` or `cluster`) |
| `redis.tls.enabled` | boolean | `false` | Enable TLS |
| `redis.istio.sidecar.enabled` | boolean | `false` | Enable Istio sidecar |
| `redis.single.image.repository` | string | `redis` | Redis single node image repository |
| `redis.single.image.tag` | string | `7` | Redis single node image tag |
| `redis.single.image.pullPolicy` | string | `IfNotPresent` | Redis single node image pull policy |
| `redis.single.persistence.enabled` | boolean | `true` | Enable persistence for single node |
| `redis.single.persistence.size` | string | `10Gi` | Single node persistent volume size |
| `redis.single.persistence.storageClass` | string | `""` | Single node storage class |
| `redis.single.resources.requests.cpu` | string | `200m` | Single node CPU request |
| `redis.single.resources.requests.memory` | string | `256Mi` | Single node memory request |
| `redis.single.resources.limits.cpu` | string | `1000m` | Single node CPU limit |
| `redis.single.resources.limits.memory` | string | `1Gi` | Single node memory limit |
| `redis.single.service.type` | string | `ClusterIP` | Single node service type |
| `redis.single.service.port` | integer | `6379` | Single node service port |
| `redis.cluster.nodes` | integer | `3` | Number of cluster nodes |
| `redis.cluster.replicas` | integer | `0` | Replicas per master |
| `redis.cluster.image.repository` | string | `redis` | Redis cluster image repository |
| `redis.cluster.image.tag` | string | `7` | Redis cluster image tag |
| `redis.cluster.image.pullPolicy` | string | `IfNotPresent` | Redis cluster image pull policy |
| `redis.cluster.persistence.enabled` | boolean | `true` | Enable persistence for cluster |
| `redis.cluster.persistence.size` | string | `10Gi` | Cluster persistent volume size |
| `redis.cluster.persistence.storageClass` | string | `""` | Cluster storage class |
| `redis.cluster.resources.requests.cpu` | string | `200m` | Cluster CPU request |
| `redis.cluster.resources.requests.memory` | string | `256Mi` | Cluster memory request |
| `redis.cluster.resources.limits.cpu` | string | `1000m` | Cluster CPU limit |
| `redis.cluster.resources.limits.memory` | string | `1Gi` | Cluster memory limit |
| `redis.cluster.service.type` | string | `ClusterIP` | Cluster service type |
| `redis.cluster.service.ports[0].name` | string | `client` | Cluster client port name |
| `redis.cluster.service.ports[0].port` | integer | `6379` | Cluster client port |
| `redis.cluster.service.ports[1].name` | string | `cluster` | Cluster cluster port name |
| `redis.cluster.service.ports[1].port` | integer | `16379` | Cluster cluster port |
| `redis.external.host` | string | `""` | External Redis host |
| `redis.external.port` | integer | `6379` | External Redis port |
| `redis.external.nodes` | array | `[]` | External Redis cluster nodes |
| **QuestDB Configuration** |
| `questdb.enabled` | boolean | `true` | Enable QuestDB deployment |
| `questdb.image.repository` | string | `questdb/questdb` | QuestDB image repository |
| `questdb.image.tag` | string | `9.1.1` | QuestDB image tag |
| `questdb.image.pullPolicy` | string | `IfNotPresent` | QuestDB image pull policy |
| `questdb.auth.user` | string | `admin` | QuestDB user |
| `questdb.auth.password` | string | `""` | QuestDB password (auto-generated) |
| `questdb.auth.database` | string | `vmxai` | QuestDB database name |
| `questdb.persistence.enabled` | boolean | `true` | Enable persistence |
| `questdb.persistence.size` | string | `50Gi` | Persistent volume size |
| `questdb.persistence.storageClass` | string | `""` | Storage class |
| `questdb.resources.requests.cpu` | string | `500m` | QuestDB CPU request |
| `questdb.resources.requests.memory` | string | `1Gi` | QuestDB memory request |
| `questdb.resources.limits.cpu` | string | `2000m` | QuestDB CPU limit |
| `questdb.resources.limits.memory` | string | `4Gi` | QuestDB memory limit |
| `questdb.service.type` | string | `ClusterIP` | QuestDB service type |
| `questdb.service.ports[0].name` | string | `http` | QuestDB HTTP port name |
| `questdb.service.ports[0].port` | integer | `9000` | QuestDB HTTP port |
| `questdb.service.ports[1].name` | string | `tcp-postgres` | QuestDB Postgres port name |
| `questdb.service.ports[1].port` | integer | `8812` | QuestDB Postgres port |
| `questdb.istio.sidecar.enabled` | boolean | `false` | Enable Istio sidecar |
| `questdb.external.host` | string | `""` | External QuestDB host |
| `questdb.external.port` | integer | `8812` | External QuestDB port |
| `questdb.external.database` | string | `""` | External QuestDB database |
| `questdb.external.username` | string | `""` | External QuestDB username |
| `questdb.external.password` | string | `""` | External QuestDB password (from secrets) |
| **OpenTelemetry Configuration** |
| `otel.enabled` | boolean | `false` | Enable OTEL services |
| `otel.exporterEndpoint` | string | `""` | OTEL exporter endpoint |
| `otel.istio.sidecar.enabled` | boolean | `false` | Enable Istio sidecar |
| `otel.collector.enabled` | boolean | `false` | Enable OTEL collector |
| `otel.collector.image.repository` | string | `otel/opentelemetry-collector-contrib` | Collector image repository |
| `otel.collector.image.tag` | string | `latest` | Collector image tag |
| `otel.collector.image.pullPolicy` | string | `IfNotPresent` | Collector image pull policy |
| `otel.collector.service.type` | string | `ClusterIP` | Collector service type |
| `otel.collector.service.ports[0].name` | string | `grpc-otlp` | gRPC OTLP port name |
| `otel.collector.service.ports[0].port` | integer | `4317` | gRPC OTLP port |
| `otel.collector.service.ports[1].name` | string | `http-otlp` | HTTP OTLP port name |
| `otel.collector.service.ports[1].port` | integer | `4318` | HTTP OTLP port |
| `otel.collector.service.ports[2].name` | string | `http-zpages` | HTTP zpages port name |
| `otel.collector.service.ports[2].port` | integer | `55679` | HTTP zpages port |
| `otel.collector.resources.requests.cpu` | string | `200m` | Collector CPU request |
| `otel.collector.resources.requests.memory` | string | `256Mi` | Collector memory request |
| `otel.collector.resources.limits.cpu` | string | `1000m` | Collector CPU limit |
| `otel.collector.resources.limits.memory` | string | `1Gi` | Collector memory limit |
| `otel.jaeger.enabled` | boolean | `false` | Enable Jaeger |
| `otel.jaeger.image.repository` | string | `jaegertracing/all-in-one` | Jaeger image repository |
| `otel.jaeger.image.tag` | string | `latest` | Jaeger image tag |
| `otel.jaeger.image.pullPolicy` | string | `IfNotPresent` | Jaeger image pull policy |
| `otel.jaeger.service.type` | string | `ClusterIP` | Jaeger service type |
| `otel.jaeger.service.ports[0].name` | string | `http-ui` | Jaeger UI port name |
| `otel.jaeger.service.ports[0].port` | integer | `16686` | Jaeger UI port |
| `otel.jaeger.service.ports[1].name` | string | `http-collector` | Jaeger HTTP collector port name |
| `otel.jaeger.service.ports[1].port` | integer | `14268` | Jaeger HTTP collector port |
| `otel.jaeger.service.ports[2].name` | string | `grpc-collector` | Jaeger gRPC collector port name |
| `otel.jaeger.service.ports[2].port` | integer | `14250` | Jaeger gRPC collector port |
| `otel.jaeger.service.ports[3].name` | string | `grpc-otlp` | Jaeger gRPC OTLP port name |
| `otel.jaeger.service.ports[3].port` | integer | `4317` | Jaeger gRPC OTLP port |
| `otel.jaeger.service.ports[4].name` | string | `http-otlp` | Jaeger HTTP OTLP port name |
| `otel.jaeger.service.ports[4].port` | integer | `4318` | Jaeger HTTP OTLP port |
| `otel.jaeger.resources.requests.cpu` | string | `200m` | Jaeger CPU request |
| `otel.jaeger.resources.requests.memory` | string | `256Mi` | Jaeger memory request |
| `otel.jaeger.resources.limits.cpu` | string | `1000m` | Jaeger CPU limit |
| `otel.jaeger.resources.limits.memory` | string | `1Gi` | Jaeger memory limit |
| `otel.jaeger.ingress.enabled` | boolean | `false` | Enable Jaeger ingress |
| `otel.jaeger.ingress.path` | string | `/jaeger` | Jaeger ingress path |
| `otel.prometheus.enabled` | boolean | `false` | Enable Prometheus |
| `otel.prometheus.image.repository` | string | `prom/prometheus` | Prometheus image repository |
| `otel.prometheus.image.tag` | string | `latest` | Prometheus image tag |
| `otel.prometheus.image.pullPolicy` | string | `IfNotPresent` | Prometheus image pull policy |
| `otel.prometheus.service.type` | string | `ClusterIP` | Prometheus service type |
| `otel.prometheus.service.port` | integer | `9090` | Prometheus service port |
| `otel.prometheus.persistence.enabled` | boolean | `true` | Enable Prometheus persistence |
| `otel.prometheus.persistence.size` | string | `10Gi` | Prometheus storage size |
| `otel.prometheus.persistence.storageClass` | string | `""` | Prometheus storage class |
| `otel.prometheus.resources.requests.cpu` | string | `200m` | Prometheus CPU request |
| `otel.prometheus.resources.requests.memory` | string | `512Mi` | Prometheus memory request |
| `otel.prometheus.resources.limits.cpu` | string | `1000m` | Prometheus CPU limit |
| `otel.prometheus.resources.limits.memory` | string | `2Gi` | Prometheus memory limit |
| `otel.prometheus.securityContext.runAsRoot` | boolean | `false` | Run Prometheus as root |
| `otel.prometheus.securityContext.runAsUser` | integer | `65534` | Prometheus run as user |
| `otel.prometheus.securityContext.fsGroup` | integer | `65534` | Prometheus FS group |
| `otel.prometheus.queryLogFile` | string | `""` | Prometheus query log file path |
| `otel.loki.enabled` | boolean | `false` | Enable Loki |
| `otel.loki.image.repository` | string | `grafana/loki` | Loki image repository |
| `otel.loki.image.tag` | string | `latest` | Loki image tag |
| `otel.loki.image.pullPolicy` | string | `IfNotPresent` | Loki image pull policy |
| `otel.loki.service.type` | string | `ClusterIP` | Loki service type |
| `otel.loki.service.port` | integer | `3100` | Loki service port |
| `otel.loki.persistence.enabled` | boolean | `true` | Enable Loki persistence |
| `otel.loki.persistence.size` | string | `20Gi` | Loki storage size |
| `otel.loki.persistence.storageClass` | string | `""` | Loki storage class |
| `otel.loki.resources.requests.cpu` | string | `200m` | Loki CPU request |
| `otel.loki.resources.requests.memory` | string | `512Mi` | Loki memory request |
| `otel.loki.resources.limits.cpu` | string | `1000m` | Loki CPU limit |
| `otel.loki.resources.limits.memory` | string | `2Gi` | Loki memory limit |
| `otel.loki.securityContext.runAsUser` | integer | `10001` | Loki run as user |
| `otel.loki.securityContext.fsGroup` | integer | `10001` | Loki FS group |
| `otel.grafana.enabled` | boolean | `false` | Enable Grafana |
| `otel.grafana.image.repository` | string | `grafana/grafana` | Grafana image repository |
| `otel.grafana.image.tag` | string | `latest` | Grafana image tag |
| `otel.grafana.image.pullPolicy` | string | `IfNotPresent` | Grafana image pull policy |
| `otel.grafana.service.type` | string | `ClusterIP` | Grafana service type |
| `otel.grafana.service.port` | integer | `3000` | Grafana service port |
| `otel.grafana.persistence.enabled` | boolean | `true` | Enable Grafana persistence |
| `otel.grafana.persistence.size` | string | `10Gi` | Grafana storage size |
| `otel.grafana.persistence.storageClass` | string | `""` | Grafana storage class |
| `otel.grafana.resources.requests.cpu` | string | `200m` | Grafana CPU request |
| `otel.grafana.resources.requests.memory` | string | `256Mi` | Grafana memory request |
| `otel.grafana.resources.limits.cpu` | string | `500m` | Grafana CPU limit |
| `otel.grafana.resources.limits.memory` | string | `512Mi` | Grafana memory limit |
| `otel.grafana.securityContext.runAsUser` | integer | `472` | Grafana run as user |
| `otel.grafana.securityContext.fsGroup` | integer | `472` | Grafana FS group |
| `otel.grafana.ingress.enabled` | boolean | `false` | Enable Grafana ingress |
| `otel.grafana.ingress.path` | string | `/grafana` | Grafana ingress path |
| **Secrets Configuration** |
| `secrets.database.method` | string | `create` | Secret method (`create`, `external`, `eso`) |
| `secrets.database.external.secretName` | string | `""` | External secret name |
| `secrets.database.external.passwordKey` | string | `password` | External password key |
| `secrets.database.external.hostKey` | string | `host` | External host key |
| `secrets.database.external.portKey` | string | `port` | External port key |
| `secrets.database.external.databaseKey` | string | `database` | External database key |
| `secrets.database.external.usernameKey` | string | `username` | External username key |
| `secrets.database.externalSecrets.secretKey` | string | `""` | ESO secret key |
| `secrets.database.externalSecrets.passwordKey` | string | `password` | ESO password key |
| `secrets.database.externalSecrets.hostKey` | string | `host` | ESO host key |
| `secrets.database.externalSecrets.portKey` | string | `port` | ESO port key |
| `secrets.database.externalSecrets.databaseKey` | string | `database` | ESO database key |
| `secrets.database.externalSecrets.usernameKey` | string | `username` | ESO username key |
| `secrets.questdb.method` | string | `create` | Secret method |
| `secrets.questdb.external.secretName` | string | `""` | External secret name |
| `secrets.questdb.external.passwordKey` | string | `password` | External password key |
| `secrets.questdb.external.hostKey` | string | `host` | External host key |
| `secrets.questdb.external.portKey` | string | `port` | External port key |
| `secrets.questdb.external.databaseKey` | string | `database` | External database key |
| `secrets.questdb.external.usernameKey` | string | `username` | External username key |
| `secrets.questdb.externalSecrets.secretKey` | string | `""` | ESO secret key |
| `secrets.questdb.externalSecrets.passwordKey` | string | `password` | ESO password key |
| `secrets.questdb.externalSecrets.hostKey` | string | `host` | ESO host key |
| `secrets.questdb.externalSecrets.portKey` | string | `port` | ESO port key |
| `secrets.questdb.externalSecrets.databaseKey` | string | `database` | ESO database key |
| `secrets.questdb.externalSecrets.usernameKey` | string | `username` | ESO username key |
| `secrets.libsodium.method` | string | `create` | Secret method |
| `secrets.libsodium.external.secretName` | string | `""` | External secret name |
| `secrets.libsodium.external.encryptionKeyKey` | string | `encryption-key` | External encryption key |
| `secrets.libsodium.externalSecrets.secretKey` | string | `""` | ESO secret key |
| `secrets.libsodium.externalSecrets.encryptionKeyKey` | string | `encryption-key` | ESO encryption key |
| `secrets.ui.method` | string | `create` | Secret method |
| `secrets.ui.external.secretName` | string | `""` | External secret name |
| `secrets.ui.external.authSecretKey` | string | `auth-secret` | External auth secret key |
| `secrets.ui.externalSecrets.secretKey` | string | `""` | ESO secret key |
| `secrets.ui.externalSecrets.authSecretKey` | string | `auth-secret` | ESO auth secret key |
| `secrets.oidcFederated.method` | string | `create` | Secret method |
| `secrets.oidcFederated.external.secretName` | string | `""` | External secret name |
| `secrets.oidcFederated.external.clientSecretKey` | string | `client-secret` | External client secret key |
| `secrets.oidcFederated.externalSecrets.secretKey` | string | `""` | ESO secret key |
| `secrets.oidcFederated.externalSecrets.clientSecretKey` | string | `client-secret` | ESO client secret key |
| `secrets.externalSecrets.enabled` | boolean | `true` | Enable External Secrets Operator |
| `secrets.externalSecrets.secretStore.name` | string | `""` | Secret store name |
| `secrets.externalSecrets.secretStore.kind` | string | `SecretStore` | Secret store kind |
| **Ingress Configuration** |
| `ingress.enabled` | boolean | `false` | Enable ingress |
| `ingress.istio.host` | string | `vm-x-ai.example.com` | Ingress hostname |
| `ingress.istio.gateway.name` | string | `vm-x-ai-gateway` | Gateway name |
| `ingress.istio.gateway.namespace` | string | `istio-system` | Gateway namespace |
| `ingress.istio.gateway.selector.istio` | string | `ingressgateway` | Gateway selector |
| `ingress.istio.gateway.servers` | array | `[...]` | Gateway servers configuration |
| `ingress.istio.virtualService.gateways` | array | `[...]` | VirtualService gateways |
| `ingress.istio.virtualService.trafficPolicy` | object | `{}` | VirtualService traffic policy |
| `ingress.istio.internalDns.enabled` | boolean | `true` | Enable internal DNS |
| `ingress.istio.internalDns.gatewayService` | string | `istio-ingressgateway.istio-system.svc.cluster.local` | Gateway service |
| `ingress.istio.internalDns.port` | integer | `80` | Internal DNS port |
| **Service Account** |
| `serviceAccount.create` | boolean | `true` | Create service account |
| `serviceAccount.annotations` | object | `{}` | Service account annotations |
| `serviceAccount.name` | string | `""` | Service account name |
| **Security Context** |
| `podSecurityContext.fsGroup` | integer | `2000` | Pod security context FS group |
| `securityContext.capabilities.drop` | array | `["ALL"]` | Dropped capabilities |
| `securityContext.readOnlyRootFilesystem` | boolean | `false` | Read-only root filesystem |
| `securityContext.runAsNonRoot` | boolean | `true` | Run as non-root |
| `securityContext.runAsUser` | integer | `1000` | Run as user ID |
| **Common Settings** |
| `commonLabels` | object | `{}` | Common labels |
| `commonAnnotations` | object | `{}` | Common annotations |
| `namespace.labels` | object | `{}` | Namespace labels |
| `namespace.annotations` | object | `{}` | Namespace annotations |

## Support

For issues and questions, please refer to the project repository.

