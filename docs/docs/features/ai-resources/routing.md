---
sidebar_position: 2
---

# Dynamic Routing

Routing allows you to dynamically select different models based on request characteristics. This enables intelligent request distribution, cost optimization, and performance tuning.

![Dynamic Routing Configuration](/pages/ai-resource-dynamic-route1.png)

## Overview

Dynamic routing evaluates conditions for each request and selects the most appropriate model based on:

- **Token count**: Route small requests to faster/cheaper models
- **Error rates**: Automatically switch providers when error rates are high
- **Tool usage**: Route tool-enabled requests to models that support tools
- **Content analysis**: Route based on message content or patterns
- **Traffic splitting**: A/B test models or gradually roll out new models

Routing is one knob on an AI Resource and runs **once per request**,
before any provider call. Its job is to pick the _first_ model the
gateway will try. After routing produces a model, the resource's
[fallback](./fallback.md) chain still runs if that model fails, and
the resource's [capacity](./capacity.md) limits still apply. The same
routing rules fire for any of the three gateway surfaces — OpenAI
Chat Completions, OpenAI Responses, and Anthropic Messages — because
non-Responses requests are converted to the canonical Responses shape
before routing evaluates conditions.

## Basic Routing

Route based on simple conditions. This example demonstrates token-based routing, where requests with fewer than 100 input tokens are routed to a faster, cost-effective model (Groq with `openai/gpt-oss-20b`), while larger requests use the default primary model.

**Use Case**: Optimize costs and latency by routing small, simple queries to faster models while reserving more powerful models for complex requests.

**How it works**: The routing condition evaluates `tokens.input` using the `LESS_THAN` comparator with a value of 100. When a request has fewer than 100 input tokens, it automatically routes to the specified Groq connection and model instead of the primary model.

![Basic Routing Configuration](/pages/ai-resource-dynamic-basic-routing.png)

## Routing Based on Error Rate

Automatically switch to a different provider when error rates exceed a threshold. This example monitors the error rate over the last 5 minutes and routes to Groq with `openai/gpt-oss-20b` if the error rate exceeds 10%.

**Use Case**: Maintain high availability by automatically failing over to a backup provider when the primary provider experiences issues. This is especially useful for production workloads where uptime is critical.

**How it works**: The routing condition uses `errorRate(10)` to calculate the error percentage over the last 5 minutes. When this percentage exceeds 10% (using the `GREATER_THAN` comparator), all subsequent requests are routed to the specified Groq connection and model until the error rate drops below the threshold.

**Benefits**:

- Automatic failover without manual intervention
- Reduces downtime during provider outages
- Helps maintain service reliability

![Error Rate Routing Configuration](/pages/ai-resource-dynamic-error-rate.png)

## Routing Based on Tools Usage

Route requests that include function calling or tool usage to models that support these features. This example routes any request with tools to Groq with `openai/gpt-oss-20b`, which supports tool/function calling.

**Use Case**: Ensure requests requiring function calling or tool usage are handled by models with robust tool support, while simpler requests can use more cost-effective models.

**How it works**: The routing condition checks `request.toolsCount` using the `GREATER_THAN` comparator with a value of 0. When a request includes one or more tools (toolsCount > 0), it routes to the specified Groq connection and model.

**Benefits**:

- Guarantees tool-enabled requests use compatible models
- Prevents tool-related errors from using incompatible models
- Optimizes costs by only using premium models when needed

![Tools-Based Routing Configuration](/pages/ai-resource-dynamic-has-tools.png)

## Routing Based on Metadata

Route based on per-request metadata stamped by the caller. Useful for routing premium tenants to a different model, sending a specific team's traffic through a cheaper one, or isolating a noisy customer onto its own connection.

**Use Case**: Per-tenant / per-user / per-team routing without forking the upstream caller code — just attach a `userId`, `team`, `tenantId` (or whatever you like) on the request and let the routing engine pick the right model.

**How metadata reaches the gateway**:

- Body envelope: `{ vmx: { metadata: { team: "growth" } }, … }`
- Headers: `x-vmx-metadata-team: growth` (one header per key)
- Header and body keys are unioned; body wins on collision.

**How the rule works**: Pick the **"Metadata field equals ..."** preset in the rule selector. The editor renders two suggesting inputs — a **Field** picker (autocomplete sourced from metadata keys observed on recent audits) and a **Value** picker (autocomplete sourced from values observed for the chosen field). The chosen field is encoded into the saved rule as `metadata['<field>']`, so the engine reads `payload.vmx.metadata[<field>]` at request time.

**Example template** (advanced mode, equivalent to the preset):

```ejs
metadata['team']
```

