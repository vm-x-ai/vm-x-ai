---
sidebar_position: 3
---

# Users

Users represent individuals who can sign in to VM-X AI. Every user record
carries:

- **Identity**: `name`, `firstName`, `lastName`, `username` (unique), `email` (unique), optional `pictureUrl`
- **State**: `ACTIVE`, `INACTIVE`, or `CHANGE_PASSWORD`
- **Provider**: `LOCAL` (username + password stored in VM-X) or `OIDC` (federated through an external IdP)
- **Role assignments**: any number of roles granting fine-grained permissions

A user's permissions are entirely determined by the roles assigned to them.
A user with no role assignments will be denied every protected action.

## Seed Admin User

The first migration seeds a single administrator account so the platform is
usable on a fresh install:

| Field            | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| Username         | `admin`                                                 |
| Email            | `admin@example.com`                                     |
| Initial password | `admin`                                                 |
| State            | `CHANGE_PASSWORD`                                       |
| Provider type    | `LOCAL`                                                 |
| Roles            | `admin` (full `*:*` access, assigned by migration `14`) |

The first sign-in with `admin` / `admin` triggers the OIDC interaction
flow's `change-password` prompt — the admin **cannot complete the login**
until they set a new password. The new password is hashed with Argon2 and
the user state is flipped to `ACTIVE`.

:::important
Change the seed admin password before exposing the deployment to anyone
else. The default `admin` password is only there to bootstrap the install.
:::

## User States

The `state` column drives the OIDC interaction flow:

- **`ACTIVE`** — Normal user. Login succeeds and the OIDC provider issues a session.
- **`CHANGE_PASSWORD`** — User is forced through the `change-password`
  interaction prompt before any session is issued. Setting a new password
  via `POST /interaction/{uid}/change-password` flips the state to `ACTIVE`
  and finalises the login. Only applies to `LOCAL` users.
- **`INACTIVE`** — User is disabled. Stored, but cannot log in.

## Authentication Providers

### Local provider

`providerType: LOCAL`. The user has a `passwordHash` (Argon2). Login goes
through the OIDC interaction controller, which validates credentials via
`AuthService.validateUser`. Local users created in the admin UI always have
`providerId = "local"`.

### OIDC federation

`providerType: OIDC`. Configured via the following environment variables on
the API:

| Variable                       | Required        | Default                | Description                                                                                           |
| ------------------------------ | --------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `OIDC_FEDERATED_ISSUER`        | optional        | —                      | Issuer URL of the upstream IdP (e.g. `https://accounts.google.com`). Federation is disabled if unset. |
| `OIDC_FEDERATED_CLIENT_ID`     | when issuer set | —                      | OAuth client ID registered with the IdP.                                                              |
| `OIDC_FEDERATED_CLIENT_SECRET` | optional        | —                      | OAuth client secret. Optional for public clients.                                                     |
| `OIDC_FEDERATED_SCOPE`         | optional        | `openid profile email` | Scopes requested from the IdP.                                                                        |
| `OIDC_FEDERATED_DEFAULT_ROLE`  | optional        | `power-user`           | Role assigned to new federated users on first sign-in.                                                |

#### Just-in-time provisioning

Federated users are **never** created up-front — VM-X has no invite flow.
On the first successful federated sign-in, VM-X inserts an `OIDC` user
record from the IdP claims:

| Column          | Sourced from claim                                |
| --------------- | ------------------------------------------------- |
| `email`         | `email` (required — login fails if missing)       |
| `firstName`     | `given_name` (falls back to `first_name`)         |
| `lastName`      | `family_name` (falls back to `last_name`)         |
| `name`          | `name` (falls back to `"{firstName} {lastName}"`) |
| `username`      | `email`                                           |
| `pictureUrl`    | `picture` (falls back to `picture_url`)           |
| `providerId`    | `sub`                                             |
| `state`         | `ACTIVE`                                          |
| `emailVerified` | `true`                                            |

The new user is then assigned the role named by
`OIDC_FEDERATED_DEFAULT_ROLE` (`power-user` by default). Subsequent logins
reuse the same record.

#### Account linking

If a `LOCAL` user with the same `email` already exists but has no
`providerId`, the first federated sign-in **upgrades** the record in place
— `providerType` flips to `OIDC`, `providerId` is set to the IdP `sub`,
`providerMetadata` is populated with the claims, and `emailVerified` is set
to `true`. The local `passwordHash` is left intact but is no longer used.

#### Login rejection

After an OIDC record exists, mismatches are rejected:

- `email` claim differs from the stored `email` → `OIDC_EMAIL_MISMATCH`
- `sub` claim differs from the stored `providerId` → `OIDC_PROVIDER_ID_MISMATCH`

#### Redirect URL

The redirect URL the API expects on the IdP side is:

