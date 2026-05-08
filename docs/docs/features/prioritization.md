---
sidebar_position: 3
---

# Prioritization

Prioritization allows you to allocate capacity across multiple AI resources, ensuring fair distribution and optimal resource utilization. This guide explains how prioritization works and how to configure it.

## What is Prioritization?

Prioritization is a system that:

- **Allocates Capacity**: Distributes available AI Connection capacity (TPM) across pools of resources
- **Ensures Fairness**: Reserves a guaranteed minimum slice for each pool so high-priority workloads can't be fully starved
- **Adapts Dynamically**: Scales each pool's current allocation up and down based on observed token usage
- **Runs as a Gate**: Rejects requests whose pool has exceeded its current allocation, returning a structured reason

A pool definition is scoped per **workspace + environment** (one definition per environment) and is upserted via the `POST /pool-definition/{workspaceId}/{environmentId}` API or the **Prioritization** page in the UI.

## How It Works

### Pool Definition

A **Pool Definition** is a list of entries. Each entry groups one or more AI Resources and declares how much of the connection's TPM capacity that group is allowed to claim:

```json
{
  "definition": [
    {
      "name": "high-priority",
      "rank": 0,
      "resources": ["resource-uuid-1", "resource-uuid-2"],
      "minReservation": 50,
      "maxReservation": 100
    },
    {
      "name": "low-priority",
      "rank": 1,
      "resources": ["resource-uuid-3", "resource-uuid-4"],
      "minReservation": 0,
      "maxReservation": 50
    }
  ]
}
```

Each entry has:

- **name**: Unique name for the entry
- **rank**: Priority order — lower `rank` is evaluated first and is scaled up at the expense of higher-`rank` entries when capacity is tight
- **resources**: Array of AI Resource IDs (UUIDs) assigned to this entry. A resource may only belong to one entry
- **minReservation**: Minimum percentage (0-100) of the connection's TPM that is always reserved for this entry
- **maxReservation**: Maximum percentage (0-100) the entry can scale up to

The sum of all `minReservation` values must not exceed 100. Allocations are expressed as percentages of the AI Connection's `MINUTE` token capacity (see [AI Connection capacity](./ai-connections.md)).

### Allocation Strategy

VM-X AI ships a single allocation strategy today: **Adaptive Token Scaling**
(`AdaptiveTokenScalingStrategy` in `packages/api/src/prioritization/strategy/adaptive-token-scaling.ts`).
The `PrioritizationService` always dispatches to it. The strategy:

1. **Tracks Usage**: Records per-pool token consumption against the connection's MINUTE capacity plan
2. **Computes Allocations**: Maintains a `current` percentage per entry, bounded by `[minReservation, maxReservation]`
3. **Scales Dynamically**: Grows or shrinks `current` as observed usage drifts above/below thresholds
4. **Gates the Request**: After updating allocations, rejects the request if the resource's pool is already over its current allocated percentage of MINUTE tokens

### Prioritization Gate

For each completion / responses / messages request, the gateway calls the prioritization gate after resolving the request's resource and connection. The gate:

1. Finds the pool entry that owns the request's resource
2. Loads (or initializes) the per-connection allocation map
3. Re-runs the Adaptive Token Scaling logic against the latest metrics
4. Returns `{ allowed: true, allocation }` if the resource's pool is still under its current allocation, or `{ allowed: false, allocation, reason }` otherwise

Capacity enforcement (TPM/RPM caps on the connection and resource) is a **separate** mechanism — see [Capacity Management](./ai-resources/capacity.md). Prioritization runs on top of capacity to subdivide the connection's TPM among pools.

## Configuring Prioritization

1. Navigate to **Prioritization** in the UI for the target workspace + environment
2. Click **Add Pool** to create a new entry, or edit an existing row inline
3. For each entry, set:
   - **Name**
   - **Rank** (lowest first = highest priority)
   - **Resources** (multi-select of AI Resources in the environment)
   - **Min Reservation** / **Max Reservation** (percentages)
4. Save. The full definition is upserted via `POST /pool-definition/{workspaceId}/{environmentId}`

