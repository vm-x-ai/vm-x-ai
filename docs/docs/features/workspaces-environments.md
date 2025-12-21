---
sidebar_position: 0
---

# Workspaces and Environments

VM-X AI uses a hierarchical structure for organization and isolation: **Workspaces** and **Environments**. Understanding this structure is essential for effectively managing your AI resources.

## Workspaces

A **Workspace** is the top-level isolation layer that groups a set of environments. Workspaces provide:

- **Multi-tenancy**: Complete isolation between different organizations or teams
- **Access Control**: Workspace-level permissions and member management
- **Resource Organization**: Logical grouping of related environments

### Workspace Members

Each workspace can have two types of members:

- **Owner**: Can do anything in the workspace, including deleting the workspace
- **Member**: Can create environments, AI connections, and resources, but cannot delete workspaces

### Creating a Workspace

1. Navigate to **Getting Started** from the sidebar
2. Fill in workspace details:
   - **Name**: A descriptive name
   - **Description**: Optional description

## Environments

An **Environment** is an isolation layer within a workspace that groups resources. Environments provide:

- **Resource Isolation**: AI Connections, AI Resources, API Keys, and Usage data are scoped to environments
- **Environment-based Routing**: Different environments can have different configurations
- **Deployment Separation**: Separate environments for development, staging, and production

### Creating an Environment

1. Navigate to the **Workspaces** page from the sidebar
2. Click on the plus icon next to the workspace
3. Fill in environment details:
   - **Name**: A descriptive name (e.g., "production", "staging", "development")

## Workspace and Environment Isolation

All resources in VM-X AI are scoped to a workspace and environment:

- **AI Connections**: Created within an environment
- **AI Resources**: Created within an environment
- **API Keys**: Created within an environment
- **Usage Data**: Tracked per environment
- **Audit Logs**: Scoped to workspace and environment

### API Endpoint Structure

The completion API uses workspace and environment IDs in the endpoint path:

```
/v1/completion/{workspaceId}/{environmentId}/chat/completions
```

This ensures:
- Complete isolation between workspaces
- Complete isolation between environments
- No risk of cross-environment data access

### Example API Usage

```javascript
import OpenAI from 'openai';

const workspaceId = "6c41dc1b-910c-4358-beef-2c609d38db31";
const environmentId = "6c1957ca-77ca-49b3-8fa1-0590281b8b44";
const resourceName = "chat-completion";

const openai = new OpenAI({
  baseURL: `http://localhost:3000/v1/completion/${workspaceId}/${environmentId}`,
  apiKey: '<VM_X_API_KEY>',
});

const completion = await openai.chat.completions.create({
  model: resourceName, // VM-X Resource Name
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Best Practices

### 1. Organize by Purpose

Create workspaces for:
- Different organizations or teams
- Different projects
- Different business units

### 2. Use Environments for Lifecycle

Create environments for:
- **Development**: Testing and development
- **Staging**: Pre-production testing
- **Production**: Live production workloads

### 3. Separate Credentials

Use different AI Connections for:
- Different environments (separate API keys)
- Different providers
- Different regions

### 4. Isolate Resources

Create separate AI Resources for:
- Different use cases
- Different cost tiers
- Different performance requirements

### 5. Manage Access

- Assign workspace members appropriately
- Use roles for fine-grained permissions
- Review access regularly

## Managing Workspace Members

### Adding Members

1. Navigate to the **Workspaces** from the sidebar
2. Click on the edit icon next to the workspace
3. Click **Add Member**
4. Select user and role (Owner or Member)

### Removing Members

1. Navigate to the **Workspaces** from the sidebar
2. Click on the edit icon next to the workspace
2. Click **Members**
3. Click on the remove icon next to the member

## Troubleshooting

### Cannot Access Workspace

If you cannot access a workspace:

1. **Check Membership**: Verify you are a member of the workspace
2. **Check Permissions**: Verify your role has the required permissions
3. **Check Workspace Status**: Verify the workspace exists and is active

### Cannot Access Environment

If you cannot access an environment:

1. **Check Workspace Access**: Verify you have access to the parent workspace
2. **Check Environment Exists**: Verify the environment exists
3. **Check Permissions**: Verify your role has the required permissions

### Resources Not Visible

If resources are not visible:

1. **Check Environment**: Verify you are viewing the correct environment
2. **Check Permissions**: Verify your role has read permissions
3. **Check Resource Status**: Verify resources are enabled
