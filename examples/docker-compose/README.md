# Docker Compose Examples

This directory contains various Docker Compose configurations for running VM-X-AI with different setups and integrations. Each configuration is tailored for specific use cases, from basic development to production-ready observability stacks.

## Prerequisites

- Docker and Docker Compose installed
- Docker images built: `vmxai/ui:latest` and `vmxai/api:latest`
- For AWS configuration: AWS credentials configured (see [AWS Configuration](#aws-configuration))

## Available Configurations

### 1. `default.docker-compose.yml` - Basic Setup

**Use Case:** Standard development environment with all core services.

**Services Included:**
- **UI** (Next.js) - Port `3001`
- **API** (Node.js) - Port `3000`
- **PostgreSQL** - Port `5440`
- **Redis** (Single mode) - Port `6379`
- **QuestDB** (Timeseries) - Ports `9000` (Web Console), `8812` (PostgreSQL wire)

**Features:**
- Single Redis instance
- QuestDB for timeseries data
- Libsodium encryption provider
- OIDC authentication

**Usage:**
```bash
docker compose -f default.docker-compose.yml up
```

**Access URLs:**
- UI: http://localhost:3001
- API: http://localhost:3000
- QuestDB Console: http://localhost:9000

---

### 2. `otel.docker-compose.yml` - Full Observability Stack

**Use Case:** Development with complete observability (tracing, metrics, logs, and dashboards).

**Services Included:**
All services from `default.docker-compose.yml` plus:
- **OpenTelemetry Collector** - Ports `4317` (gRPC), `4318` (HTTP), `55679` (zPages)
- **Jaeger** (Tracing) - Port `16686` (UI)
- **Prometheus** (Metrics) - Port `9090`
- **Loki** (Logs) - Port `3100`
- **Grafana** (Dashboards) - Port `3010`

**Features:**
- OpenTelemetry enabled (`OTEL_ENABLED=true`)
- Distributed tracing with Jaeger
- Metrics collection with Prometheus
- Log aggregation with Loki
- Unified dashboards in Grafana

**Configuration Files:**
- OpenTelemetry Collector config: `../../docker/otel/otel-collector-config.yaml`
- Prometheus config: `../../docker/prometheus/prometheus.yml`
- Grafana provisioning: `../../docker/grafana/provisioning/`

**Usage:**
```bash
docker compose -f otel.docker-compose.yml up
```

**Access URLs:**
- UI: http://localhost:3001
- API: http://localhost:3000
- Jaeger UI: http://localhost:16686
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3010
- QuestDB Console: http://localhost:9000

---

### 3. `aws.docker-compose.yml` - AWS Services Integration

**Use Case:** Production-like setup using AWS managed services for encryption and timeseries storage.

**Services Included:**
- **UI** (Next.js) - Port `3001`
- **API** (Node.js) - Port `3000`
- **PostgreSQL** - Port `5440`
- **Redis** (Single mode) - Port `6379`

**Features:**
- **AWS KMS** for encryption (`ENCRYPTION_PROVIDER: aws-kms`)
- **AWS Timestream** for timeseries data (`COMPLETION_USAGE_PROVIDER: aws-timestream`)
- No local timeseries database (uses AWS Timestream)

**AWS Configuration:**

Before running, you must:

1. **Set AWS Credentials** (as environment variables):
   ```bash
   export AWS_ACCESS_KEY_ID=your-access-key-id
   export AWS_SECRET_ACCESS_KEY=your-secret-access-key
   export AWS_SESSION_TOKEN=your-session-token  # Optional, for temporary credentials
   export AWS_REGION=us-east-1  # Optional, defaults to us-east-1
   ```

2. **Configure AWS KMS Key ID:**
   - Update `AWS_KMS_KEY_ID` in the compose file with your KMS key ARN
   - Example: `arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012`

3. **Configure AWS Timestream Database:**
   - Update `AWS_TIMESTREAM_DATABASE_NAME` with your Timestream database name
   - Ensure the database exists in your AWS account

**Usage:**
```bash
docker compose -f aws.docker-compose.yml up
```

**Access URLs:**
- UI: http://localhost:3001
- API: http://localhost:3000

**Note:** This configuration requires active AWS credentials and access to the specified KMS key and Timestream database.

---

### 4. `redis-cluster.docker-compose.yml` - Redis Cluster Mode

**Use Case:** Testing and development with Redis cluster for high availability and scalability.

**Services Included:**
- **UI** (Next.js) - Port `3001`
- **API** (Node.js) - Port `3000`
- **PostgreSQL** - Port `5440`
- **Redis Cluster** (3 nodes) - Ports `7001-7003` (data), `17001-17003` (cluster bus)
- **QuestDB** (Timeseries) - Ports `9000`, `8812`
- **Redis Cluster Init** - Automatically initializes the cluster

**Features:**
- Redis cluster mode with 3 nodes (no replicas)
- Automatic cluster initialization
- QuestDB for timeseries data
- Libsodium encryption provider

**Configuration Files:**
- Redis node configs: `../../docker/redis-config/node1/`, `node2/`, `node3/`

**Usage:**
```bash
docker compose -f redis-cluster.docker-compose.yml up
```

**Access URLs:**
- UI: http://localhost:3001
- API: http://localhost:3000
- QuestDB Console: http://localhost:9000

**Note:** The cluster initialization service (`redis-cluster-init`) will automatically create the cluster after all Redis nodes are ready. The API connects to the cluster via port `7001`.

---

## Common Configuration

All configurations share the following common settings:

### Database (PostgreSQL)
- **Host:** `localhost`
- **Port:** `5440` (mapped from container port `5432`)
- **User:** `admin`
- **Password:** `password`
- **Database:** `vmxai`

### Authentication
- **OIDC Issuer:** `http://localhost:3000/oauth2` (default)
- **Auth Secret:** Development secret (change in production!)
- **Client ID/Secret:** `ui` / `ui` (development only)

### Network Mode
All services use `network_mode: host` for simplified networking in local development.

---

## Environment Variables

### Required for API Service

| Variable | Description | Example |
|----------|-------------|---------|
| `LOCAL` | Enable local development mode | `true` |
| `BASE_URL` | API base URL | `http://localhost:3000` |
| `DATABASE_HOST` | PostgreSQL host | `localhost` |
| `DATABASE_PORT` | PostgreSQL port | `5440` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` or `7001` (cluster) |
| `REDIS_MODE` | Redis mode | `single` or `cluster` |
| `ENCRYPTION_PROVIDER` | Encryption provider | `libsodium` or `aws-kms` |
| `COMPLETION_USAGE_PROVIDER` | Timeseries provider | `questdb` or `aws-timestream` |

### Optional Configuration

- `OTEL_ENABLED` - Enable OpenTelemetry (otel.docker-compose.yml only)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OpenTelemetry endpoint
- `AWS_KMS_KEY_ID` - AWS KMS key ARN (aws.docker-compose.yml)
- `AWS_TIMESTREAM_DATABASE_NAME` - Timestream database name (aws.docker-compose.yml)

---

## Security Notes

⚠️ **Important:** These configurations are for **development and testing only**. For production:

1. **Change all default passwords** (database, Redis, QuestDB)
2. **Generate a new `AUTH_SECRET`** using `npx auth` or `openssl rand -base64 32`
3. **Use secure encryption keys** (generate new `LIBSODIUM_ENCRYPTION_KEY`)
4. **Configure proper network isolation** (avoid `network_mode: host`)
5. **Use environment variable files** (`.env`) instead of hardcoded values
6. **Enable TLS/SSL** for all services
7. **Configure proper IAM roles** for AWS services

---

## Troubleshooting

### Port Conflicts
If you encounter port conflicts, you can modify the port mappings in the compose files. Common conflicts:
- Port `3000` - API
- Port `3001` - UI
- Port `5440` - PostgreSQL
- Port `6379` - Redis (single mode)
- Port `7001-7003` - Redis cluster

### Redis Cluster Not Initializing
If the Redis cluster fails to initialize:
1. Ensure all Redis nodes are running: `docker compose ps`
2. Check Redis logs: `docker compose logs redis redis2 redis3`
3. Manually initialize: `docker compose exec redis-cluster-init sh`

### AWS Credentials Not Working
For `aws.docker-compose.yml`:
1. Verify credentials are set: `echo $AWS_ACCESS_KEY_ID`
2. Test AWS access: `aws sts get-caller-identity`
3. Ensure the KMS key exists and you have permissions
4. Verify Timestream database exists

### OpenTelemetry Not Collecting Data
For `otel.docker-compose.yml`:
1. Verify `OTEL_ENABLED=true` is set
2. Check OpenTelemetry Collector logs: `docker compose logs otel-collector`
3. Verify collector config file exists: `../../docker/otel/otel-collector-config.yaml`
4. Check Jaeger UI: http://localhost:16686

---

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Redis Cluster Documentation](https://redis.io/docs/manual/scaling/)
- [AWS KMS Documentation](https://docs.aws.amazon.com/kms/)
- [AWS Timestream Documentation](https://docs.aws.amazon.com/timestream/)

