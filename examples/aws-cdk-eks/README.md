# VM-X AI AWS EKS Example

This example demonstrates how to deploy VM-X AI to Amazon EKS (Elastic Kubernetes Service) using AWS CDK and EKS Blueprints.

## Overview

This CDK stack provisions a complete AWS infrastructure for running VM-X AI in production, including:

- **EKS Cluster**: Kubernetes 1.34 cluster with managed node groups
- **VPC**: Multi-AZ VPC with public and private subnets
- **Aurora PostgreSQL**: Managed database cluster for application data
- **AWS Timestream**: Time-series database for metrics and telemetry
- **Istio Service Mesh**: Advanced traffic management and observability
- **External Secrets Operator**: Secure secret management from AWS Secrets Manager
- **OpenTelemetry**: Full observability stack (Prometheus, Loki, Grafana, Jaeger)
- **KMS Encryption**: AWS KMS key for encryption at rest
- **IRSA (IAM Roles for Service Accounts)**: Secure AWS service access without credentials

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              AWS Network Load Balancer (NLB)                 │
│              (Istio Ingress Gateway)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    EKS Cluster                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Istio Service Mesh                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │  VM-X AI UI  │  │  VM-X AI API │                │  │
│  │  └──────────────┘  └──────────────┘                │  │
│  │  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │   Redis      │  │  OTEL Stack  │                │  │
│  │  │   Cluster    │  │              │                │  │
│  │  └──────────────┘  └──────────────┘                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Aurora     │ │  Timestream  │ │     KMS      │
│  PostgreSQL  │ │   Database   │ │     Key      │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Prerequisites

Before deploying this stack, ensure you have:

1. **AWS CLI** configured with appropriate credentials
2. **AWS CDK CLI** installed (`npm install -g aws-cdk`)
3. **Node.js** 18+ and **pnpm** (or npm/yarn)
4. **kubectl** installed (will be configured after deployment)
5. **Helm** 3.0+ (optional, for manual operations)
6. **AWS Permissions**: Your AWS credentials need permissions to create:
   - EKS clusters and node groups
   - VPCs, subnets, and networking resources
   - RDS Aurora clusters
   - Timestream databases
   - KMS keys
   - IAM roles and policies
   - Security groups
   - Load balancers

## Configuration

### Admin Role ARN

The stack includes a platform team with admin access. **You must update the admin role ARN** in `lib/eks-stack.ts`:

```typescript
const adminRoleArn = `arn:aws:iam::${this.account}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AWSAdministratorAccess_ee10c8d485cb1dd8`;
```

Replace this with your own IAM role ARN that should have admin access to the cluster.

### Resource Configuration

The stack is configured with minimal resources for cost optimization. You can adjust:

- **API Resources**: CPU and memory limits in the Helm chart values
- **UI Resources**: CPU and memory limits in the Helm chart values
- **Redis**: Currently configured as a 3-node cluster with persistence
- **Database**: Aurora PostgreSQL with `db.t3.medium` instance
- **Storage**: EBS volumes for persistent storage (10-20Gi per component)

## Deployment

### 1. Install Dependencies

```bash
cd examples/aws-cdk-eks
pnpm install
```

### 2. Bootstrap CDK (First Time Only)

If this is your first time using CDK in this AWS account/region:

```bash
cdk bootstrap
```

### 3. Deploy the Stack

```bash
pnpm cdk deploy --all
```

This will:

- Create the VPC and networking infrastructure
- Provision the EKS cluster with all add-ons
- Create the Aurora PostgreSQL database
- Create the Timestream database
- Create the KMS encryption key
- Deploy the VM-X AI Helm chart
- Configure all IAM roles and service accounts

**Deployment typically takes 15-30 minutes.**

### 4. Get the Application URL

After deployment completes, the stack will output the application URL:

```
Outputs:
vm-x-ai-eks-example.ApplicationUrl = http://<nlb-hostname>
```

