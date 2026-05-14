---
sidebar_position: 1
---

# Roles

Roles manage permissions using granular policies. Each role has a name, an
optional description, and a `policy` document made up of one or more
**statements**. Each statement defines:

- **Effect**: Whether to `allow` or `deny` the matching action/resource pair
- **Actions**: Which operations the statement applies to (e.g. `ai-connection:create`)
- **Resources**: Which resource ARNs the statement applies to (e.g. `workspace:*:environment:*:ai-connection:*`)

Roles themselves are **global** to the deployment — they are not nested
inside a workspace or environment. Scoping is expressed by the resource
patterns in each statement, so a single role can grant access in one
workspace while denying it in another. The same role list is reachable
from both **Settings → Roles** and the per-environment **Security → Auth
→ Roles** page.

## Role Policy Structure

A role policy is a JSON document with a `$schema` URL and a list of
`statements`:

```json
{
  "$schema": "https://vm-x.ai/schema/role-policy.json",
  "statements": [
    {
      "effect": "allow",
      "actions": ["ai-connection:create", "ai-connection:get"],
      "resources": ["workspace:*:environment:*:ai-connection:*"]
    },
    {
      "effect": "deny",
      "actions": ["workspace:delete"],
      "resources": ["workspace:*"]
    }
  ]
}
```

:::important
`effect` is the string `"allow"` or `"deny"` — lowercase. These are the only
two values accepted by the API.
:::

## Wildcards

Both `actions` and `resources` support wildcards:

- `*` matches any sequence of characters (zero or more)
- `?` matches a single character

Examples:

- `workspace:*` matches all workspace actions or all workspace resources
- `workspace:production` matches any workspace whose name contains
  `production` (see the warning below for caveats)
- `*:get` matches every `get` action across all modules
- `ai-connection:*` matches all AI connection actions

Patterns are converted to regular expressions internally
(`*` → `.*`, `?` → `.`), so they match anywhere in the string.

:::warning
Patterns are **not anchored**. `workspace:prod` will also match
`workspace:production` because `prod` is a regex substring of
`production`. To avoid surprises, always spell out every level of the
hierarchy you mean to target (e.g. `workspace:prod:environment:*` rather
than the bare `workspace:prod`), or use a trailing wildcard
(`workspace:prod*`) when you actually do want a prefix match.
:::

## Default Roles

VM-X AI seeds three default roles on first migration. They are owned by the
seed admin user.

### `admin`

Full access to everything:

```json
{
  "$schema": "https://vm-x.ai/schema/role-policy.json",
  "statements": [
    {
      "effect": "allow",
      "actions": ["*"],
      "resources": ["*"]
    }
  ]
}
```

### `power-user`

Can do anything except create, update, or delete users and roles. Note that
this role still allows `user:get`, `user:list`, `role:get`, and `role:list`:

```json
{
  "$schema": "https://vm-x.ai/schema/role-policy.json",
  "statements": [
    {
      "effect": "deny",
      "actions": ["user:create", "user:update", "user:delete", "role:create", "role:update", "role:delete"],
      "resources": ["*"]
    },
    {
      "effect": "allow",
      "actions": ["*"],
      "resources": ["*"]
    }
  ]
}
```

`power-user` is also the default role assigned to users who sign in for the
first time through OIDC federation (see [Users](./users.md)).

### `read-only`

Can only read or list resources:

```json
{
  "$schema": "https://vm-x.ai/schema/role-policy.json",
  "statements": [
    {
      "effect": "allow",
      "actions": ["*:get", "*:list"],
      "resources": ["*"]
    }
  ]
}
```

## Creating a Custom Role

1. Navigate to **Settings** → **Roles**
2. Click **Create Role**
3. Fill in role details:

   - **Name**: Role name
   - **Description**: Role description (optional)
   - **Policy**: Define policy statements

4. Add policy statements:
   - **Effect**: `allow` or `deny`
   - **Actions**: List of actions (e.g., `ai-connection:create`)
   - **Resources**: List of resource ARNs (e.g., `workspace:*:environment:*:ai-connection:*`)

## Available Actions

Actions follow the pattern `{module}:{operation}`. The full list is exposed
by the API at `GET /role/permissions` and rendered in the UI policy editor.
Common actions:

- **Workspace**: `workspace:list`, `workspace:get`, `workspace:get-members`,
  `workspace:create`, `workspace:update`, `workspace:update-member-role`,
  `workspace:delete`, `workspace:assign`, `workspace:unassign`
- **Environment**: `environment:list`, `environment:get`, `environment:create`,
  `environment:update`, `environment:delete`
- **AI Connection**: `ai-connection:list`, `ai-connection:get`,
  `ai-connection:create`, `ai-connection:update`, `ai-connection:delete`
