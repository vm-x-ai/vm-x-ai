---
sidebar_position: 3
---

# Users

Users represent individuals who can access VM-X AI. Users can:

- Be assigned to workspaces as members or owners
- Have roles assigned for fine-grained permissions
- Access resources based on their permissions

## Creating a User

1. Navigate to **Settings** → **Users**
2. Click **Create User**
3. Fill in user details:
   - **Username**: Unique username
   - **Email**: User email address
   - **Password**: User password (or generate one)

## Updating a User

1. Navigate to **Settings** → **Users**
2. Click on a user
3. Click **Edit**
4. Update user details
5. Click **Save**

## Deleting a User

1. Navigate to **Settings** → **Users**
2. Click on a user
3. Click **Delete**
4. Confirm deletion

## Assigning Roles to Users

1. Navigate to **Settings** → **Roles**
2. Click on a role
3. Click **Add Member**
4. Select a user
5. Click **Save**

## Troubleshooting

### User Cannot Perform Action

If a user cannot perform an action:

1. **Check Role Assignment**: Verify the user has a role assigned
2. **Check Role Policy**: Verify the role policy allows the action
3. **Check Resource Pattern**: Verify the resource pattern matches
4. **Check DENY Statements**: Verify no DENY statement blocks the action

## Next Steps

- [Roles](./roles.md) - Learn about role management
- [Policy Guide](./policy.md) - Detailed guide on creating role policies
- [Workspaces and Environments](../features/workspaces-environments.md) - Learn about workspace and environment isolation

