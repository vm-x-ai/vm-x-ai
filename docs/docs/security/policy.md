---
sidebar_position: 2
---

# Security Posture

This page summarises the security model VM-X AI ships with: how callers
authenticate, how they are authorised, what is recorded, how secrets are
encrypted at rest, and how multi-tenancy is enforced. Each section links
out to deeper docs and to the source modules that implement the
behaviour.

## Authentication

VM-X AI has two distinct authentication paths, exposed by different
guards in the API:

- **Interactive (UI and CLI) — OIDC.** The API embeds its own OIDC
  provider; users sign in either with local credentials
  (`LOCAL` accounts, Argon2 password hash) or via an upstream
  federated IdP (`OIDC_FEDERATED_ISSUER`). Federated sign-ins
  auto-provision a user on first login and assign the role named by
  `OIDC_FEDERATED_DEFAULT_ROLE` (defaults to `power-user`). Wired in
  `packages/api/src/auth/auth.module.ts`; bearer tokens are validated by
  the `oidc` Passport strategy at
  `packages/api/src/auth/strategies/oidc.strategy.ts`.
- **Programmatic (gateway traffic) — API keys.** The completion,
  responses, and Anthropic messages endpoints accept a per-key bearer
  token via `Authorization: Bearer ...` or `x-api-key`. Keys are
  verified by SHA-256 hash comparison and constrained to an explicit
  allow-list of AI Resource IDs in the same workspace + environment;
  policy statements do not gate API-key traffic. See
  `packages/api/src/api-key/api-key.guard.ts` and
  `packages/api/src/api-key/api-key.service.ts`.

User account state (`ACTIVE`, `INACTIVE`, `CHANGE_PASSWORD`) and provider
type (`LOCAL` / `OIDC`) are documented in [Users](./users.md).

## Authorisation

Once a request is authenticated, the API resolves it to an
`(action, resource)` pair and walks the caller's role policies. The full
schema (statements, effects, wildcards, hierarchical resource ARNs,
evaluation order) lives in [Roles](./roles.md). The canonical list of
modules and actions is also exposed at runtime by
`GET /role/permissions` (the UI policy editor renders the same data).

Highlights:

- `effect` is `"allow"` or `"deny"` — lowercase only.
- A matching `deny` short-circuits to **403 Forbidden** immediately.
- With no matching statement across any role the default is **deny**.
- Statement order inside a single role matters — put `deny` first.
- Three roles are seeded on first migration: `admin`, `power-user`,
  `read-only`. Details in [Roles](./roles.md#default-roles).

## Audit

Every gateway request lands in the Postgres `request_audit` table via
the buffered writer in
`packages/api/src/audit/audit.service.ts` (flushed every 10 seconds or
at 25 buffered rows, whichever comes first). The row captures the
inbound wire format (`chat-completions`, `responses`, `anthropic`),
status code, latency breakdown, token counts, cost, error reason, the
client-sent `requestPayload`, the post-conversion `providerRequestPayload`
the upstream SDK actually saw, the response, and a per-request
`metadata` map.

Two sanitisation passes run before insert:

- Base64 bytes inside multimodal message parts are stripped from
  `requestPayload` / `providerRequestPayload` and replaced with a
  metadata-only summary — the live upstream call still sees the full
  bytes; only the stored audit copy is trimmed.
- Authorisation-bearing headers (and cookies) are filtered out of
  `responseHeaders` before persist.

Audit rows are queryable via the `request-audit:list` action and feed
the usage rollups exposed by `request-usage:query`. **There is no
built-in retention/TTL job today** — operators wanting a retention
window need to schedule their own Postgres housekeeping (see
[Open questions](#open-questions)). Storage backend is Postgres only —
the previous DynamoDB / Elasticsearch path has been removed.

## Secret encryption at rest

Workspace-scoped secrets (AI provider credentials, integration tokens)
live encrypted in the `global_secrets` table. The encryption
provider is selected by `ENCRYPTION_PROVIDER`, defined in
`packages/api/src/config/schema.ts`:

| Provider    | When to use                                                    | Required env                                                          |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `libsodium` | Default — self-contained, no cloud dependency                  | `LIBSODIUM_ENCRYPTION_KEY` (base64-encoded 32-byte key)               |
| `aws-kms`   | AWS-hosted deployments wanting a managed CMK and KMS audit log | `AWS_KMS_KEY_ID`, `AWS_REGION` (plus standard AWS credential sources) |

Libsodium uses XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf`)
with a per-message random nonce, implemented in
`packages/api/src/vault/libsodium/encryption.service.ts`. Provider
selection is conditional at module import time in
`packages/api/src/vault/vault.module.ts`; HashiCorp Vault is no longer
a supported backend.

In a Kubernetes deployment the encryption key itself should be sourced
from an external secret manager — see
[Helm secret-management guide](https://github.com/vm-x-ai/vm-x-ai/blob/main/helm/charts/vm-x-ai/SECRETS.md)
for the External Secrets Operator / sealed-secrets / external-secret
patterns the chart supports.

## Transport

The api process speaks plain HTTP and expects to sit behind a TLS
terminator (ingress / load balancer). Only Redis has a first-party
`REDIS_TLS` toggle in `packages/api/src/config/schema.ts`; Postgres
TLS is governed by `DATABASE_SSL`. Outbound AI provider calls are HTTPS
to the upstream's endpoint.

## Multi-tenancy isolation

Tenancy is modelled as **workspace → environment**. Every resource
table (AI connection, AI resource, API key, completion batch, request
audit, request usage, …) carries a `workspaceId` + `environmentId`,
and the role-policy resource ARN nests the two as
`workspace:{name}:environment:{name}:…`. The role guard rejects any
request whose target resource does not regex-match a statement in one
of the caller's roles — so granting `workspace:production:*` cannot
leak into `workspace:staging`. API-key traffic is additionally pinned
to a single (workspace, environment, resource-id) triple by the API key
guard.

## Next steps

- [Roles](./roles.md) — full role-policy schema, seeded roles,
  evaluation order, troubleshooting
- [Users](./users.md) — local vs federated accounts, lifecycle states
- [Workspaces and Environments](../features/workspaces-environments.md) —
  the resource hierarchy isolation depends on
