---
sidebar_position: 1
---

# Deploying to Minikube

This guide shows you how to deploy VM-X AI to a local Minikube cluster using Helm with Istio ingress.

## Prerequisites

Before you begin, ensure you have:

- **Minikube** installed
- **kubectl** configured to access your Minikube cluster
- **Helm** 3.0+ installed
- **Docker images** available:
  - `vmxai/api:latest`
  - `vmxai/ui:latest`

## Setup Minikube

### 1. Start Minikube

Start Minikube with sufficient resources:

```bash
minikube start --cpus=8 --memory=8192 --driver=docker
```

### 2. Enable Metrics Server

Enable the metrics server (required for HPA):

```bash
minikube addons enable metrics-server
```

### 3. Install Istio

VM-X AI uses Istio for ingress. You can use the provided [bootstrap script](https://github.com/vm-x-ai/open-vm-x-ai/blob/main/scripts/bootstrap_minikube.sh) to install Istio.

:::important Minikube Tunnel Requirement
The Istio Gateway requires a **minikube tunnel** to be running to generate an external IP address. The bootstrap script automatically starts the tunnel, but you must keep it running while using Istio ingress.

If the tunnel stops, restart it manually:
```bash
minikube tunnel
```

Keep this command running in a separate terminal.
:::

The bootstrap script will:
- Start Minikube if not running
- Enable metrics-server
- Start minikube tunnel (required for Istio Gateway)
- Install Istio Base, Istiod, Istio CNI, and Istio Gateway
- Configure Istio for VM-X AI

Alternatively, you can install Istio manually:

```bash
# Add Istio Helm repository
helm repo add istio https://istio-release.storage.googleapis.com/charts
helm repo update

# Install Istio Base
helm install istio-base istio/base -n istio-system --create-namespace --version=1.26.1

# Install Istiod (control plane)
helm install istiod istio/istiod \
  -n istio-system \
  --version=1.26.1 \
  --set cni.enabled=true \
  --set meshConfig.defaultConfig.proxyMetadata.ISTIO_META_DNS_CAPTURE="true" \
  --set meshConfig.defaultConfig.proxyMetadata.ISTIO_META_DNS_AUTO_ALLOCATE="true" \
  --wait

# Install Istio CNI
helm install istio-cni istio/cni -n istio-system --version=1.26.1 --set operator.enabled=true --wait

# Install Istio Gateway (ingress)
helm install ingressgateway istio/gateway \
  -n istio-system \
  --version=1.26.1 \
  --set service.type=LoadBalancer \
  --wait
```


## Deploy VM-X AI

### 1. Create Namespace

Create the namespace and enable Istio injection:

```bash
kubectl create namespace vm-x-ai
kubectl label namespace vm-x-ai istio-injection=enabled
```

### 2. Add Helm Repository

Add the VM-X AI Helm repository:

```bash
helm repo add vm-x-ai https://vm-x-ai.github.io/open-vm-x-ai/helm/
helm repo update
```

### 3. Install Helm Chart

Install with Minikube-specific values:

```bash
helm install vm-x-ai vm-x-ai/vm-x-ai \
  --namespace vm-x-ai \
  -f https://raw.githubusercontent.com/vm-x-ai/open-vm-x-ai/main/helm/charts/vm-x-ai/values-minikube.yaml
```

Or download the values file and customize it:

```bash
# Download the values file
curl -O https://raw.githubusercontent.com/vm-x-ai/open-vm-x-ai/main/helm/charts/vm-x-ai/values-minikube.yaml

# Edit values-minikube.yaml if needed
# Then install
helm install vm-x-ai vm-x-ai/vm-x-ai \
  --namespace vm-x-ai \
  -f values-minikube.yaml
```

### 4. Default Minikube Values

The `values-minikube.yaml` file includes optimized settings for Minikube:

```yaml
# Example values for Minikube/development environment
api:
  encryption:
    provider: libsodium  # libsodium is fine for local testing
  env:
    # Avoid conflicts with Next.js API routes when both are deployed to same host
    BASE_PATH: "/_api"
  replicaCount: 1
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi

ui:
  replicaCount: 1
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

redis:
  mode: single

otel:
  enabled: true
  collector:
    enabled: true
  jaeger:
    enabled: true
    ingress:
      enabled: true
  prometheus:
    enabled: true
  loki:
    enabled: true
  grafana:
    enabled: true
    ingress:
      enabled: true

ingress:
  enabled: true
  istio:
    host: vm-x-ai.local
    gateway:
      name: vm-x-ai-gateway
      namespace: istio-system
      selector:
        istio: ingressgateway
    virtualService:
      gateways:
        - istio-system/vm-x-ai-gateway
```

### 5. Wait for Deployment

Check the deployment status:

```bash
kubectl get pods -n vm-x-ai
```

Wait for all pods to be in `Running` state:

```bash
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=vm-x-ai \
  -n vm-x-ai \
  --timeout=300s
```

## Access the Application

### Configure Host File

The Minikube values configure the ingress host as `vm-x-ai.local`. Since minikube tunnel is running, you can use `127.0.0.1` as the IP address.

**On Linux/macOS:**

```bash
# Add to /etc/hosts (requires sudo)
echo "127.0.0.1 vm-x-ai.local" | sudo tee -a /etc/hosts
```

**On Windows:**

1. Open Notepad as Administrator
2. Open `C:\Windows\System32\drivers\etc\hosts`
3. Add the line: `127.0.0.1 vm-x-ai.local`
4. Save the file

### Access via Istio Ingress

Once the host is configured, access the application:

- **UI**: http://vm-x-ai.local
- **API**: http://vm-x-ai.local/_api

### Alternative: Port Forwarding

If you prefer not to configure the hosts file, you can use port forwarding:

```bash
# Forward UI port
kubectl port-forward -n vm-x-ai svc/vm-x-ai-ui 3001:3001

# Forward API port (in another terminal)
kubectl port-forward -n vm-x-ai svc/vm-x-ai-api 3000:3000
```

Then access:
- **UI**: http://localhost:3001
- **API**: http://localhost:3000

## Configuration

### Using Custom Values

Create a `my-values.yaml` file to override specific settings:

```yaml
api:
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 2000m
      memory: 2Gi

ui:
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi
```

Install with custom values:

```bash
helm install vm-x-ai vm-x-ai/vm-x-ai \
  --namespace vm-x-ai \
  -f https://raw.githubusercontent.com/vm-x-ai/open-vm-x-ai/main/helm/charts/vm-x-ai/values-minikube.yaml \
  -f my-values.yaml
```

## Monitoring

### View Logs

```bash
# API logs
kubectl logs -n vm-x-ai -l app.kubernetes.io/component=api --tail=100 -f

# UI logs
kubectl logs -n vm-x-ai -l app.kubernetes.io/component=ui --tail=100 -f
```

### Check Resource Usage

```bash
# Pod resource usage
kubectl top pods -n vm-x-ai

# Node resource usage
kubectl top nodes
```

### Access Observability Tools

With the default Minikube values, observability tools are enabled:

- **Grafana**: http://vm-x-ai.local/grafana (if ingress enabled)
- **Jaeger**: http://vm-x-ai.local/jaeger (if ingress enabled)
- **Prometheus**: Access via port-forward: `kubectl port-forward -n vm-x-ai svc/prometheus 9090:9090`

## Troubleshooting

### Pods Not Starting

Check pod status and events:

```bash
# Pod status
kubectl get pods -n vm-x-ai

# Pod events
kubectl describe pod <pod-name> -n vm-x-ai

# Pod logs
kubectl logs <pod-name> -n vm-x-ai
```

### Istio Sidecar Issues

If pods have issues with Istio sidecars:

```bash
# Check Istio injection
kubectl get namespace vm-x-ai -o jsonpath='{.metadata.labels.istio-injection}'

# Check sidecar status
kubectl get pods -n vm-x-ai -o jsonpath='{.items[*].spec.containers[*].name}'
```

### Ingress Not Working

If ingress is not working:

```bash
# Check Istio Gateway
kubectl get gateway -n istio-system

# Check VirtualService
kubectl get virtualservice -n vm-x-ai

# Check ingress gateway service
kubectl get svc -n istio-system istio-ingressgateway
```

### Database Connection Issues

Check PostgreSQL:

```bash
# PostgreSQL pod
kubectl get pods -n vm-x-ai -l app.kubernetes.io/component=postgresql

# PostgreSQL logs
kubectl logs -n vm-x-ai -l app.kubernetes.io/component=postgresql
```

## Upgrading

To upgrade the deployment:

```bash
helm repo update
helm upgrade vm-x-ai vm-x-ai/vm-x-ai \
  --namespace vm-x-ai \
  -f values-minikube.yaml
```

## Uninstalling

To remove VM-X AI:

```bash
# Uninstall Helm release
helm uninstall vm-x-ai -n vm-x-ai

# Delete namespace (removes all resources)
kubectl delete namespace vm-x-ai
```

To also remove persistent volumes:

```bash
# Delete PVCs
kubectl delete pvc -n vm-x-ai --all
```

## Next Steps

- [AWS EKS Deployment](./aws-eks.md) - Deploy to AWS EKS
- [AWS ECS Deployment](./aws-ecs.md) - Deploy to AWS ECS
- [Helm Chart Documentation](https://github.com/vm-x-ai/open-vm-x-ai/tree/main/helm/charts/vm-x-ai) - Detailed Helm chart reference
