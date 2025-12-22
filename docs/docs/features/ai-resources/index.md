---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# AI Resources

AI Resources are logical endpoints that your applications use to make AI requests. They define which provider/model to use, routing rules, fallback behavior, and capacity allocation.

## What is an AI Resource?

An AI Resource is the abstraction your applications interact with. It includes:

- **Primary Model**: The default provider/model to use
- **Routing Rules**: Conditions for dynamically selecting different models
- **Fallback Models**: Alternative models to use if the primary fails
- **Capacity**: Resource-level capacity limits
- **API Key Assignment**: Which API keys can access this resource

## Creating an AI Resource

1. Navigate to **AI Resources** in the UI
2. Click **Create New AI Resource**
3. Fill in the resource details:
   - **Name**: A descriptive name (this is what your application uses)
   - **Description**: Optional description
   - **Primary Model**: Select provider and model
   - **API Keys**: Assign API keys that can access this resource

## Using an AI Resource

<Tabs>
  <TabItem value="python" label="Python">

```python
from openai import OpenAI

workspace_id = "6c41dc1b-910c-4358-beef-2c609d38db31"
environment_id = "6c1957ca-77ca-49b3-8fa1-0590281b8b44"
resource_name = "your-resource-name"  # The name of your AI Resource

client = OpenAI(
    api_key="your-vmx-api-key",
    base_url=f"http://localhost:3000/v1/completion/{workspace_id}/{environment_id}"
)

# Use the resource name as the model
response = client.chat.completions.create(
    model=resource_name,  # Your AI Resource name
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
```

  </TabItem>
  <TabItem value="nodejs" label="Node.js">

```javascript
import OpenAI from 'openai';

const workspaceId = '6c41dc1b-910c-4358-beef-2c609d38db31';
const environmentId = '6c1957ca-77ca-49b3-8fa1-0590281b8b44';
const resourceName = 'your-resource-name'; // The name of your AI Resource

const openai = new OpenAI({
  apiKey: 'your-vmx-api-key',
  baseURL: `http://localhost:3000/v1/completion/${workspaceId}/${environmentId}`,
});

const completion = await openai.chat.completions.create({
  model: resourceName, // Your AI Resource name
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(completion.choices[0].message.content);
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/{workspaceId}/{environmentId}/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-vmx-api-key" \
  -d '{
    "model": "your-resource-name",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

  </TabItem>
</Tabs>

## API Key Assignment

Assign API keys to resources to control access:

![Assigning API Keys to AI Resource](/pages/ai-resource-assign-api-key.png)

Only requests with assigned API keys can access the resource. If no API keys are assigned, all API keys can access the resource.

## Updating an AI Resource

1. Navigate to the resource
2. Click **Edit**
3. Update the desired fields
4. Click **Save**

## Best Practices

### 1. Start Simple

Begin with:

- A single primary model
- No routing (or simple routing)
- At least one fallback model

Add complexity as needed.

### 2. Test Routing Conditions

Before deploying:

- Test routing conditions with sample requests
- Verify routing logic works as expected
- Monitor routing decisions in audit logs

### 3. Configure Fallback Chains

Always have:

- At least one fallback model for critical resources
- Fallback models from different providers
- Fallback models with different cost profiles

### 4. Set Resource Capacity

Use resource-level capacity to:

- Control costs per resource
- Ensure fair usage across resources
- Implement tiered access levels

### 5. Use API Keys for Access Control

Assign API keys to resources to:

- Control who can access which resources
- Implement multi-tenant access
- Track usage by API key

## Troubleshooting

### Routing Not Working

1. **Check Routing Enabled**: Ensure routing is enabled
2. **Verify Conditions**: Check routing conditions are correct
3. **Review Logs**: Check audit logs for routing decisions
4. **Test Conditions**: Test routing conditions with sample requests

### Fallback Not Triggering

1. **Check Fallback Enabled**: Ensure `Use Fallback` checkbox is checked
2. **Verify Fallback Models**: Check fallback models are configured
3. **Review Error Types**: Verify errors trigger fallback
4. **Check Logs**: Review logs for fallback attempts

### Capacity Limits Too Restrictive

1. **Review Capacity Configuration**: Check if limits are too low
2. **Monitor Usage**: Review actual usage patterns
3. **Adjust Limits**: Increase capacity limits as needed
4. **Consider Prioritization**: Use prioritization to allocate capacity fairly

## Next Steps

- [Dynamic Routing](./routing.md) - Learn about dynamic routing rules
- [Fallback](./fallback.md) - Configure automatic fallback
- [Capacity](./capacity.md) - Set resource-level capacity limits
- [AI Connections](../ai-connections.md) - Learn about AI Connections
- [Prioritization](../prioritization.md) - Understand capacity prioritization
- [Usage](../usage.md) - Monitor usage and metrics
