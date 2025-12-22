---
sidebar_position: 4
---

# Resource-Level Capacity

Define capacity limits specific to a resource. This allows you to control usage per resource independently and implement tiered access levels.

![Resource Capacity Configuration](/pages/ai-resource-capacity.png)

## Overview

Resource-level capacity provides:

- **Independent Limits**: Set capacity limits per resource, independent of connection limits
- **Cost Control**: Control spending by limiting usage per resource
- **Tiered Access**: Implement different capacity tiers for different resources
- **Fair Usage**: Ensure fair distribution of capacity across resources

## Configuring Resource Capacity

Define capacity limits for a resource:

```json
{
  "capacity": [
    {
      "period": "minute",
      "requests": 50,
      "tokens": 50000
    },
    {
      "period": "hour",
      "requests": 2000,
      "tokens": 2000000
    },
    {
      "period": "day",
      "requests": 50000,
      "tokens": 50000000
    }
  ],
  "enforceCapacity": true
}
```

### Capacity Periods

Capacity can be defined for multiple time periods:

- **minute**: Requests per minute (RPM) and tokens per minute (TPM)
- **hour**: Requests per hour and tokens per hour
- **day**: Requests per day and tokens per day

### Capacity Enforcement

When `enforceCapacity` is `true`:

- Resource-level capacity is checked **before** connection-level capacity
- Requests exceeding resource capacity are rejected with `429 Too Many Requests`
- Useful for:
  - Limiting usage per resource independently
  - Controlling costs by resource
  - Implementing tiered access levels

When `enforceCapacity` is `false`:

- Resource-level capacity is not enforced
- Only connection-level capacity is checked
- Useful for resources that should share connection capacity freely

## How Resource Capacity Works

Resource capacity is checked in the following order:

1. **Resource Capacity Check** (if `enforceCapacity` is `true`)
   - Check if request exceeds resource-level limits
   - Reject if limit exceeded
2. **Connection Capacity Check**
   - Check if request exceeds connection-level limits
   - Reject if limit exceeded
3. **Prioritization Gate** (if prioritization is configured)
   - Check if request should proceed based on prioritization
   - Reject if gate denies request

### Example Scenario

Consider a connection with 100,000 TPM capacity and two resources:

**Connection Configuration:**

- Capacity: 100,000 TPM

**Resource A:**

- Capacity: 50,000 TPM
- `enforceCapacity`: `true`

**Resource B:**

- Capacity: 30,000 TPM
- `enforceCapacity`: `true`

**Request Flow:**

1. Request to Resource A (60,000 tokens)

   - Resource capacity check: 60,000 > 50,000 → **Rejected** (429)
   - Connection capacity check: Not reached (only 60,000 used)

2. Request to Resource A (40,000 tokens)

   - Resource capacity check: 40,000 ≤ 50,000 → **Pass**
   - Connection capacity check: 40,000 ≤ 100,000 → **Pass**
   - Request proceeds

3. Request to Resource B (35,000 tokens)
   - Resource capacity check: 35,000 > 30,000 → **Rejected** (429)
   - Connection capacity check: Not reached

## Best Practices

### 1. Set Realistic Limits

Set capacity limits based on:

- Expected usage patterns
- Business requirements
- Cost constraints
- Performance needs

### 2. Use Multiple Periods

Define capacity for multiple periods:

- **Minute**: For burst protection
- **Hour**: For sustained usage limits
- **Day**: For daily spending limits

### 3. Balance Resource and Connection Capacity

Ensure resource capacity doesn't exceed connection capacity:

- Resource A: 50,000 TPM
- Resource B: 30,000 TPM
- Connection: 100,000 TPM
- Total: 80,000 TPM (leaves 20,000 TPM buffer)

### 4. Monitor Capacity Usage

Regularly review:

- Actual usage vs. configured limits
- Rejection rates due to capacity
- Capacity utilization patterns
- Need for capacity adjustments

### 5. Use with Prioritization

Combine resource capacity with prioritization:

- Set resource capacity limits
- Use prioritization to allocate capacity fairly
- Ensure high-priority resources get capacity when needed

## Capacity vs. Connection Capacity

### Resource Capacity

- **Scope**: Per resource
- **Enforcement**: Optional (via `enforceCapacity`)
- **Use Case**: Control usage per resource independently
- **Example**: Limit "chat-completion" resource to 50,000 TPM

### Connection Capacity

- **Scope**: Per connection (shared across all resources)
- **Enforcement**: Always enforced
- **Use Case**: Control total usage across all resources
- **Example**: Limit OpenAI connection to 100,000 TPM total

### Combined Usage

Both capacity types work together:

1. Resource capacity limits usage per resource
2. Connection capacity limits total usage across all resources
3. Requests must pass both checks to proceed

## Troubleshooting

### Capacity Limits Too Restrictive

1. **Review Capacity Configuration**: Check if limits are too low for actual usage
2. **Monitor Usage**: Review actual usage patterns to understand needs
3. **Adjust Limits**: Increase capacity limits as needed
4. **Consider Prioritization**: Use prioritization to allocate capacity fairly instead of hard limits

### Capacity Not Being Enforced

1. **Check `enforceCapacity`**: Ensure `enforceCapacity` is `true` if you want resource capacity enforced
2. **Verify Configuration**: Check that capacity is configured correctly
3. **Review Logs**: Check logs to see if capacity checks are being performed
4. **Test Limits**: Test with requests that should exceed limits to verify enforcement

### Unexpected Rejections

1. **Check Both Capacities**: Verify both resource and connection capacity
2. **Review Usage Patterns**: Check if usage patterns have changed
3. **Monitor Metrics**: Review capacity utilization metrics
4. **Check Prioritization**: Verify prioritization isn't causing rejections

## Next Steps

- [Dynamic Routing](./routing.md) - Learn about dynamic routing rules
- [Fallback](./fallback.md) - Configure automatic fallback
- [AI Resources Overview](./index.md) - Return to AI Resources overview
- [Prioritization](../prioritization.md) - Understand capacity prioritization