- **AI Resource**: `ai-resource:list`, `ai-resource:get`, `ai-resource:create`,
  `ai-resource:update`, `ai-resource:delete`
- **API Key**: `api-key:list`, `api-key:get`, `api-key:create`,
  `api-key:update`, `api-key:delete`
- **Pool Definition**: `pool-definition:get`, `pool-definition:update`,
  `pool-definition:delete`
- **Completion**: `completion:execute`
- **Completion Batch**: `completion-batch:list`, `completion-batch:get`,
  `completion-batch:create`, `completion-batch:cancel`
- **Completion Metrics**: `completion-metrics:get-error-rate`
- **Request Audit**: `request-audit:list`
- **Request Usage**: `request-usage:query`
- **User**: `user:list`, `user:get`, `user:create`, `user:update`, `user:delete`
- **Role**: `role:list`, `role:get`, `role:get-members`, `role:create`,
  `role:update`, `role:delete`, `role:assign`, `role:unassign`

## Resource Patterns

Resources follow a hierarchical pattern that nests by parent. The exact
templates per module are:

| Module             | Base resource                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Workspace          | `workspace:{workspace.name}`                                                                |
| Environment        | `workspace:{workspace.name}:environment:{environment.name}`                                 |
| AI Connection      | `workspace:{workspace.name}:environment:{environment.name}:ai-connection:{connection.name}` |
| AI Resource        | `workspace:{workspace.name}:environment:{environment.name}:ai-resource:{resource.name}`     |
| API Key            | `workspace:{workspace.name}:environment:{environment.name}:api-key:{apiKey.name}`           |
| Pool Definition    | `workspace:{workspace.name}:environment:{environment.name}:pool-definition`                 |
| Completion         | `workspace:{workspace.name}:environment:{environment.name}:completion`                      |
| Completion Batch   | `workspace:{workspace.name}:environment:{environment.name}:completion-batch:{batch.id}`     |
| Completion Metrics | `workspace:{workspace.name}:environment:{environment.name}:completion-metrics`              |
| Request Audit      | `workspace:{workspace.name}:environment:{environment.name}:request-audit`                   |
| Request Usage      | `workspace:{workspace.name}:environment:{environment.name}:request-usage`                   |
| User               | `user:{user.email}`                                                                         |
| Role               | `role:{role.name}`                                                                          |

Examples:

- `workspace:*` — all workspaces
- `workspace:production` — specific workspace
- `workspace:*:environment:*` — all environments in all workspaces
- `workspace:production:environment:staging` — specific environment
- `workspace:*:environment:*:ai-connection:*` — all AI connections
- `workspace:production:environment:staging:ai-connection:openai` — specific AI connection

## Assigning Roles to Users

Roles are assigned from the **role** side, not the user side. Each role tracks
its members; a user can hold any number of roles.

1. Navigate to **Settings** → **Roles**
2. Click on a role
3. Click **Assign Users**
4. Select one or more users
5. Click **Save**

Programmatically this maps to `POST /role/{roleId}/assign` with a
`{ "userIds": [...] }` payload, gated by the `role:assign` action on the
target role's resource. Removing users uses the matching
`POST /role/{roleId}/unassign` endpoint (gated by `role:unassign`) — or
the **Remove** button next to each member in the UI.

## Best Practices

### 1. Principle of Least Privilege

- Grant only the minimum permissions needed
- Use `deny` statements to explicitly block dangerous actions
- Review permissions regularly

### 2. Use Default Roles When Possible

- Start with the seeded `admin`, `power-user`, and `read-only` roles
- Create custom roles only when necessary
- Document the purpose of every custom role

### 3. Organize by Function

Create roles for:

- Different job functions (developer, operator, viewer)
- Different teams
- Different access levels

### 4. Test Permissions

- Test role permissions before assigning to real users
- Verify users can perform required actions
- Verify users cannot perform unauthorized actions

### 5. Regular Review

- Review user role assignments regularly
- Remove unused roles
- Update policies as requirements change

## Troubleshooting

### Role Not Working

If a role is not behaving as expected:

1. **Check Policy Syntax**: Verify the policy JSON is valid and `effect` is lowercase
2. **Check Action Names**: Verify action names match the table above
3. **Check Resource Patterns**: Verify resource patterns include every level of the hierarchy you expect
4. **Check `deny` Statements**: A matching `deny` always wins over `allow`

## Next Steps

- [Policy Guide](./policy.md) - Detailed guide on creating role policies
- [Users](./users.md) - Learn about user management
- [Workspaces and Environments](../features/workspaces-environments.md) - Learn about workspace and environment isolation
