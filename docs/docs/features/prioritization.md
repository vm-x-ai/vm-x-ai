---
sidebar_position: 3
---

# Prioritization

Prioritization allows you to allocate capacity across multiple AI resources, ensuring fair distribution and optimal resource utilization. This guide explains how prioritization works and how to configure it.

## What is Prioritization?

Prioritization is a system that:

- **Allocates Capacity**: Distributes available capacity across multiple resources
- **Ensures Fairness**: Prevents one resource from consuming all capacity
- **Adapts Dynamically**: Adjusts allocation based on usage patterns
- **Supports Multiple Strategies**: Uses sophisticated algorithms for allocation

## How It Works

### Pool Definition

A **Pool Definition** groups resources together and defines how capacity should be allocated:

```json
{
  "definition": [
    {
      "name": "high-priority",
      "resources": ["resource-1", "resource-2"],
      "minReservation": 50,
      "maxReservation": 100
    },
    {
      "name": "low-priority",
      "resources": ["resource-3", "resource-4"],
      "minReservation": 0,
      "maxReservation": 50
    }
  ]
}
```

### Allocation Strategy

VM-X AI uses an **Adaptive Token Scaling** strategy that:

1. **Tracks Usage**: Monitors token usage per resource and pool
2. **Calculates Available Capacity**: Determines how much capacity is available
3. **Allocates Dynamically**: Adjusts allocation based on demand
4. **Enforces Limits**: Ensures resources don't exceed their allocation

### Capacity Gates

When a request is made:

1. **Connection Capacity Check**: Verify connection has available capacity
2. **Resource Capacity Check**: Verify resource has available capacity
3. **Prioritization Gate**: Check if request should proceed based on prioritization
4. **Request Processing**: If all gates pass, process the request

## Configuring Prioritization

1. Navigate to **Prioritization** in the UI
2. Click **Edit Pool Definition**
3. Configure pools:
   - **Pool Name**: Name for the pool
   - **Resources**: Resources assigned to this pool
   - **Min Reservation**: Minimum percentage of capacity reserved
   - **Max Reservation**: Maximum percentage of capacity available

## Pool Configuration

### Pool Properties

- **name**: Unique name for the pool
- **resources**: Array of resource IDs assigned to this pool
- **minReservation**: Minimum percentage (0-100) of capacity reserved for this pool
- **maxReservation**: Maximum percentage (0-100) of capacity available to this pool

### Example Configuration

```json
{
  "definition": [
    {
      "name": "production",
      "resources": ["prod-chat", "prod-embeddings"],
      "minReservation": 70,
      "maxReservation": 100
    },
    {
      "name": "development",
      "resources": ["dev-chat", "dev-testing"],
      "minReservation": 0,
      "maxReservation": 30
    }
  ]
}
```

This configuration:
- Reserves 70% of capacity for production resources
- Allows production to use up to 100% if available
- Allows development to use up to 30% if available
- Development gets 0% minimum (can be starved if production uses all capacity)

## Adaptive Token Scaling Algorithm

The prioritization system uses an **Adaptive Token Scaling** algorithm to dynamically allocate capacity based on actual usage patterns. This algorithm automatically adjusts pool allocations in real-time to optimize capacity utilization while respecting min/max reservations.

### How It Works

The algorithm continuously monitors token usage and adjusts allocations using the following process:

1. **Monitor Usage**: Track token usage per pool over a configurable time window (default: 30 seconds)
2. **Calculate Scale-Up Threshold**: For each pool, calculate if current usage exceeds 50% of its allocated capacity
3. **Scale Up**: If threshold is exceeded and capacity is available, increase the pool's allocation up to its max reservation
4. **Scale Down**: If a pool is using less than its allocated capacity and a cooldown period has passed, reduce allocation down to its min reservation
5. **Respect Limits**: Ensure allocations always stay within min/max reservations and total allocation never exceeds 100%

### Algorithm Parameters

The algorithm uses the following configurable parameters:

- **Window Size**: 30 seconds - Time window to analyze token usage
- **Scale Up Threshold**: 50% - Percentage of current allocation that triggers scale-up
- **Cooldown**: 5 seconds - Minimum time between scale-downs to prevent oscillation

### Algorithm Behavior

#### Scale-Up Logic

For each pool, the algorithm:
1. Calculates consumed tokens: `(connection capacity) × (current allocation %)`
2. Calculates scale-up threshold: `consumed tokens × 50%`
3. If window tokens > threshold:
   - Calculates desired allocation based on actual usage
   - Scales up to the minimum of: desired allocation, max reservation, available capacity
   - If available capacity is insufficient, scales down lower-priority pools

#### Scale-Down Logic

For pools that recently scaled up:
1. Checks if current usage is less than allocated capacity
2. Verifies cooldown period has passed (5 seconds)
3. Scales down to the maximum of: actual usage percentage, min reservation

#### Capacity Redistribution

When a high-priority pool needs to scale up but capacity is full:
- Lower-priority pools (those ranked after the scaling pool) are scaled down
- Scale-down respects min reservations
- Only pools that are above their min reservation can be scaled down

### Example Scenario

Given a connection with 100,000 TPM capacity and two pools:

- **Chat** (high priority): Min 50%, Max 100%
- **Processing Documents** (low priority): Min 0%, Max 50%

**Scenario 1: Low Chat Usage**
- Chat uses 30,000 TPM (30% of capacity)
- Chat allocation: 50% (min reservation)
- Processing Documents can use up to 50,000 TPM (50% max reservation)

**Scenario 2: High Chat Usage**
- Chat uses 80,000 TPM (80% of capacity)
- Chat allocation scales up to 80%
- Processing Documents can use up to 20,000 TPM (remaining 20%)

**Scenario 3: Chat Needs More Capacity**
- Chat needs 90,000 TPM but only 80% allocated
- Chat scales up to 90% (within max 100%)
- Processing Documents scales down to 10% (within min 0%)

### Tuning Recommendations

The algorithm's behavior depends on the relationship between window size and scale-up threshold:

- **Low window size + High scale-up**: Responds well to fast peaks, but requires significant usage to trigger
- **High window size + Low scale-up**: Scales up faster for small peaks, considers longer time periods
- **Low window size + Low scale-up**: Fastest response, but may be sensitive to inconsistent traffic
- **High window size + High scale-up**: Most stable for most scenarios, considers longer periods and avoids rapid scale-downs

For most production scenarios, the default values (30s window, 50% threshold) provide a good balance between responsiveness and stability.

## Best Practices

### 1. Define Clear Pools

Group resources logically:
- By environment (production, staging, development)
- By priority (high, medium, low)
- By team or project
- By cost tier

### 2. Set Realistic Reservations

- **Min Reservation**: Set based on guaranteed needs
- **Max Reservation**: Set based on maximum acceptable usage
- **Balance**: Ensure total min reservations don't exceed 100%

### 3. Monitor Allocation

Regularly review:
- Actual allocation vs. configured reservations
- Resource usage patterns
- Capacity utilization
- Rejection rates

### 4. Adjust Based on Usage

Update pool definitions based on:
- Actual usage patterns
- Business priorities
- Cost considerations
- Performance requirements

### 5. Test Changes

Before deploying:
- Test pool definition changes
- Verify allocation works as expected
- Monitor for issues
