# Dynamic Routing — Implementation Reference

> Engineering companion to [Dynamic Routing](./routing.md). This document
> describes the current routing implementation in detail: data model,
> evaluation flow, what each variable resolves to, where the orchestrator
> picks up the routed model, and how routing interacts with the gate and
> fallback subsystems. Read this before extending routing (e.g. adding
> capacity-usage-based rules).

## Where routing sits in the request lifecycle

Routing runs **once per request**, after the canonical-shape conversion
and **before** the capacity gate. The orchestrator stage order is:

1. Resolve the AI Resource (entity + per-request `vmx.resourceConfigOverrides` merged in).
2. Convert the wire body to the canonical Responses shape.
3. **Routing** — evaluate condition groups, pick the model to try first.
4. **Gate** — capacity check (per period, per dimension). 429 on breach.
5. **Fallback loop** — primary model, then `aiResource.fallbackModels` if `useFallback`.
6. Per-model retry inside each fallback leg (`maxRetries`, `timeoutMs`).
7. Provider dispatch.

The call sites in code:

- Routing evaluation: `packages/api/src/gateway/gateway-orchestrator.service.ts:373-407`
- Gate evaluation: `packages/api/src/gateway/gateway-orchestrator.service.ts:494-505`
- Fallback loop: `packages/api/src/gateway/gateway-orchestrator.service.ts:418-422`

