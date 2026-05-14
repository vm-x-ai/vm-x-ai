---
sidebar_position: 0
---

# Workspaces and Environments

VM-X AI uses a two-level tenancy hierarchy: a **Workspace** owns one
or more **Environments**, and every operational object — AI
connections, AI resources, API keys, audit records — lives inside an
environment. This page documents the data model, the scoping rules,
and the isolation guarantees that follow from them.

## Data model

The relational shape is enforced at the schema level (see the
migration files under `packages/api/src/migrations/`):

| Entity            | Primary key                                        | Cascade on parent delete |
| ----------------- | -------------------------------------------------- | ------------------------ |
| `workspaces`      | `(workspace_id)`                                   | —                        |
| `workspace_users` | `(workspace_id, user_id)` + role enum              | yes (workspace)          |
| `environments`    | `(workspace_id, environment_id)`                   | yes (workspace)          |
| `ai_connections`  | `(connection_id, workspace_id, environment_id)`    | yes (environment)        |
| `ai_resources`    | `(resource_id, workspace_id, environment_id)`      | yes (environment)        |
| `api_keys`        | `(api_key_id, workspace_id, environment_id)`       | yes (environment)        |
| `request_audit`   | `(id)` with `workspace_id` + `environment_id` cols | —                        |

Two consequences worth calling out:

- Environment ids are **only unique inside a workspace**. Every
  downstream table includes both `workspace_id` and `environment_id`
  in its foreign key — leaking an environment id alone is not enough
  to address a row.
- Deleting a workspace removes its environments, which in turn
  removes every connection, resource, and API key inside them via
  `ON DELETE CASCADE`. There is no soft-delete.

## Workspaces

A workspace is the outer isolation boundary. It owns its members and
all of its environments. Workspaces are created by any authenticated
user whose global role allows `workspace:create` (the seeded `admin`
and `power-user` roles do; `read-only` does not — see
[Roles and permissions](../intro.md) and `packages/api/src/role/`).

### Workspace membership

`workspace_users` carries a per-workspace role enum:

- **`OWNER`** — full control of the workspace, including delete. The
  user that created the workspace is auto-added as owner.
- **`MEMBER`** — can read the workspace and operate inside its
  environments, but cannot delete the workspace or change member
  roles.

Workspace membership is checked by `WorkspaceMemberGuard`
(`packages/api/src/workspace/workspace.guard.ts`) on every
workspace-scoped route. It runs in addition to the global RBAC role
check (`RoleGuard`) — a user must both belong to the workspace **and**
hold a role whose policy allows the requested action.

When a request authenticates with an API key instead of a user
session, the membership check is skipped (the key itself encodes the
workspace + environment scope it can act in — see below).

### Managing a workspace from the UI

1. Open the **Workspaces** entry in the sidebar (`/workspaces`).
2. From the list you can:
   - Click the **+** action next to a workspace to add a new
     environment.
   - Click the workspace name to edit its details and manage members
     (`/workspaces/[workspaceId]/edit`).
3. To create the first workspace on a fresh install, use **Getting
   Started** (`/getting-started`) — it walks you through workspace
   creation, an initial environment, an AI connection, a resource,
   and an API key.

## Environments

An environment is the inner isolation boundary inside a workspace.
Every connection, resource, API key, and audit record carries both
its `workspace_id` and its `environment_id`, and queries always
filter on both columns together — there is no "list all resources
across environments" path in the API.

Typical uses:

- Lifecycle separation: `development`, `staging`, `production`.
- Tenant-per-environment if you fan out a single workspace per team
  but per-customer environments under it.
- Blast-radius isolation for experiments (try a new routing or
  fallback config in a sandbox environment first).

### Creating and editing environments

From the sidebar **Workspaces** list:

1. Click the **+** next to the parent workspace to open the
   environment creator.
2. Provide a **Name** (e.g. `production`). Description is optional.
3. After creation, environment-scoped admin pages live under
   `/workspaces/[workspaceId]/[environmentId]/...`:
   [AI Connections](./ai-connections.md),
   [AI Resources](./ai-resources/index.md),
   [Playground](./playground.md),
   [Prioritization](./prioritization.md),
   [Usage](./usage.md), and a per-environment SDK / API key page.

There is no "switch environment" toggle independent of the URL — the
workspace and environment ids are always part of the path, which
makes deep links and bookmarks safe to share.

## What is scoped where

| Object            | Lives in    | Notes                                                                                        |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Members + roles   | Workspace   | Owner / Member enum; global RBAC roles cut across all workspaces.                            |
| AI Connection     | Environment | Provider credentials, allowed models, capacity. Never shared across environments.            |
| AI Resource       | Environment | Routing, fallback, default args. Resource names are unique per environment, not globally.    |
| API Key           | Environment | Hash + masked key stored per `(workspace, environment)`; carries an allow-list of resources. |
| Audit record      | Environment | `request_audit.workspace_id` + `environment_id` populated on every gateway call.             |
| Usage / cost data | Environment | Aggregated from the audit table — filterable per workspace + environment.                    |
| Pool definitions  | Workspace   | Shared across the workspace's environments (see `packages/api/src/pool-definition/`).        |

