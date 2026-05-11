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
`AuthService.validateUser`.

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

When a federated user signs in for the first time, VM-X creates a `OIDC`
user record from the IdP's claims (`email`, `given_name`, `family_name`,
`name`, `picture`, `sub`) and assigns the role named by
`OIDC_FEDERATED_DEFAULT_ROLE`. Subsequent logins reuse the same record;
mismatching `email` or `providerId` rejects the login.

The redirect URL the API expects on the IdP side is:

```
{BASE_URL}{BASE_PATH}/interaction/federated/callback
```

where `BASE_URL` and `BASE_PATH` are the API's configured base URL and
path. Whitelist that exact URL in your IdP's OAuth client configuration.

## Creating a User

Local users can be created from the UI or directly through the API:

1. Navigate to **Settings** → **Users**
2. Click **Create User**
3. Fill in user details:
   - **Name**, **First name**, **Last name**
   - **Username** (must be unique)
   - **Email** (must be unique)
   - **Password**
   - **State** (typically `CHANGE_PASSWORD` so the user is forced to pick their own password on first login)

OIDC-federated users do not need to be created manually — the first
successful sign-in provisions them automatically.

## Updating a User

1. Navigate to **Settings** → **Users**
2. Click on a user
3. Click **Edit**
4. Update user details (changing `password` re-hashes; changing `state`
   adjusts the login flow)
5. Click **Save**

## Deleting a User

1. Navigate to **Settings** → **Users**
2. Click on a user
3. Click **Delete**
4. Confirm deletion

Deleting a user cascades to their `user_roles` rows.

## Assigning Roles to Users

Roles are managed from the **Role** side. Each role page lists its members,
and adding a user there assigns the role to that user.

1. Navigate to **Settings** → **Roles**
2. Click on a role
3. Click **Assign Users**
4. Select one or more users
5. Click **Save**

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