Comparator: `EQUAL`, value: `growth`. The rule fires when `request.vmx.metadata.team === 'growth'`. Both `metadata.team` and `request.metadata.team` resolve to the same value if you'd rather write the path manually.

**Benefits**:

- No upstream code change beyond stamping the metadata field once.
- Field + value pickers learn from the audit history, so by the second send you no longer have to type from memory.
- Works through every public endpoint (Chat Completions / Responses / Anthropic Messages) since the envelope rides on top of all three.

## Routing Based on Capacity Usage

Route away from a saturated connection **before** it 429s. The `capacityUsage()` helper exposes live request / token usage as a percentage of the tightest configured (or auto-discovered) limit, so a rule can flip traffic to a backup model when the primary is e.g. 80% full.

**Use Case**: Smooth-out provider rate limits without leaning entirely on retries / fallback. Particularly useful when one provider's minute-bucket cap is materially lower than the alternative's, or when you have an OpenAI auto-discovered limit and a Gemini connection with massive headroom.

**Four built-in presets** (pick whichever axis matters):

- **Token usage (last minute) is greater than ...** — fires when `tokensUsagePercent > N`.
- **Request usage (last minute) is greater than ...** — same for the request-count axis.
- **Remaining tokens (this minute) less than ...** — absolute headroom on tokens.
- **Remaining requests (this minute) less than ...** — absolute headroom on requests.

**How it works**: The helper unions configured caps (Connection + Resource + API Key) with the connection's auto-discovered limits (refreshed off provider `x-ratelimit-limit-*` response headers, dropped if older than 7 days). It picks the cap closest to saturation on each axis and returns its `requestsUsagePercent` / `tokensUsagePercent` / `remainingRequests` / `remainingTokens`. Source-IP-dimensioned and metadata-dimensioned caps are read against their per-bucket counter, so per-caller usage drives the rule when the cap is configured per-caller.

**Example template** (advanced mode):

```ejs
<% return (await capacityUsage("minute"))?.tokensUsagePercent %>
```

Comparator: `GREATER_THAN`, value: `80`. Fires when the connection's tightest token limit is at 80%+. The helper takes optional `(period, connectionId, model)` arguments — defaults to the resource's primary connection and the current minute.

**Benefits**:

- Proactive load shedding — route away from saturation **before** the 429.
- Works with any cap you've configured (Connection / Resource / API Key) plus the provider's own auto-discovered rate limit.
- Multi-axis rules ("if tokens > 80% OR requests > 80%") only pay one Redis read per probe — the engine memoises per `(period, connection, model)`.

**Limitations**:

- When no source defines a cap on an axis, the corresponding `*UsagePercent` is `null` — the rule's comparator drops to `false`, so an unlimited-axis check is naturally inert. If you rely on `capacityUsage`, make sure the underlying cap is configured.
- `requestTokens` from the in-flight request is not folded in by default. If you want a rule to fire on the request that would push usage **over** the line (rather than the one after), pull `tokens.input` into the comparator: `<% return (await capacityUsage()).totalTokens + tokens.input %>` against a numeric threshold.

## Available Routing Fields and Expressions