## API key scoping

API keys are minted per environment and verified per environment.
The verification path in `ApiKeyService.verify`
(`packages/api/src/api-key/api-key.service.ts`) hashes the incoming
key and looks it up by `(hash, workspace_id, environment_id,
enabled = true)` — so the **same key string cannot be reused in a
different environment** even if you somehow synced the hashes.

Each key additionally carries:

- A `resources` allow-list (resource ids). If the resource targeted
  by the incoming request is not in the list, the gateway returns
  `403 API_KEY_RESOURCE_NOT_AUTHORIZED`.
- Optional `capacity` + `enforceCapacity` for per-key rate/spend
  limits (see [Capacity gating](./ai-resources/capacity.md)).
- Optional `labels` for downstream filtering in audit / usage.

## Request scoping at the gateway

The completion endpoints encode the workspace and environment
directly in the path:

```
/v1/completion/{workspaceId}/{environmentId}/chat/completions
/v1/completion/{workspaceId}/{environmentId}/responses
/v1/completion/{workspaceId}/{environmentId}/anthropic/messages
```

All three share the same routing, fallback, capacity gating, audit,
and [`vmx` envelope](./api/vmx-envelope.md). They differ only in the
wire shape they accept and return — see
[Chat Completions](./api/chat-completions.md),
[Responses](./api/responses.md), and
[Anthropic Messages](./api/anthropic-messages.md) for the per-endpoint
detail. The Anthropic Messages route is forwarded verbatim to an
Anthropic-native upstream when one is reachable, so provider-specific
fields (`cache_control`, extended `thinking`, server tools,
citations, refusal `stop_details`) survive end-to-end; cross-provider
fallback converts through the internal pivot and drops fields the
wire format cannot express.

### Example: using a workspace + environment-scoped key

```javascript
import OpenAI from 'openai';

const workspaceId = '6c41dc1b-910c-4358-beef-2c609d38db31';
const environmentId = '6c1957ca-77ca-49b3-8fa1-0590281b8b44';
const resourceName = 'chat-completion';

const openai = new OpenAI({
  baseURL: `http://localhost:3030/api/v1/completion/${workspaceId}/${environmentId}`,
  apiKey: '<VM_X_API_KEY>', // must be a key minted in this environment
});

const completion = await openai.chat.completions.create({
  model: resourceName, // VM-X Resource Name, resolved inside this environment
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

Switching environments is purely a matter of swapping `environmentId`

- `apiKey` in the client — same SDK, same code path, different
  isolated scope.

## Isolation guarantees

- **No cross-environment reads.** Every service-layer query in
  `packages/api/src/{ai-connection,ai-resource,api-key}/` filters on
  both `workspaceId` and `environmentId`. There is no admin endpoint
  that bypasses this.
- **No cross-environment writes.** Foreign keys on
  `(workspace_id, environment_id)` make a cross-scope insert fail at
  the database level, not just in application code.
- **API keys are environment-bound.** A leaked key only authorizes
  the environment it was minted in, and only the resources in its
  allow-list inside that environment.
- **Audit is per-scope.** `request_audit` rows always carry
  `workspace_id` + `environment_id`, so downstream usage / billing
  dashboards can filter cleanly without joining back to a routing
  table.

## Best practices

1. **One workspace per tenant.** Use environments inside it for
   dev / staging / prod. Cross-tenant access is impossible by
   construction; cross-environment access is impossible by
   construction.
2. **Separate credentials per environment.** Mint a distinct AI
   Connection (provider key) per environment, even if they point at
   the same upstream account — it lets you rotate or revoke per
   environment without redeploying.
3. **Keep API keys narrow.** Set the `resources` allow-list on each
   key to only the resources that caller needs. The verifier enforces
   this on every request.
4. **Promote config explicitly.** There is no "copy resource from
   staging to prod" button — and that is intentional. Re-create the
   resource in the target environment so its routing / fallback /
   default-args choices are reviewed as part of the promotion.
5. **Review workspace owners regularly.** Owners can delete the
   workspace (which cascades to every environment, connection,
   resource, key, and audit row inside it). Keep the owner list
   short.

## Troubleshooting

### `403` on every request

Check, in order:

1. The API key you are using was minted **in this environment**
   (not just the same workspace).
2. The key is `enabled`.
3. The resource name you are passing as `model` is in the key's
   `resources` allow-list.

### `404` on a known resource id

If you can see the resource in the UI but the API returns
`AI_RESOURCE_NOT_FOUND`, you are almost certainly hitting the wrong
environment in the path. Resource ids are unique per environment, not
globally.

### A workspace disappeared

Workspace delete cascades to environments → connections → resources
→ API keys → audit rows, with no soft-delete. If a workspace is
missing it was either never created on this database (check the
migration log) or it was deleted by an owner. Past audit rows for the
deleted workspace are also gone.

### Cannot access a workspace

1. Verify you are listed under `workspace_users` for it (UI shows
   "you are not a member" otherwise).
2. Verify your global RBAC role grants the action you are taking —
   workspace membership alone is not sufficient if your role denies,
   say, `ai-resource:create`.
3. Verify the workspace still exists (see above).
