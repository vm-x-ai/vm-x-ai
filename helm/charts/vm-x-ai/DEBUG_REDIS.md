# Redis Cluster Debugging Commands

## 1. Check Cluster Nodes Configuration

Check what addresses the cluster nodes are using:

```bash
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- redis-cli cluster nodes
```

**Expected**: All nodes should show FQDNs like:
- `vm-x-ai-redis-cluster-0.vm-x-ai-redis-cluster:6379`
- `vm-x-ai-redis-cluster-1.vm-x-ai-redis-cluster:6379`
- `vm-x-ai-redis-cluster-2.vm-x-ai-redis-cluster:6379`

**If you see IPs** (like `10.244.0.115:6379`), the cluster-announce-ip isn't working.

## 2. Check Cluster Info

```bash
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- redis-cli cluster info
```

Should show `cluster_state:ok`

## 3. Check Cluster Slots

```bash
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- redis-cli cluster slots
```

Should show all 16384 slots distributed across nodes.

## 4. Test Connection from API Pod

```bash
# Get API pod name
kubectl get pods -n vm-x-ai -l app.kubernetes.io/component=api

# Test DNS resolution
kubectl exec -it <api-pod-name> -n vm-x-ai -- nslookup vm-x-ai-redis-cluster-0.vm-x-ai-redis-cluster

# Test Redis connection
kubectl exec -it <api-pod-name> -n vm-x-ai -- redis-cli -h vm-x-ai-redis-cluster-0.vm-x-ai-redis-cluster -p 6379 ping
```

## 5. Check Redis Configuration

Check if cluster-announce-ip is set correctly:

```bash
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- redis-cli CONFIG GET cluster-announce-ip
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- redis-cli CONFIG GET cluster-announce-port
```

## 6. Check Pod Hostname

Verify the pod hostname matches expected format:

```bash
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- hostname
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- hostname -f
```

## 7. Check Environment Variables in API Pod

```bash
kubectl exec -it <api-pod-name> -n vm-x-ai -- env | grep REDIS
```

Should show:
- `REDIS_HOST=vm-x-ai-redis-cluster-0.vm-x-ai-redis-cluster`
- `REDIS_PORT=6379`
- `REDIS_MODE=cluster`

## 8. Test ioredis Connection Manually

If you have node/redis-cli in the API pod:

```bash
kubectl exec -it <api-pod-name> -n vm-x-ai -- node -e "
const Redis = require('ioredis');
const cluster = new Redis.Cluster([{
  host: 'vm-x-ai-redis-cluster-0.vm-x-ai-redis-cluster',
  port: 6379
}], {
  enableReadyCheck: true
});
cluster.on('ready', () => console.log('Connected!'));
cluster.on('error', (err) => console.error('Error:', err));
setTimeout(() => cluster.quit(), 5000);
"
```

## 9. Check Redis Logs

```bash
kubectl logs vm-x-ai-redis-cluster-0 -n vm-x-ai
```

Look for cluster-announce-ip in the startup logs.

## 10. Verify Service DNS

```bash
# From API pod
kubectl exec -it <api-pod-name> -n vm-x-ai -- getent hosts vm-x-ai-redis-cluster-0.vm-x-ai-redis-cluster
```

## Common Issues and Fixes

### Issue: Nodes showing IP addresses instead of FQDNs
**Fix**: The cluster-announce-ip command might not be working. Check if the command is actually setting it:
```bash
kubectl exec -it vm-x-ai-redis-cluster-0 -n vm-x-ai -- ps aux | grep redis-server
```

### Issue: DNS resolution failing
**Fix**: Check if CoreDNS is working and the service exists:
```bash
kubectl get svc -n vm-x-ai | grep redis
kubectl get endpoints -n vm-x-ai vm-x-ai-redis-cluster
```

### Issue: Cluster not fully initialized
**Fix**: Check the init job:
```bash
kubectl get jobs -n vm-x-ai | grep redis-cluster-init
kubectl logs -n vm-x-ai -l app.kubernetes.io/component=redis --tail=50
```

