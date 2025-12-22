# VM-X AI AWS ECS Example

This example demonstrates how to deploy VM-X AI to Amazon ECS (Elastic Container Service) using AWS CDK with Fargate.

## Overview

This CDK stack provisions a complete AWS infrastructure for running VM-X AI in production, including:

- **ECS Cluster**: Fargate-based container orchestration
- **VPC**: Multi-AZ VPC with public subnets
- **Aurora PostgreSQL**: Managed database cluster for application data
- **AWS Timestream**: Time-series database for metrics and telemetry
- **ElastiCache Serverless (Valkey)**: Redis-compatible cache
- **Application Load Balancers**: Separate ALBs for API and UI services
- **OpenTelemetry Collector**: AWS-managed collector for observability
- **KMS Encryption**: AWS KMS key for encryption at rest
- **CloudWatch Logs**: Centralized logging for all services

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  API ALB     │ │   UI ALB     │ │              │
│  (Port 80)   │ │  (Port 80)   │ │              │
└──────┬───────┘ └──────┬───────┘ │              │
       │                │         │              │
       ▼                ▼         │              │
┌──────────────────────────────────────────────────────┐
│              ECS Fargate Cluster                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  API Service                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐         │  │
│  │  │  API         │  │  OTEL        │         │  │
│  │  │  Container   │  │  Collector   │         │  │
│  │  └──────────────┘  └──────────────┘         │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │  UI Service                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐         │  │
│  │  │  UI          │  │  OTEL        │         │  │
│  │  │  Container   │  │  Collector   │         │  │
│  │  └──────────────┘  └──────────────┘         │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Aurora     │ │  ElastiCache  │ │  Timestream  │
│  PostgreSQL  │ │  (Valkey)     │ │   Database   │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Prerequisites

Before deploying this stack, ensure you have:

1. **AWS CLI** configured with appropriate credentials
2. **AWS CDK CLI** installed (`npm install -g aws-cdk`)
3. **Node.js** 18+ and **pnpm** (or npm/yarn)
4. **AWS Permissions**: Your AWS credentials need permissions to create:
   - ECS clusters and services
   - VPCs, subnets, and networking resources
   - RDS Aurora clusters
   - Timestream databases
   - ElastiCache serverless caches
   - KMS keys
   - IAM roles and policies
   - Security groups
   - Application Load Balancers
   - CloudWatch Log Groups
   - SSM Parameters

## Configuration

### OpenTelemetry Configuration

The OpenTelemetry collector configuration is stored in `ecs-otel-config.yaml` and uploaded to SSM Parameter Store. The configuration includes:

- OTLP receivers (gRPC on 4317, HTTP on 4318)
- AWS X-Ray receiver
- StatsD receiver
- AWS X-Ray exporter for traces
- CloudWatch EMF exporter for metrics

You can customize this configuration by editing `ecs-otel-config.yaml`.

### Resource Configuration

The stack is configured with minimal resources for cost optimization. You can adjust:

- **API Task**: 1024 MiB memory, 512 CPU units
- **UI Task**: 1024 MiB memory, 512 CPU units
- **OTEL Collector**: 512 MiB memory, 256 CPU units
- **Database**: Aurora PostgreSQL with `db.t3.medium` instance
- **Redis**: ElastiCache Serverless (Valkey) with auto-scaling

## Deployment

### 1. Install Dependencies

```bash
cd examples/aws-cdk-ecs
pnpm install
```

### 2. Bootstrap CDK (First Time Only)

If this is your first time using CDK in this AWS account/region:

```bash
pnpm cdk bootstrap
```

### 3. Deploy the Stack

```bash
pnpm cdk deploy
```

This will:

- Create the VPC and networking infrastructure
- Provision the ECS Fargate cluster
- Create the Aurora PostgreSQL database
- Create the Timestream database
- Create the ElastiCache serverless cache
- Create the KMS encryption key
- Deploy the API and UI services
- Configure all IAM roles and policies
- Set up Application Load Balancers

**Deployment typically takes 15-30 minutes.**

### 4. Get the Application URLs

After deployment completes, the stack will output the application URLs. You can retrieve them with:

```bash
aws cloudformation describe-stacks \
  --stack-name vm-x-ai-ecs-example \
  --query 'Stacks[0].Outputs' \
  --output table
```

Or check the AWS Console:

- **ApiUrl**: Look for the API Load Balancer DNS name
- **UiUrl**: Look for the UI Load Balancer DNS name

The default Application's username and password are `admin` and `admin`.

## What Gets Deployed

### Infrastructure Components

- **VPC**: `10.0.0.0/16` CIDR with 3 availability zones (public subnets only)
- **ECS Cluster**: `vm-x-ai-cluster` with Fargate launch type
- **Aurora PostgreSQL**: Publicly accessible cluster (for development; use private subnets in production)
  - Cluster identifier: `vm-x-ai-rds-cluster`
  - Database name: `vmxai`
  - Credentials stored in Secrets Manager: `vm-x-ai-database-secret`
- **Timestream Database**: `vm-x-ai` database for time-series data
- **ElastiCache Serverless**: `vm-x-ai-valkey-serverless-cache` (Valkey/Redis-compatible)
- **KMS Key**: `alias/vm-x-ai-encryption-key` for encryption

### Application Components

- **VM-X AI API Service**:
  - Service name: `vm-x-ai-api`
  - Task definition: `vm-x-ai-api-task-definition`
  - Container port: 3000
  - Health check: `/healthcheck`
  - Desired count: 1
- **VM-X AI UI Service**:
  - Service name: `vm-x-ai-ui`
  - Task definition: `vm-x-ai-ui-task-definition`
  - Container port: 3001
  - Health check: `/api/healthcheck`
  - Desired count: 1
- **OpenTelemetry Collector**: Sidecar container in each task
  - Receives OTLP traces and metrics
  - Exports to AWS X-Ray and CloudWatch

### Load Balancers

- **API Load Balancer**: `vm-x-ai-api` (HTTP on port 80)
- **UI Load Balancer**: `vm-x-ai-ui` (HTTP on port 80)

### Logging

- **API Logs**: `/aws/ecs/vm-x-ai-api` (14-day retention)
- **UI Logs**: `/aws/ecs/vm-x-ai-ui` (14-day retention)
- **Collector Logs**: `/aws/ecs/vm-x-ai-collector` (14-day retention)

## Accessing Services

### Application

Access the main application at the UI Load Balancer DNS name:

- **UI**: `http://<ui-alb-dns-name>`
- **API**: `http://<api-alb-dns-name>`

### CloudWatch Logs

View logs for all services in CloudWatch:

```bash
# API logs
aws logs tail /aws/ecs/vm-x-ai-api --follow

# UI logs
aws logs tail /aws/ecs/vm-x-ai-ui --follow

# Collector logs
aws logs tail /aws/ecs/vm-x-ai-collector --follow
```

### AWS X-Ray

Traces are automatically sent to AWS X-Ray. View them in the AWS X-Ray console or use the AWS CLI:

```bash
aws xray get-trace-summaries --start-time $(date -u -d '1 hour ago' +%s) --end-time $(date -u +%s)
```

## Secrets Management

The stack uses **AWS Secrets Manager** and **SSM Parameter Store** for secrets:

- **Database Credentials**: Stored in Secrets Manager (`vm-x-ai-database-secret`)
  - Automatically generated when the Aurora cluster is created
  - Contains: `host`, `port`, `dbname`, `username`, `password`
- **UI Auth Secret**: Stored in Secrets Manager (`vm-x-ai-ui-auth-secret`)
  - Auto-generated 32-character secret
- **OpenTelemetry Config**: Stored in SSM Parameter Store (`vm-x-ai-otel-config`)
  - Contains the collector configuration from `ecs-otel-config.yaml`
- **KMS Key**: Referenced by ARN (no secret needed)

## Monitoring and Observability

The stack includes comprehensive observability:

- **CloudWatch Logs**: All container logs are sent to CloudWatch
- **AWS X-Ray**: Distributed tracing for API requests
- **CloudWatch Metrics**: Custom metrics via OpenTelemetry EMF exporter
- **Health Checks**: ALB health checks on `/healthcheck` endpoints
- **Container Health Checks**: Built into the OTEL collector containers

### Viewing Metrics

Metrics are exported to CloudWatch under the namespace `ECS/OTEL/VM-X-AI`. View them in the CloudWatch console or via CLI:

```bash
aws cloudwatch list-metrics --namespace ECS/OTEL/VM-X-AI
```

## Cost Considerations

This stack creates several AWS resources that incur costs:

- **ECS Fargate**: ~$0.04/vCPU-hour + ~$0.004/GB-hour (~$30-50/month for minimal usage)
- **Application Load Balancers**: ~$0.0225/hour each (~$32/month for 2 ALBs)
- **Aurora PostgreSQL**: ~$100-200/month (db.t3.medium)
- **ElastiCache Serverless**: Pay-per-use (typically $10-30/month for small workloads)
- **Timestream**: Pay-per-use (typically $10-50/month for small workloads)
- **Data Transfer**: ~$0.09/GB for outbound data transfer
- **CloudWatch Logs**: ~$0.50/GB ingested, $0.03/GB stored

**Estimated total**: $200-400/month for a minimal production setup.

To reduce costs:

- Use smaller task sizes (reduce CPU/memory)
- Reduce desired count to 0 when not in use
- Use Aurora Serverless v2 for variable workloads
- Disable optional components
- Use single-AZ deployment (not recommended for production)

## Cleanup

To destroy all resources:

```bash
pnpm cdk destroy
```

**Warning**: This will delete all resources including databases and caches. Make sure you have backups if needed.

**Note**: Some resources may need to be deleted manually:

- ElastiCache serverless cache (may take time to delete)
- Timestream database (must be empty before deletion)

## Customization

### Modify Task Resources

Edit the task definitions in `lib/ecs-stack.ts`:

```typescript
const apiTaskDefinition = new FargateTaskDefinition(this, 'API/TaskDef', {
  memoryLimitMiB: 2048, // Increase memory
  cpu: 1024, // Increase CPU
  family: 'vm-x-ai-api-task-definition',
});
```

### Change Service Desired Count

```typescript
const apiService = new FargateService(this, 'API/Service', {
  // ...
  desiredCount: 2, // Scale to 2 tasks
});
```

### Add Auto Scaling

You can add Application Auto Scaling to automatically scale services based on CPU/memory:

```typescript
import { ScalableTarget, ServiceNamespace, MetricType } from 'aws-cdk-lib/aws-applicationautoscaling';

const scalableTarget = apiService.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 10,
});

scalableTarget.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: 70,
});
```

### Change Database Configuration

Modify the Aurora cluster configuration:

```typescript
const database = new DatabaseCluster(this, 'Database', {
  // ... adjust instance type, version, etc.
  writer: ClusterInstance.provisioned('writer', {
    instanceType: InstanceType.of(InstanceClass.BURSTABLE3, InstanceSize.LARGE),
  }),
});
```

### Use Private Subnets (Production)

For production, move resources to private subnets:

```typescript
vpcSubnets: {
  subnetType: SubnetType.PRIVATE_WITH_EGRESS,  // Instead of PUBLIC
},
assignPublicIp: false,  // Instead of true
```

## Security Best Practices

For production deployments, consider:

1. **Private Subnets**: Move all resources to private subnets with NAT Gateway
2. **Security Groups**: Implement least-privilege security group rules
3. **Secrets Rotation**: Enable automatic secret rotation in Secrets Manager
4. **Encryption**: Ensure all EBS volumes and data at rest are encrypted
5. **Backup**: Enable automated backups for Aurora
6. **Monitoring**: Set up CloudWatch alarms for service health
7. **Access Control**: Use least-privilege IAM policies
8. **HTTPS**: Configure SSL/TLS certificates for load balancers
9. **VPC Endpoints**: Use VPC endpoints for AWS services to avoid internet traffic
10. **Network ACLs**: Implement network ACLs for additional security layers

## Production Checklist

Before deploying to production:

- [ ] Move database to private subnets
- [ ] Move ElastiCache to private subnets
- [ ] Disable public IP assignment for tasks
- [ ] Configure HTTPS/TLS on load balancers
- [ ] Set up custom domain names
- [ ] Enable database backups
- [ ] Configure auto-scaling
- [ ] Set up CloudWatch alarms
- [ ] Review and tighten IAM policies
- [ ] Enable VPC Flow Logs
- [ ] Configure WAF on load balancers
- [ ] Set up disaster recovery plan

## Support

For issues and questions:

- Check the main [VM-X AI documentation](../../README.md)
- Review the [Helm chart README](../../helm/charts/vm-x-ai/README.md) for application configuration
- Open an issue on GitHub

## License

This example is part of the VM-X AI project and follows the same license.