Routing conditions evaluate against a small set of request-shaped
variables. The **canonical shape is OpenAI Responses** — Chat
Completions and Anthropic Messages requests are converted to the
Responses shape before routing runs, so the same template works
across all three gateway surfaces. See the
[`RoutingContext`](https://github.com/vm-x-ai/open-vm-x-ai/blob/main/packages/api/src/gateway/routing.context.ts)
type and
[`ResourceRoutingService`](https://github.com/vm-x-ai/open-vm-x-ai/blob/main/packages/api/src/gateway/routing.service.ts)
for the exact set of variables exposed to EJS.

### Token-Based Conditions

- **`tokens.input`**: Number of input tokens in the request
  - Example: Route to Groq if input tokens < 100

### Request Conditions (Canonical Responses Shape)

Spread of the canonical Responses-shape body, so any Responses field
is reachable as `request.<field>`:

- **`request.model`**: The resource name the caller targeted.
- **`request.input`**: The Responses input items array (or string).
- **`request.instructions`**: Responses-style system instructions.
- **`request.tools`**: Tool definitions attached to the request.
- **`request.reasoning`**: Reasoning config block when present.

### Derived Convenience Variables

To keep familiar Chat-Completions-style expressions working, the
routing engine derives a few helpers from the canonical Responses
body:

- **`request.messages`**: A `{ role, content }[]` view derived from
  `instructions` + `input` (`developer` items collapse into `system`).
  Function-call items and tool-result items are skipped — branch on
  `request.input` directly if you need them.
- **`request.messagesCount`**: Length of the derived `messages` array.
- **`request.toolsCount`**: `request.tools?.length ?? 0`. Use
  `GREATER_THAN 0` to check whether the request uses tools at all.
- **`request.firstMessage`** / **`request.lastMessage`**: First and
  last derived message objects. Read `.content` for the text body.
  Both are `undefined` when the request has no messages.
- **`request.allMessagesContent`**: All derived message contents
  joined into a single string. Supports `CONTAINS` and `PATTERN`.
  Length-based routing uses `request.allMessagesContent.length` with
  a numeric comparator.

### Format and Native-Body Conditions

Routing rules can also branch on the **input format** the client
used and read fields the canonical Responses conversion drops:

- **`request.format`**: One of `"chat-completions"`, `"responses"`,
  `"anthropic"`. Lets a single resource apply different rules
  depending on which endpoint was hit.
- **`request.nativeBody`**: The original request body, before
  format conversion. Use this to read provider-native fields that
  the canonical shape doesn't model — for example
  `request.nativeBody.thinking` (Anthropic extended thinking) or
  `request.nativeBody.cache_control` (Anthropic prompt caching).
  When `request.format === 'chat-completions'` it's the OpenAI
  Chat Completions body; when `'responses'` it's the original
  Responses body (same as `request`); when `'anthropic'` it's the
  Anthropic Messages body.

These fields are evaluated through EJS, so they appear in advanced-
mode routing expressions like
`<%= request.format === 'anthropic' && request.nativeBody.thinking %>`.

### Metadata Variables

Per-request metadata stamped by the caller (via `vmx.metadata` body envelope or `x-vmx-metadata-<key>` headers) is exposed at two paths — same object reference, so they always agree:

- **`metadata['<key>']`** (top-level) — matches the way `tokens.input` reads.
- **`request.metadata['<key>']`** — matches the way `request.lastMessage` reads.

Use bracket notation when the key may contain a dot or special character; plain dot syntax (`metadata.userId`) is fine when the key is a simple identifier. Saved rules from earlier versions that used optional chaining (`request.metadata?.['userId']`) keep working — the engine normalises `?.` to `.` before path lookup.

- Example: Route premium tenants — `metadata['tier'] EQUAL "premium"`.
- Example: Per-team routing — `metadata['team'] EQUAL "growth"`.

### Error-Rate Function

- **`errorRate(windowMinutes)`** — async function returning the
  error-rate percentage for the resource's primary
  connection/model over the last `windowMinutes`. Defaults to
  10 minutes when called with no argument. Supports the numeric
  comparators (`GREATER_THAN`, `LESS_THAN`, …).
  - Example: Switch providers when `errorRate(5) GREATER_THAN 10`
    (more than 10% errors in the last 5 minutes).

### Capacity-Usage Function

- **`capacityUsage(period, aiConnectionId?, model?)`** — async function returning a live snapshot of capacity usage for a `(connection, model, period)` triple. Defaults to the resource's primary connection/model and `"minute"` period. Returns an object with these fields (every derived field is `null` when the corresponding limit is unconfigured):
  - `totalRequests`, `totalTokens` — absolute counts from the limiting cap's counter.
  - `requestsLimit`, `tokensLimit` — the tightest applicable limit across configured (Connection + Resource + API Key) and auto-discovered sources.
  - `requestsLimitSource`, `tokensLimitSource` — `'connection' | 'resource' | 'api-key' | 'discovered'` so advanced rules can special-case discovered limits.
  - `remainingRequests`, `remainingTokens` — `limit − total`, never below 0.
  - `requestsUsagePercent`, `tokensUsagePercent` — `0..100`, clamped.
  - `remainingSeconds` — until the period rolls over.
- Pair with the EJS template form, since the result is an object:
  - `<% return (await capacityUsage("minute"))?.tokensUsagePercent %>` GREATER_THAN 80
  - `<% return (await capacityUsage()).remainingRequests %>` LESS_THAN 5
- Memoised per `(period, connection, model)` within a single request, so multi-group rules don't multiply Redis reads.

## Available Comparators

The full set, all of which are valid on numeric and string fields
where it makes sense:

- Equality: `EQUAL`, `NOT_EQUAL`
- Numeric: `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`,
  `LESS_THAN_OR_EQUAL`
- String: `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`,
  `PATTERN` (regex)
- Membership: `IN`, `NOT_IN` (against a comma-delimited list or
  JSON array value)
- Existence: `EXISTS` (truthy check)

## Routing Actions

Each route declares an action. There are two:

- **`CALL_MODEL`** — when the route matches, the request is
  dispatched to the configured `then` model (provider, connection,
  model, and optional per-model `maxRetries` / `timeoutMs`). This
  is the default action used by token-based, error-rate-based, and
  traffic-splitting routes.
- **`BLOCK`** — when the route matches, the gateway short-circuits
  and returns `400 Bad Request` with an OpenAI-compatible
  `blocked_by_routing_condition` error to the caller without
  calling any provider. Use this to enforce policy at the routing
  layer (for example, block requests whose prompt matches a known
  prompt-injection probe). Blocked requests are also marked
  non-retryable, so fallback does **not** run.

## Traffic Splitting

Use traffic splitting for A/B testing, gradual rollouts, or canary deployments. This example routes 50% of requests matching the condition (input tokens > 0) to Groq with `openai/gpt-oss-20b`, while the other 50% use the default primary model.

**Use Case**:

- **A/B Testing**: Compare performance, quality, or cost between different models
- **Gradual Rollouts**: Safely introduce new models by starting with a small percentage of traffic
- **Canary Deployments**: Test new models in production with limited exposure

**How it works**: The routing condition matches any requests, but the `traffic` field limits this route to only 50% of matching requests. The remaining 50% of matching requests continue to use the primary model. This creates a controlled split where you can monitor and compare both models' performance.

**Best Practices**:

- Start with a low percentage (10-20%) when testing new models
- Monitor error rates, latency, and quality metrics for both routes
- Gradually increase the percentage as confidence grows
- Use audit logs to track which route each request took

The `traffic` field is set on the route's `then` model config and
specifies the percentage (0-100) of matching requests that should use
this route. Routes are evaluated in declared order; on a match without
`traffic`, the first matching route wins. With `traffic`, the gateway
rolls dice — if the dice roll fails, evaluation continues to the next
route, so a downstream route can still pick up the remaining
percentage. If no route matches, the resource's primary model is used.

![Traffic Splitting Configuration](/pages/ai-resource-dynamic-traffic.png)

## Best Practices

### 1. Start with Simple Conditions

Begin with basic routing:

- Token-based routing (small vs. large requests)
- Tool-based routing (requests with/without tools)
- Error rate-based routing (fallback when errors are high)
- Metadata-based routing (per-tenant, per-team, per-user)
- Capacity-usage routing (route away from saturated connections proactively)

### 2. Test Routing Conditions

Before deploying:

- Test routing conditions with sample requests
- Verify routing logic works as expected
- Monitor routing decisions in audit logs

### 3. Use Traffic Splitting for Rollouts

Gradually roll out new models:

- Start with low traffic percentage (10-20%)
- Monitor performance and errors
- Gradually increase traffic percentage
- Fully switch when confident

### 4. Monitor Routing Decisions

Regularly review:

- Which routes are being used most
- Routing decision patterns
- Performance differences between routes
- Error rates per route

## Troubleshooting

### Routing Not Working

1. **Check Routing Enabled**: Ensure routing is enabled in the resource configuration
2. **Verify Conditions**: Check routing conditions are correct and match your use case
3. **Review Logs**: Check audit logs for routing decisions to see which conditions are being evaluated
4. **Test Conditions**: Test routing conditions with sample requests to verify they work as expected

### Wrong Model Selected

1. **Check Condition Order**: Routing conditions are evaluated in order - ensure conditions are ordered correctly
2. **Verify Expressions**: Check that expressions match the request characteristics
3. **Review Traffic Splitting**: If using traffic splitting, verify the percentage is set correctly
4. **Check Connection Availability**: Ensure the selected connection and model are available and configured correctly

### Metadata Rule Never Fires

1. **Verify the metadata reached the gateway**: Open the audit row for a recent request — the `metadata` column should contain your key. If it doesn't, the caller isn't stamping it.
2. **Check the field name matches exactly**: Metadata keys are case-sensitive. `userId` and `user_id` are different keys.
3. **Inspect the saved expression**: It should look like `metadata['<your-field>']` (or the legacy `request.metadata?.['<your-field>']`, which still works). Anything else and the rule probably got hand-edited; re-pick "Metadata field equals ..." from the rule selector.

### Capacity-Usage Rule Never Fires

1. **Confirm the underlying cap is configured**: `capacityUsage()` returns `null` percents when no cap is set on that axis. Add a request or token cap (Connection / Resource / API Key) or rely on the provider's auto-discovered limit (only populated after the first successful call).
2. **Check the period**: The default is `"minute"`. If you're testing manually, you have ≤60 seconds before the bucket rolls over and resets the counter.
3. **Inspect the limiting source**: `(await capacityUsage()).requestsLimitSource` tells you which cap the helper is reading. If it's `'discovered'` and you just changed the configured cap, the discovered limit is still tighter.

## Next Steps

- [Fallback](./fallback.md) - Configure automatic fallback
- [Capacity](./capacity.md) - Set resource-level capacity limits, including `source-ip` and `metadata` dimensions that drive per-caller / per-tenant rate limits
- [AI Resources Overview](./index.md) - Return to AI Resources overview