### Example Configuration

```json
{
  "definition": [
    {
      "name": "production",
      "rank": 0,
      "resources": ["prod-chat-uuid", "prod-embeddings-uuid"],
      "minReservation": 70,
      "maxReservation": 100
    },
    {
      "name": "development",
      "rank": 1,
      "resources": ["dev-chat-uuid", "dev-testing-uuid"],
      "minReservation": 0,
      "maxReservation": 30
    }
  ]
}
```

This configuration:

- Reserves 70% of MINUTE capacity for production resources at all times
- Allows production to scale up to 100% under load
- Caps development at 30% of MINUTE capacity
- Lets development be fully scaled down (to 0%) when production needs the headroom

## Adaptive Token Scaling Algorithm

The prioritization system uses an **Adaptive Token Scaling** algorithm to dynamically allocate capacity based on actual usage patterns. This algorithm automatically adjusts pool allocations in real-time to optimize capacity utilization while respecting min/max reservations.

### How It Works

The algorithm continuously monitors token usage and adjusts allocations using the following process:

1. **Monitor Usage**: Track token usage per pool over a fixed time window (30 seconds)
2. **Calculate Scale-Up Threshold**: For each pool, check if recent token usage exceeds 50% of its currently-allocated TPM share
3. **Scale Up**: If the threshold is exceeded and headroom is available, increase the pool's allocation up to its `maxReservation`
4. **Scale Down**: If a pool is using less than its allocated capacity and the cooldown has elapsed, reduce allocation down to (but not below) its `minReservation`
5. **Respect Limits**: Allocations always stay within `[minReservation, maxReservation]` and the sum across pools never exceeds 100%

### Algorithm Parameters

The current implementation uses the following constants (defined in `adaptive-token-scaling.ts`, not user-configurable today):

- **Window Size**: 30 seconds — sliding window used to read each pool's token usage
- **Scale Up Threshold**: 50% — fraction of the pool's current allocated tokens that, once exceeded by the window's usage, triggers scale-up
- **Cooldown**: 5 seconds — minimum time after a scale-up before the same pool may scale down (prevents oscillation)

### Algorithm Behavior

#### Scale-Up Logic

For each entry (in `rank` order), the algorithm:

1. Calculates allocated tokens: `(connection MINUTE token capacity) × (current allocation %)`
2. Calculates scale-up threshold: `allocated tokens × 50%`
3. If window tokens > threshold:
   - Computes desired allocation from actual usage as a percentage of the connection capacity
   - Scales up by the minimum of: desired allocation, remaining headroom to `maxReservation`, and free capacity across all pools
   - If free capacity is insufficient, scales down higher-`rank` entries (lower-priority pools) to free up room — never below their `minReservation`

#### Scale-Down Logic

For an entry whose last action was a scale-up:

1. Checks that current allocated tokens exceed the window's actual usage
2. Verifies the 5s cooldown has elapsed since the last scale action
3. Scales down to `max(window usage %, minReservation)` (and clamps to `0` if window usage exceeds `maxReservation`, which is a safety branch)

#### Capacity Redistribution

When a higher-priority entry (lower `rank`) needs to scale up but no free capacity remains:

- Entries with a higher `rank` (those evaluated later) are scaled down first
- Scale-down respects each entry's `minReservation` floor
- Only entries currently above their `minReservation` can contribute headroom

### Example Scenario

Given a connection with 100,000 MINUTE TPM capacity and two entries:

- **Chat** (`rank: 0`): Min 50%, Max 100%
- **Processing Documents** (`rank: 1`): Min 0%, Max 50%

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

## Next Steps

- [AI Connections](./ai-connections.md) — where the MINUTE TPM capacity that prioritization subdivides is defined
- [Capacity Management](./ai-resources/capacity.md) — the underlying TPM/RPM enforcement that prioritization layers on top of
- [AI Resources](./ai-resources/index.md) — the resources that get grouped into pool entries
- [Chat Completions API](./api/chat-completions.md), [Responses API](./api/responses.md), [Anthropic Messages API](./api/anthropic-messages.md) — the request paths the prioritization gate runs on
