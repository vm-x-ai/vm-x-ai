---
sidebar_position: 1
---

# Roles

Roles manage permissions using granular policies. Each role defines:

- **Actions**: What operations can be performed
- **Resources**: What resources can be accessed
- **Effect**: Whether to allow or deny the action

## Role Policy Structure

A role policy consists of statements:

```json
{
  "statements": [
    {
      "effect": "ALLOW",
      "actions": ["ai-connection:create", "ai-connection:get"],
      "resources": ["workspace:*:environment:*:ai-connection:*"]
    },
    {
      "effect": "DENY",
      "actions": ["workspace:delete"],
      "resources": ["workspace:*"]
    }
  ]
}
```

## Wildcards

Roles support wildcards for flexible permission management:

- `*` matches any value
- `?` matches a single character

Examples:
- `workspace:*` matches all workspaces
- `workspace:production` matches only the "production" workspace
- `*:get` matches all "get" actions
- `ai-connection:*` matches all AI connection actions

## Default Roles

VM-X AI includes three default roles:

### Admin

Full access to everything:

```json
{
  "statements": [
    {
      "effect": "ALLOW",
      "actions": ["*"],
      "resources": ["*"]
    }
  ]
}
```

### Power User

Can create workspaces, environments, connections, and resources, but cannot manage roles or users:

```json
{
  "statements": [
    {
      "effect": "DENY",
      "actions": ["user:*", "role:*"],
      "resources": ["*"]
    },
    {
      "effect": "ALLOW",
      "actions": ["*"],
      "resources": ["*"]
    }
  ]
}
```

### Read Only

Can only read/list resources:

```json
{
  "statements": [
    {
      "effect": "ALLOW",
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
   - **Description**: Role description
   - **Policy**: Define policy statements

4. Add policy statements:
   - **Effect**: ALLOW or DENY
   - **Actions**: List of actions (e.g., `ai-connection:create`)
   - **Resources**: List of resources (e.g., `workspace:*:environment:*:ai-connection:*`)

## Available Actions

Actions follow the pattern: `{module}:{operation}`

Common actions:
- `workspace:create`, `workspace:get`, `workspace:list`, `workspace:update`, `workspace:delete`
- `environment:create`, `environment:get`, `environment:list`, `environment:update`, `environment:delete`
- `ai-connection:create`, `ai-connection:get`, `ai-connection:list`, `ai-connection:update`, `ai-connection:delete`
- `ai-resource:create`, `ai-resource:get`, `ai-resource:list`, `ai-resource:update`, `ai-resource:delete`
- `api-key:create`, `api-key:get`, `api-key:list`, `api-key:update`, `api-key:delete`
- `user:create`, `user:get`, `user:list`, `user:update`, `user:delete`
- `role:create`, `role:get`, `role:list`, `role:update`, `role:delete`

## Resource Patterns

Resources follow the pattern: `{module}:{identifier}:{submodule}:{identifier}:...`

Examples:
- `workspace:*` - All workspaces
- `workspace:production` - Specific workspace
- `workspace:*:environment:*` - All environments in all workspaces
- `workspace:production:environment:staging` - Specific environment
- `workspace:*:environment:*:ai-connection:*` - All AI connections
- `workspace:production:environment:staging:ai-connection:openai` - Specific AI connection

## Assigning Roles to Users

1. Navigate to **Settings** → **Users**
2. Click on a user
3. Click **Roles**
4. Click **Assign Role**
5. Select a role
6. Click **Assign**

## Best Practices

### 1. Principle of Least Privilege

- Grant only the minimum permissions needed
- Use DENY statements to explicitly block actions
- Review permissions regularly

### 2. Use Default Roles When Possible

- Start with default roles (admin, power-user, read-only)
- Create custom roles only when needed
- Document custom role purposes

### 3. Organize by Function

Create roles for:
- Different job functions (developer, operator, viewer)
- Different teams
- Different access levels

### 4. Test Permissions

- Test role permissions before assigning
- Verify users can perform required actions
- Verify users cannot perform unauthorized actions

### 5. Regular Review

- Review user roles regularly
- Remove unused roles
- Update roles as requirements change

## Troubleshooting

### Role Not Working

If a role is not working:

1. **Check Policy Syntax**: Verify the policy JSON is valid
2. **Check Action Names**: Verify action names are correct
3. **Check Resource Patterns**: Verify resource patterns match
4. **Check Statement Order**: DENY statements are evaluated first

## Next Steps

- [Policy Guide](./policy.md) - Detailed guide on creating role policies
- [Users](./users.md) - Learn about user management
- [Workspaces and Environments](../features/workspaces-environments.md) - Learn about workspace and environment isolation