```
{BASE_URL}{BASE_PATH}/interaction/federated/callback
```

where `BASE_URL` and `BASE_PATH` are the API's configured base URL and
path. Whitelist that exact URL in your IdP's OAuth client configuration.

## Creating a User

Local users can be created from the UI or directly through the API. OIDC
users do **not** need to be created manually — see
[Just-in-time provisioning](#just-in-time-provisioning).

1. Navigate to **Settings** → **Users**
2. Click **Create User**
3. Fill in user details:
   - **First name**, **Last name** — required. The **Display Name** field
     auto-fills as `"{firstName} {lastName}"` on blur if left empty, but
     can be overridden.
   - **Email** — required, must be unique. The `username` column is set
     automatically to the email address; there is no separate username
     field in the Create form.
   - **Password** and **Confirm Password** — required.
   - **Require password change on next login** — when checked (the
     default), the user is created with `state = CHANGE_PASSWORD` and is
     forced through the change-password prompt on first sign-in.
     Unchecked creates the user as `ACTIVE`.
   - **Roles** — multi-select. After the user is created, the form fans
     out one `POST /role/{roleId}/assign` per selected role.

`POST /user` always sets `providerType = LOCAL`, `providerId = "local"`,
and `emailVerified = false`.

## Updating a User

1. Navigate to **Settings** → **Users**
2. Click on a user
3. Click **Edit**
4. Update user details:
   - **First name**, **Last name**, **Display Name** — editable for all
     users.
   - **Email**, **Password**, **Confirm Password** — only editable when
     `providerType = LOCAL`. They are disabled for OIDC users (the email
     is owned by the upstream IdP). Leaving the password blank keeps the
     existing hash; supplying a value re-hashes with Argon2.
   - **Require password change on next login** — toggles `state` between
     `ACTIVE` and `CHANGE_PASSWORD`.
5. Click **Save**

Role assignment is **not** exposed in the Edit form — manage role
membership from the role page instead (see
[Assigning Roles to Users](#assigning-roles-to-users)).

## Deleting a User

1. Navigate to **Settings** → **Users**
2. Click the delete icon on the user row, or open the user and click **Delete**
3. Confirm deletion

Deleting a user cascades to their `user_roles` rows.

## Changing Your Own Password

End-users change their own password through the OIDC interaction flow,
not through the user admin pages:

1. The login form posts to `POST /interaction/{uid}/login`.
2. If the user's `state` is `CHANGE_PASSWORD`, the interaction is
   promoted to the `change-password` prompt and the browser is redirected
   to `GET /interaction/{uid}`, which renders the `change-password.ejs`
   view.
3. The new password is submitted to `POST /interaction/{uid}/change-password`.
   VM-X hashes it with Argon2, flips `state` to `ACTIVE`, and finalises
   the OIDC interaction (issuing a session).

The `POST /interaction/{uid}/change-password` endpoint **only** accepts
submissions for `LOCAL` users. If the account is federated, the request is
redirected back to the login page with `?error=invalid_account` — federated
users must change their password at the upstream IdP.

## Assigning Roles to Users

For **existing** users, roles are managed from the role page. Each role
tracks its members; a user can hold any number of roles.

1. Navigate to **Settings** → **Roles**
2. Click on a role
3. Click **Assign Users**
4. Select one or more users
5. Click **Save**

For **new** users, the Create User form also exposes a role multi-select
that runs the same assignment after the user is created (see
[Creating a User](#creating-a-user)).

A user's effective permissions are the union of all statements across all
roles assigned to them, evaluated as described in the
[Policy Guide](./policy.md#policy-evaluation).

## Troubleshooting

### User Cannot Perform Action

If a user cannot perform an action:

1. **Check Role Assignment**: Verify the user has at least one role assigned
2. **Check Role Policy**: Verify a role policy contains an `allow` statement that matches the action
3. **Check Resource Pattern**: Verify the resource pattern matches every level of the resource ARN
4. **Check `deny` Statements**: Verify no `deny` statement in the same role matches first
5. **Check User State**: A user in `INACTIVE` cannot sign in; a user in `CHANGE_PASSWORD` must set a new password before getting a session

### Federated Login Fails

1. **Issuer reachable?** Verify `OIDC_FEDERATED_ISSUER` resolves and serves an OIDC discovery document
2. **Redirect URL whitelisted?** Confirm `{BASE_URL}{BASE_PATH}/interaction/federated/callback` is registered with the upstream IdP
3. **Email claim present?** VM-X requires the IdP to return an `email` claim
4. **Mismatched provider ID or email** for an existing user will reject the login — fix or delete the conflicting record

## Next Steps

- [Roles](./roles.md) - Learn about role management
- [Policy Guide](./policy.md) - Detailed guide on creating role policies
- [Workspaces and Environments](../features/workspaces-environments.md) - Learn about workspace and environment isolation