Because routing precedes gating, a route's choice of model is the model
the gate enforces against. That ordering matters for the capacity-based
routing extension — see [Capacity interaction](#capacity-interaction) below.

## Data model

Routing config is a single JSONB blob on the AI Resource row — no
separate normalised tables. The shape lives in
`packages/api/src/ai-resource/common/routing.entity.ts`.

### Top-level entity

```ts
class AIResourceModelRoutingEntity {
  enabled: boolean; // master toggle
  conditions: AIRoutingConditionGroup[]; // ordered list of routes
}
```

`conditions` is an **ordered array**. The engine walks it top-to-bottom
and the **first matching group wins** — unless `then.traffic` is set, in
which case a failed dice roll falls through to the next group.

### Route group (`AIRoutingConditionGroup`)

| Field         | Purpose                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`        | Always `RoutingItemType.GROUP` — discriminator vs `CONDITION`.                                                                                                           |
| `id`          | UI identifier for drag-reorder + diffing.                                                                                                                                |
| `description` | Free-text label (e.g. `"Route #1"`), surfaced in audit logs.                                                                                                             |
| `operator`    | `AND` or `OR` — gate for the nested `conditions` array. Only meaningful in `UI` mode.                                                                                    |
| `conditions`  | Recursive: `(AIResourceRoutingCondition \| AIRoutingConditionGroup)[]`. Nested groups let you compose `(A AND B) OR (C AND D)`.                                          |
| `mode`        | `UI` (tree of comparator-based conditions) or `ADVANCED` (raw EJS expression in the `expression` field). Switching modes throws the other representation away in the UI. |
| `expression`  | Used only when `mode === ADVANCED`. The whole template is evaluated; its truthy/falsy result decides match.                                                              |
| `action`      | `CALL_MODEL` (dispatch `then`) or `BLOCK` (short-circuit 400, non-retryable).                                                                                            |
| `then`        | `AIResourceRoutingModelConfig` — the model to dispatch when matched. Extends `AIResourceModelConfigEntity` with an optional `traffic` percentage (0–100).                |
| `enabled`     | Optional. `false` skips the group entirely.                                                                                                                              |

### Leaf condition (`AIResourceRoutingCondition`)

| Field        | Purpose                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `type`       | Always `RoutingItemType.CONDITION`.                                                                                                  |
| `id`         | UI identifier.                                                                                                                       |
| `label`      | Human label (e.g. `"Has tools"`).                                                                                                    |
| `expression` | The LHS — either an EJS template (`<% return errorRate(5) %>`) or a `lodash.get` dotted path against the variables (`tokens.input`). |
| `comparator` | One of 14 `RoutingComparator` values (equality, numeric, string, membership, existence). See below.                                  |
| `value`      | RHS: `{ type, expression? }` where `type ∈ RoutingConditionType` and `expression` is the raw value (also EJS-evaluable).             |

### Enums

```ts
RoutingAction = BLOCK | CALL_MODEL;
RoutingOperator = AND | OR;
RoutingMode = UI | ADVANCED;
RoutingItemType = condition | group;
RoutingComparator = EQUAL | NOT_EQUAL | GREATER_THAN | GREATER_THAN_OR_EQUAL | LESS_THAN | LESS_THAN_OR_EQUAL | CONTAINS | NOT_CONTAINS | STARTS_WITH | ENDS_WITH | PATTERN | IN | NOT_IN | EXISTS;
RoutingConditionType = string | number | boolean | (comma - delimited - list) | (json - object) | (json - array);
```

`RoutingConditionType` is **only the RHS type** — it controls how the
resolved RHS string gets parsed (`parseRoutingValue` in `routing.service.ts:339-362`).
`IN` / `NOT_IN` parse the RHS as either a string list or a JSON array;
`GREATER_THAN` / `LESS_THAN` parse as `number`; everything else falls
through to plain string compare.

## Evaluation flow (`ResourceRoutingService`)

File: `packages/api/src/gateway/routing.service.ts`

### Public entry point

```ts
evaluateRoutingConditions(
  workspaceId, environmentId,
  context: RoutingContext,
  requestTokens: number,
  resourceConfig: AIResourceEntity,
): Promise<{ model, matchedRoute } | null>
```

Walks `resourceConfig.routing?.conditions ?? []` in order. For each
enabled group it:

1. Builds the `variables` object (see [Variables](#variables) below).
2. Dispatches on `mode`:
   - `ADVANCED` → `ejs.render(group.expression, variables)` returns a string; truthy match.
   - `UI` → `recursiveEvaluateRoutingConditions(group, variables)`.
3. On match:
   - If `action === BLOCK` → throws `CompletionError` (HTTP 400, `retryable: false`). Fallback does **not** run for blocked requests (see `routing.service.ts:127-138`).
   - If `then.traffic` is unset → return `{ model: then, matchedRoute }`.
   - If `then.traffic` is set → `Math.random() < traffic/100`; on success return, on failure continue to the next group. This is how **traffic splitting cascades**.
4. No match across all groups → `null`. The orchestrator keeps the resource's primary model (`modelConfig` stays put).

### Recursive group eval

`recursiveEvaluateRoutingConditions(group, variables)` (lines 166-217):

- `operator === AND` → short-circuit on the first `false`; returns `true` only if every condition passes.
- `operator === OR` → short-circuit on the first `true`; returns `false` only if every condition fails.
- Nested groups recurse; leaf conditions go to `matchCondition`.
- A group with `enabled === false` is skipped (treated as no-op at its parent level).

### Leaf evaluation (`matchCondition`)

`matchCondition(condition, variables)` (lines 219-301):

1. **Resolve the LHS** (`expressionValue`):
   - If `expression` contains `<%` → `await ejs.render(expression, variables, { async: true })`.
   - Otherwise → `String(lodash.get(variables, expression.replace(/\?\./g, '.')))` — pure dot-path lookup.
     - `lodash.get` doesn't understand JS optional chaining, so `?.` is stripped to `.` before lookup. Rules saved with defensive optional chaining (e.g. `request.metadata?.['team']`) keep working without re-saving. `lodash.get` already handles missing keys safely (returns `undefined`), so the `?.` was decorative anyway.
2. **Resolve the RHS** (`resolvedValue`):
   - If `value.expression` is present and the LHS-expression also looked templated (the same `<%` check is applied to `condition.expression`, not `value.expression`, so the RHS is only EJS-evaluated when the LHS was — see line 228) → render via EJS.
   - Otherwise → the raw `value.expression` string.
   - Empty RHS → the condition returns `false` (line 234-236).
3. **Parse the RHS** by `value.type` (`parseRoutingValue` at lines 339-362). Used by `IN`/`NOT_IN` (lists) and the numeric comparators.
4. **Apply the comparator** — the long `if/else if` block. `EXISTS` is truthy-of-LHS; the numeric comparators also fall back to string compare when the parsed RHS isn't a number; `PATTERN` constructs `new RegExp(resolvedValue)` per call (no cache).

### Variables

The `variables` object handed to EJS — built once per group at `routing.service.ts:91-152`:

```ts
{
  resource,                   // full AIResourceEntity
  request: {
    ...request,               // spread of canonical Responses body
    messages, firstMessage,   // derived from instructions + input
    lastMessage,
    allMessagesContent,
    messagesCount,
    toolsCount,
    format,                   // 'chat-completions' | 'responses' | 'anthropic'
    nativeBody,               // original wire body (pre-canonical)
    metadata,                 // vmx.metadata — gateway envelope keys
  },
  tokens: { input: requestTokens },
  metadata,                   // top-level alias of request.metadata
  errorRate: async (window = 10, statusCode = 'any',
                    aiConnectionId?, model?) => number,
  capacityUsage: async (period = 'minute',
                        aiConnectionId?, model?) => CapacityUsageResult | null,
}
```

**Derived `request.*` fields** are built by `deriveMessageView` (lines 365-440):

- `messages: { role, content }[]` — collapses `instructions` (system) + `input` items, flattens content parts to text. Function-call and tool-result items are skipped; advanced templates can reach them via `request.input` directly.
- `firstMessage` / `lastMessage` — `undefined` when no messages exist (intentional: avoids the `messages[-1]` blow-up the old Chat-Completions-shaped templates would otherwise trigger).
- `allMessagesContent` — derived messages joined by `' '`; used by `CONTAINS`/`PATTERN` rules and by length-based rules via `.length`.

**`metadata`** is `payload.vmx?.metadata` threaded from the orchestrator (header-supplied `x-vmx-metadata-*` keys are merged in by `applyVmxHeadersToCanonical` upstream, so both header and body keys land here). Exposed at **two paths** — top-level `metadata` and `request.metadata` — as the same object reference, so `metadata.team` and `request.metadata.team` always agree. The top-level alias matches the way `tokens.input` reads (envelope-style namespace, not request-shape data); pick whichever feels natural.

**`errorRate`** wraps `CompletionMetricsService.getErrorRate` (`packages/api/src/gateway/metrics/metrics.service.ts:28-96`). It reads minute-bucketed Redis counters under `metrics:{wsId:envId:resId:connId:model}:{yyyy-MM-dd-HH-mm}:requests:success` and `:requests:failed:{statusCode}` and returns `failed / total * 100`. Window defaults to 10 minutes. Retention is 3 hours (lines 132, 138, 144). Counters are flushed every second by a `@Cron` on the same service (line 98).

**`capacityUsage`** wraps `CapacityService.getCapacityUsage` — see the [Capacity interaction](#capacity-interaction) section below for the full shape and selection strategy. Returns `null` when the (possibly user-overridden) connection can't be resolved. Memoised per `(period, connectionId, model)` inside the routing call so multiple groups branching on different axes pay one Redis read per probe.

## Orchestrator hand-off

File: `packages/api/src/gateway/gateway-orchestrator.service.ts`

```ts
// lines 373-407 (abridged)
const routingInput = buildRoutingContext(payload, originalGatewayRequest);
const routingResult = await this.resourceRoutingService.evaluateRoutingConditions(workspaceId, environmentId, routingInput, requestTokens, aiResource);

if (routingResult) {
  auditEvents.push({
    type: RequestAuditEventType.ROUTING,
    data: {
      originalModel: modelConfig,
      routedModel: routingResult.model,
      matchedRoute: routingResult.matchedRoute,
    },
  });
  modelConfig = routingResult.model; // <- the swap
}
```

`buildRoutingContext` (`makeRoutingContext` in `routing.context.ts:38`) picks the cheapest canonical conversion path based on `originalGatewayRequest.format`:

- `'responses'` → use the body verbatim
- `'chat-completions'` → `chatCompletionsToResponsesRequest`
- `'anthropic'` → `anthropicToResponsesRequest`

The same routing engine therefore fires for all three public surfaces.

After the swap, `modelConfig` flows into the fallback loop. **Routing's choice becomes the head of the fallback chain**, not an alternative to it.

## Fallback interaction

```ts
// orchestrator lines 418-422
const models = aiResource.useFallback
  ? [modelConfig, ...(aiResource.fallbackModels ?? [])]
  : [modelConfig];
for (let i = 0; i < models.length; i++) { modelConfig = models[i]; ... }
```

Important behaviours that fall out of this ordering:

- If routing picks model X and X's gate rejects with 429, the loop **advances** to the next fallback model (the 429 is retryable per `gate.service.ts:268-279`).
- If the matched group's action is `BLOCK`, the orchestrator never reaches the loop — `evaluateRoutingConditions` throws and the request fails fast with `retryable: false`.
- `useFallback` can be overridden per-request via `vmx.resourceConfigOverrides.useFallback`; the merged value is what the orchestrator reads here.
- Routing runs **once** per request — fallback advancing through models does not re-run routing. A request that routed to X and falls back to Y is recorded in audit as `routedModel: X`, not Y.

## Capacity interaction

Routing can branch on live capacity-usage via the `capacityUsage()` template helper — see the [Capacity-usage routing](#capacity-usage-routing-as-implemented) subsection below for the helper API and rule presets. The rest of this section covers the capacity subsystem the helper sits on top of.

### How capacity works

File: `packages/api/src/capacity/capacity.service.ts`

**Data model** (`capacity.entity.ts`):

```ts
CapacityEntity = {
  period: minute | hour | day | week | month | lifetime,
  requests: number | null, // absolute request cap, null = unlimited
  tokens: number | null, // absolute token cap,   null = unlimited
  enabled: boolean,
  dimension: 'source-ip' | 'metadata' | null,
  dimensionField: string | null, // metadata key, only for METADATA dimension
};
```

Limits are configured **at three levels** (`capacity.service.ts:181-262`): on the `AIConnection`, on the `AIResource` (gated by `enforceCapacity`), and on the `ApiKey` (also gated by `enforceCapacity`). `resolve()` returns the union of enabled limits across all three, with each item carrying its own `keyPrefix` (dimensioned when the cap is) so dimensioned caps land on per-bucket Redis counters.

**Counters** live in Redis under `capacity:{wsId:envId:resId:connId}:resource-usage:{period}:requests` and `:tokens`. The hash-tag braces around `{wsId:envId:resId:connId}` keep the keys on the same Redis Cluster slot so the `MULTI` pipeline in `consumeCapacity` is atomic. Dimensioned caps append a per-bucket segment to the prefix — e.g. `…:resource-usage:source-ip:1.2.3.4:minute:…` or `…:resource-usage:metadata:userId:u_42:minute:…`.

**Usage read** (`getUsage` at lines 108-148) returns:

```ts
{
  [period]: {
    totalRequests: number,    // absolute count
    usedTokens:    number,    // absolute count
    remainingSeconds: number, // until the period rolls over
  }
}
```

The check in `gate.service.ts:249-310` compares absolute counts against absolute limits (`totalRequests > capacityRequests`, `totalTokens > capacityTokens`). Breach throws `CompletionError` with status `429`, `retryable: true`, `retryDelay = remainingSeconds * 1000`.

For the percentage view, routing reads through `getCapacityUsage` (see below) rather than `getUsage` — same counters, richer projection.

### Discovered capacity

Before designing the helper, one more piece of the capacity subsystem to
understand: **discovered capacity**. Beyond the user-configured
`CapacityEntity[]` on Connection / Resource / API Key, the gateway also
**auto-learns** per-(connection, model) rate limits from provider
response headers and persists them on the AI Connection row.

**Storage** (`packages/api/src/ai-connection/entities/ai-connection.entity.ts:105-110`):

```ts
aiConnection.discoveredCapacity: {
  models: {
    [modelName]: {
      capacity: CapacityEntity[],   // currently only MINUTE entries
      updatedAt: string,            // ISO timestamp
      errorMessage?: string,
    }
  }
}
```

**How it's populated** (`gateway-orchestrator.service.ts:1427-1485`): after each completion, the orchestrator reads `x-ratelimit-limit-requests` / `x-ratelimit-limit-tokens` headers off the provider response. If they exist and don't match what we already have stored for the (connection, model, MINUTE) tuple, `AiConnectionService.updateDiscoveredCapacity` rewrites the JSON blob.

**Where it's already consumed**:

- **Gate counter increment** (`gate.service.ts:155-180`) — when bumping Redis counters, includes the discovered-capacity periods so the same counter tracks usage against both configured and discovered caps. No staleness check here; the gate happily increments against a discovered cap from years ago.
- **Batch queue** (`batch/batch-queue.service.ts:645-664`) — when deciding whether a batch can dispatch, unions discovered capacity into the candidate cap list **but only if `updatedAt` is within the last 7 days** (`subDays(now, 7)`; `isAfter(updatedAt, sevenDaysAgo)`). Stale discoveries are dropped from the decision.

The 7-day batch behaviour is the model to copy — discovered limits older than that are noise (provider may have changed your rate limit since), and a routing rule shouldn't fire on stale data.

Because configured caps and discovered caps all share the **same Redis counter** (`resource-usage:{period}:requests` / `:tokens`, keyed by `wsId:envId:resId:connId`), usage is one number per period — but the _limits_ differ. The "usage percent" the helper exposes must compare that one count against the **tightest applicable limit** across all sources, which is the limit that will trigger 429 first.

### Capacity-usage routing (as implemented)

Three pieces wire capacity into routing.

#### 1. `CapacityService.getCapacityUsage`

```ts
async getCapacityUsage(
  timestamp: Date,
  workspaceId: string,
  environmentId: string,
  resource: AIResourceEntity,
  aiConnection: AIConnectionEntity,
  period: CapacityPeriod,
  model: string,
  apiKey?: ApiKeyEntity,
  request?: FastifyRequest,
  metadata?: Record<string, string>,
): Promise<CapacityUsageResult>
```

The result is a flat object — templates dereference whichever property they need:

```ts
type CapacityUsageResult = {
  // Counters belonging to the limiting cap (the cap closest to
  // saturation on each axis). Both shared with the gate's view.
  totalRequests: number;
  totalTokens: number;
  remainingSeconds: number; // until the period rolls over

  // Tightest limit across configured (Connection + Resource + API Key)
  // and discovered (fresh ≤7 days) sources. `null` when no source
  // configured a cap on that axis.
  requestsLimit: number | null;
  tokensLimit: number | null;

  // Which source contributed the tightest limit on each axis —
  // 'connection' | 'resource' | 'api-key' | 'discovered'. `null`
  // mirrors the corresponding `*Limit`.
  requestsLimitSource: CapacityLimitSource | null;
  tokensLimitSource: CapacityLimitSource | null;

  // Derived. `null` when the corresponding *Limit is null.
  remainingRequests: number | null;
  remainingTokens: number | null;
  requestsUsagePercent: number | null; // 0–100, clamped
  tokensUsagePercent: number | null; // 0–100, clamped
};
```

**Selection strategy.** Across all `(cap, its usage counter)` pairs for the requested period, the cap with the **highest percent** wins on each axis; ties break by tighter limit (so a freshly-spun-up resource with all caps at 0% still reports the cap that'll fire 429 first). The returned `totalRequests` / `totalTokens` are the counter values for the limiting cap — important when source-IP-dimensioned caps push usage onto a different key than the global counter.

**Cap discovery** delegates to `CapacityService.resolve` (same plumbing the gate uses), so source-IP-dimensioned caps are read against their per-IP Redis key when `request` is supplied. Metadata-dimensioned caps (see [Capacity dimensions](#capacity-dimensions) below) read the per-(field, value) key when `metadata` is supplied. Discovered capacity is appended separately with the non-dimensioned prefix and gated by `DISCOVERED_CAPACITY_FRESHNESS_DAYS = 7` (shared constant, also used by `batch-queue.service.ts`).

#### 2. `capacityUsage` template variable

Injected into the routing `variables` object at `routing.service.ts:135-152`:

```ts
capacityUsage: (
  period: CapacityPeriod = CapacityPeriod.MINUTE,
  aiConnectionId?: string,
  model?: string,
) => this.resolveCapacityUsage(/* … */),
```

Defaults to the resource's primary connection/model so `capacityUsage()` does the right thing without arguments. Per-request memoisation by `(period, connId, model)` is built into `resolveCapacityUsage`, so multi-group rules ("if tokens > 80% OR requests > 80%") pay one Redis read per unique probe.

Returns `null` when the (possibly user-overridden) connection can't be resolved — a malformed template (`capacityUsage('minute', 'conn_does_not_exist')`) drops the condition out without blowing up the request.

#### 3. UI presets in `rules.ts`

Four presets, one per natural axis:

```ts
{ id: 'capacity_tokens_usage_minute_greater_than',
  expression: '<% return (await capacityUsage("minute"))?.tokensUsagePercent %>',
  comparator: GREATER_THAN, value: { type: NUMBER, label: 'Usage (%)' } },

{ id: 'capacity_requests_usage_minute_greater_than',
  expression: '<% return (await capacityUsage("minute"))?.requestsUsagePercent %>',
  comparator: GREATER_THAN, value: { type: NUMBER, label: 'Usage (%)' } },

{ id: 'capacity_remaining_tokens_minute_less_than',
  expression: '<% return (await capacityUsage("minute"))?.remainingTokens %>',
  comparator: LESS_THAN, value: { type: NUMBER, label: 'tokens' } },

{ id: 'capacity_remaining_requests_minute_less_than',
  expression: '<% return (await capacityUsage("minute"))?.remainingRequests %>',
  comparator: LESS_THAN, value: { type: NUMBER, label: 'requests' } },
```

Advanced-mode users can hand-write any other combination — `capacityUsage().totalTokens > 50000`, `capacityUsage('hour').tokensUsagePercent`, `capacityUsage().requestsLimitSource === 'discovered'`, etc.

### Behaviour notes

- **Unlimited-axis inertness.** When no source defines a cap on an axis, `remainingRequests`, `remainingTokens`, `requestsUsagePercent`, `tokensUsagePercent` are `null`. EJS comparisons `null > 80` evaluate to `false`, so unlimited-axis rules are naturally inert — no special-case needed.
- **Pre-routing token estimate.** `requestTokens` is in scope at evaluation time but is **not** currently folded into the in-flight token count (the gate does this implicitly via `usedTokens + requestTokens > capacityTokens` on enforcement). If you want a routing rule to fire on the request that would push usage over the line — rather than the one after — pull `tokens.input` into the comparator manually: `<% return (await capacityUsage()).totalTokens + tokens.input %>`.
- **Per-axis limit source.** `requestsLimitSource` / `tokensLimitSource` (`'discovered'` vs `'connection'` etc.) let advanced rules special-case discovered limits, e.g. "only react when the provider's own rate limit is biting, not when an operator set a soft cap".
- **Audit signal.** The `RequestAuditEventType.ROUTING` event already includes `matchedRoute`, so the route's `description` surfaces in audit logs when a capacity rule fires — no additional plumbing.

### Capacity dimensions

Capacity caps are bucketed by an optional `dimension` field:

```ts
enum CapacityDimension {
  SOURCE_IP = 'source-ip',
  METADATA = 'metadata',
}

class CapacityEntity {
  // …existing fields…
  dimension?: CapacityDimension | null;
  dimensionField?: string | null; // only used when dimension === METADATA
}
```

`resolveCapacityKeyPrefix` (`capacity.service.ts:384-417`) handles each variant:

- **SOURCE_IP** — reads the IP from `getSourceIpFromRequest(request)` (`x-forwarded-for` first, falls back to `request.ip`). Redis prefix: `${base}source-ip:${ip}:`. `dimensionValue: <ip>`.
- **METADATA** — looks up `metadata[dimensionField]` from the in-flight `payload.vmx.metadata`. Missing field falls back to `METADATA_DIMENSION_UNKNOWN_VALUE = 'unknown'` so anonymous traffic still gets gated (matches the SOURCE_IP fallback model). Redis prefix: `${base}metadata:${field}:${value}:`. `dimensionValue: ${field}=${value}` — surfaces in 429 messages as e.g. `"Metadata userId=u_42 has reached the limit…"`.

The gate enforces against the dimensioned counter; routing's `capacityUsage()` reads from the same counter when `request` + `metadata` are threaded (orchestrator does this at `gateway-orchestrator.service.ts:494-506`).

## Metadata-based routing

Beyond capacity, metadata also feeds the dynamic-routing rule engine directly.

**Wire-up** — the orchestrator extracts `payload.vmx?.metadata` once and threads it into both `requestGate` and `evaluateRoutingConditions` (`gateway-orchestrator.service.ts:494-506`, `:377-388`). The routing engine exposes it as **two paths** in the template variables (same object reference):

- `metadata.<key>` — top-level namespace, parallels `tokens.input`.
- `request.metadata.<key>` — nested under `request`, matches the way `request.lastMessage` reads.

Both resolve identically. Use whichever feels readable.

**Rule preset** — `metadata_equals` in `rules.ts`:

```ts
{
  id: 'metadata_equals',
  expression: buildMetadataExpression(''),     // → "metadata['']"
  label: 'Metadata field equals ...',
  comparator: RoutingComparator.EQUAL,
  value: { type: RoutingConditionType.STRING, label: 'value' },
  metadataField: true,                          // tells ConditionCard to render
                                                // field + value autocompletes
}
```

When `metadataField: true`, `ConditionCard` (`packages/ui/src/components/AIResources/Form/Edit/Routing/ConditionCard.tsx`) renders:

1. A **Field** Autocomplete sourced from `getRequestAuditMetadataKeys` — same endpoint the audit + usage pages use.
2. A **Value** Autocomplete that fetches `getRequestAuditMetadataValues({ key: <chosenField> })` on demand for suggestions; `freeSolo` so unobserved values can still be typed.

The chosen field is encoded into the saved `expression` via `buildMetadataExpression(field)` → `metadata['<field>']`. `parseMetadataField` tolerates the legacy `request.metadata?.['<field>']` shape so older saves still round-trip in the editor.

**lodash.get path normalisation.** Saved expressions are evaluated by the plain-path branch of `matchCondition` (not EJS, since they don't contain `<%`). `lodash.get` doesn't understand JS optional chaining, so the engine strips `?.` to `.` before lookup. Both shapes now resolve correctly:

- New: `metadata['team']` → `lodash.get(vars, "metadata['team']")`
- Legacy: `request.metadata?.['team']` → stripped to `request.metadata.['team']` → `lodash.get` ✓

Use bracket notation for arbitrary keys (`metadata['some.dotted.key']`) — plain dot syntax (`metadata.some.dotted.key`) lets `lodash.get` split on the dots, which is wrong for user-supplied keys.

## UI surface

Form root: `packages/ui/src/components/AIResources/Form/Edit/Routing/Form.tsx` — React Hook Form + Zod, wraps `DynamicRoutingTree`.

Editor components (same directory):

- `DynamicRoutingTree.tsx` — ordered list of route cards, drag-to-reorder.
- `RouteCard.tsx` — one group; collapses/expands; hosts the condition tree, action selector, model picker, traffic slider.
- `ConditionCard.tsx` — one leaf condition; hosts the LHS preset picker, comparator dropdown, value input.
- `AdvancedEditor.tsx` — raw EJS textarea for `mode === ADVANCED`.
- `rules.ts` — the **hardcoded** list of LHS presets shown in the picker. Adding a new template variable on the backend means adding a corresponding entry here, otherwise the UI users can't reach it (advanced-mode templates can still hand-type it).

Persistence: `packages/ui/src/app/workspaces/[workspaceId]/[environmentId]/ai-resources/edit/[resourceId]/routing/actions.ts` calls the generated `updateAiResource` client, which PUTs the full `AIResourceModelRoutingEntity` as a nested field on the AI Resource update DTO. There is no per-route endpoint — every save replaces the entire routing block.

## Test coverage to be aware of

- `packages/api/src/gateway/routing.service.spec.ts` — comparator branches, AND/OR groups, traffic split, BLOCK action, empty-message defaults, `capacityUsage` template helper (5 cases), `metadata`-rule path resolution including the legacy `?.` shape (4 cases).
- `packages/api/src/capacity/capacity.service.spec.ts` — `getCapacityUsage` per-source selection, source-IP-dimensioned counter reads, metadata-dimensioned counter reads (incl. the "unknown" fallback), fresh/stale discovered capacity, clamping, disabled-entry skip.
- `packages/api/src/gateway/gate.service.spec.ts` — `checkRequestCapacity` request/token thresholds, retry-after metadata, error-message prefix variants for `SOURCE_IP` and `METADATA` dimensions.
- Live tests for routing-driven model selection sit under `packages/api/src/gateway/**/*.live.spec.ts`. Most assertions use audit-event inspection (`RequestAuditEventType.ROUTING.data.matchedRoute`) to confirm the right route fired. Capacity-percent and metadata rules use mocked counters / `CapacityService` rather than live Redis — saturating a real counter from a test would race against the per-second flush.

## Related code references

- Engine: `packages/api/src/gateway/routing.service.ts`
- Context wrapper: `packages/api/src/gateway/routing.context.ts`
- Entity / DTO: `packages/api/src/ai-resource/common/routing.entity.ts`
- Orchestrator integration: `packages/api/src/gateway/gateway-orchestrator.service.ts:373-407`
- Gate (capacity check): `packages/api/src/gateway/gate.service.ts`
- Capacity (counters + resolution): `packages/api/src/capacity/capacity.service.ts`
- Capacity entity: `packages/api/src/capacity/capacity.entity.ts`
- Error-rate metrics: `packages/api/src/gateway/metrics/metrics.service.ts`
- UI form: `packages/ui/src/components/AIResources/Form/Edit/Routing/`
- UI rule presets: `packages/ui/src/components/AIResources/Form/Edit/Routing/rules.ts`