(The default Application's username and password are `admin` and `admin`)

You can also retrieve it with:

```bash
aws cloudformation describe-stacks \
  --stack-name vm-x-ai-eks-cluster \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' \
  --output text
```

### 5. Configure kubectl

Configure kubectl to connect to your EKS cluster:

```bash
aws eks update-kubeconfig --name vm-x-ai-eks-cluster --region <your-region>
```

Replace `<your-region>` with the AWS region where you deployed the stack.

You can verify the connection with:

```bash
kubectl get nodes
kubectl get pods -n vm-x-ai
```

## What Gets Deployed

### Infrastructure Components

- **VPC**: `10.0.0.0/16` CIDR with 3 availability zones
- **EKS Cluster**: Kubernetes 1.34 with managed node groups
- **Aurora PostgreSQL**: Publicly accessible cluster (for development; use private subnets in production)
- **Timestream Database**: `vm-x-ai` database for time-series data
- **KMS Key**: `alias/vm-x-ai-encryption-key` for encryption

### Kubernetes Add-ons

- **Metrics Server**: For HPA and resource metrics
- **AWS Load Balancer Controller**: For NLB/ALB integration
- **VPC CNI**: AWS VPC networking plugin
- **CoreDNS**: Cluster DNS
- **Kube Proxy**: Network proxy
- **Istio**: Service mesh with tracing enabled
- **External Secrets Operator**: For AWS Secrets Manager integration
- **EBS CSI Driver**: For persistent volumes

### Application Components

- **VM-X AI API**: Backend API service
- **VM-X AI UI**: Frontend web application
- **Redis Cluster**: 3-node cluster for caching
- **OpenTelemetry Collector**: Metrics and traces collection
- **Prometheus**: Metrics storage
- **Loki**: Log aggregation
- **Grafana**: Observability dashboards
- **Jaeger**: Distributed tracing

## Accessing Services

### Application

Access the main application at the URL provided in the stack outputs.

### Grafana

Grafana is accessible via Istio ingress. Check the ingress configuration:

```bash
kubectl get virtualservice -n vm-x-ai
kubectl get gateway -n istio-system
```

### Jaeger

Jaeger UI is also accessible via Istio ingress. Check the ingress configuration for the Jaeger service.

## Secrets Management

The stack uses **External Secrets Operator** to manage secrets:

- **Database Credentials**: Retrieved from AWS Secrets Manager (`vm-x-ai-database-secret`)
- **UI Auth Secret**: Auto-generated by the Helm chart
- **KMS Key**: Referenced by ARN (no secret needed)

The database secret is automatically created by CDK when the Aurora cluster is provisioned.

## Monitoring and Observability

The stack includes a complete observability stack:

- **Prometheus**: Scrapes metrics from all services
- **Loki**: Aggregates logs from all pods
- **Grafana**: Pre-configured dashboards for metrics and logs
- **Jaeger**: Distributed tracing across the service mesh
- **OpenTelemetry**: Automatic instrumentation via Istio

All components have persistent storage enabled.

## Cost Considerations

This stack creates several AWS resources that incur costs:

- **EKS Cluster**: ~$0.10/hour (~$73/month)
- **EKS Node Groups**: Depends on instance types (typically $50-200/month)
- **Aurora PostgreSQL**: ~$100-200/month (db.t3.medium)
- **Timestream**: Pay-per-use (typically $10-50/month for small workloads)
- **NLB**: ~$0.0225/hour (~$16/month)
- **NAT Gateway**: ~$0.045/hour (~$32/month)
- **EBS Volumes**: ~$0.10/GB/month

**Estimated total**: $300-500/month for a minimal production setup.

To reduce costs:

- Use smaller instance types
- Disable optional components (Grafana, Jaeger, etc.)
- Use single-AZ deployment (not recommended for production)
- Use Aurora Serverless v2 for variable workloads

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n vm-x-ai
kubectl describe pod <pod-name> -n vm-x-ai
kubectl logs <pod-name> -n vm-x-ai
```

### Check Service Account

```bash
kubectl get serviceaccount -n vm-x-ai
kubectl describe serviceaccount vm-x-ai-api -n vm-x-ai
```

### Check External Secrets

```bash
kubectl get externalsecret -n vm-x-ai
kubectl describe externalsecret <secret-name> -n vm-x-ai
```

### Check Istio Configuration

```bash
kubectl get virtualservice -n vm-x-ai
kubectl get gateway -n istio-system
kubectl get destinationrule -n vm-x-ai
```

### Check Database Connectivity

```bash
kubectl exec -it <api-pod> -n vm-x-ai -- env | grep DATABASE
```

### Common Issues

1. **Pods stuck in Pending**: Check node capacity and resource requests
2. **External Secrets not syncing**: Verify ClusterSecretStore and IAM permissions
3. **Database connection failures**: Check security group rules and VPC configuration
4. **Ingress not working**: Verify Istio Gateway and VirtualService configuration

## Cleanup

To destroy all resources:

```bash
pnpm cdk destroy --all
```

**Warning**: This will delete all resources including databases and persistent volumes. Make sure you have backups if needed.

## Customization

### Modify Resource Limits

Edit the Helm chart values in `lib/eks-stack.ts`:

```typescript
api: {
  resources: {
    requests: { cpu: '200m', memory: '256Mi' },
    limits: { cpu: '1000m', memory: '1Gi' },
  },
}
```

### Change Database Configuration

Modify the Aurora cluster configuration:

```typescript
const database = new DatabaseCluster(this, 'Database', {
  // ... adjust instance type, version, etc.
});
```

### Add Additional Services

You can add more Helm charts or Kubernetes manifests to the stack by extending the `EKSStack` class.

## Security Best Practices

For production deployments, consider:

1. **Private Database**: Move Aurora to private subnets
2. **Network Policies**: Implement Kubernetes network policies
3. **Pod Security Standards**: Enable Pod Security Standards
4. **Secrets Rotation**: Enable automatic secret rotation
5. **Encryption**: Ensure all EBS volumes are encrypted
6. **Backup**: Enable automated backups for Aurora
7. **Monitoring**: Set up CloudWatch alarms
8. **Access Control**: Use least-privilege IAM policies

## Support

For issues and questions:

- Check the main [VM-X AI documentation](../../README.md)
- Review the [Helm chart README](../../helm/charts/vm-x-ai/README.md)
- Open an issue on GitHub

## License

This example is part of the VM-X AI project and follows the same license.
