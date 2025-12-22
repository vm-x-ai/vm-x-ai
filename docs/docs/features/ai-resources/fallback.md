---
sidebar_position: 3
---

# Automatic Fallback

Fallback models are automatically used if the primary model fails. This ensures high availability and resilience to provider outages.

![Fallback Configuration](/pages/ai-resource-fallback.png)

## Overview

Automatic fallback provides:

- **High Availability**: Automatic failover when primary models fail
- **Resilience**: Protection against provider outages and errors
- **Cost Optimization**: Use cheaper fallback models when appropriate
- **Zero Downtime**: Seamless switching between providers

## Configuring Fallback

1. Navigate to **AI Resources** in the UI
2. Click on the resource you want to configure
3. Click on the **Fallback** tab
4. Check the **Use Fallback** checkbox
5. Configure the fallback models
6. Click on the **Save** button

### Fallback Model Order

Fallback models are tried in the order they are configured:

1. Primary model fails
2. Try first fallback model
3. If that fails, try second fallback model
4. Continue until a model succeeds or all fail

## When Fallback Triggers

Fallback is automatically triggered on:

- **Provider Errors**: 5xx status codes from the provider
- **Rate Limit Errors**: 429 status codes (too many requests)
- **Timeout Errors**: Request timeouts
- **Network Failures**: Connection failures
- **Invalid Response**: Malformed or invalid responses from the provider

### Error Types That Trigger Fallback

| Error Type       | Status Code | Description            |
| ---------------- | ----------- | ---------------------- |
| Server Error     | 5xx         | Provider server errors |
| Rate Limit       | 429         | Too many requests      |
| Timeout          | -           | Request timeout        |
| Network Error    | -           | Connection failures    |
| Invalid Response | -           | Malformed responses    |

## Fallback Chain Example

Consider a resource with the following configuration:

```json
{
  "model": {
    "provider": "openai",
    "connectionId": "openai-connection-id",
    "model": "gpt-4o"
  },
  "useFallback": true,
  "fallbackModels": [
    {
      "provider": "bedrock",
      "connectionId": "bedrock-connection-id",
      "model": "anthropic.claude-3-5-sonnet-20241022-v2:0"
    },
    {
      "provider": "groq",
      "connectionId": "groq-connection-id",
      "model": "llama-3.1-70b-versatile"
    }
  ]
}
```

**Request Flow:**

1. Request comes in → Try OpenAI GPT-4o
2. If OpenAI fails → Try Bedrock Claude
3. If Bedrock fails → Try Groq Llama
4. If all fail → Return error to client

## Best Practices

### 1. Use Multiple Fallback Models

Always configure multiple fallback models:

- Different providers (avoid single points of failure)
- Different cost profiles (balance cost and availability)
- Different performance characteristics (optimize for different scenarios)

### 2. Order Fallback Models Strategically

Order fallback models by:

- **Reliability**: Most reliable models first
- **Cost**: Cheaper models for non-critical fallbacks
- **Performance**: Faster models for time-sensitive requests
- **Provider Diversity**: Use different providers to avoid cascading failures

### 3. Test Fallback Chains

Before deploying:

- Test fallback chains with simulated failures
- Verify fallback models are accessible and configured correctly
- Monitor fallback usage in production

### 4. Monitor Fallback Usage

Regularly review:

- How often fallback is triggered
- Which fallback models are used most
- Error patterns that trigger fallback
- Performance of fallback models vs. primary

## Fallback and Routing

Fallback works seamlessly with routing:

1. **Routing selects a model** based on conditions
2. **If the routed model fails**, fallback chain is triggered
3. **Fallback models are tried** in order until one succeeds

Example:

```json
{
  "routing": {
    "enabled": true,
    "conditions": [
      {
        "description": "Use Groq for small requests",
        "expression": "tokens.input",
        "comparator": "LESS_THAN",
        "value": {
          "type": "NUMBER",
          "value": 100
        },
        "then": {
          "provider": "groq",
          "connectionId": "groq-connection-id",
          "model": "llama-3.1-70b-versatile"
        }
      }
    ]
  },
  "useFallback": true,
  "fallbackModels": [
    {
      "provider": "openai",
      "connectionId": "openai-connection-id",
      "model": "gpt-4o-mini"
    }
  ]
}
```

**Request Flow:**

1. Small request (< 100 tokens) → Route to Groq
2. If Groq fails → Fallback to OpenAI GPT-4o-mini
3. If OpenAI fails → Return error

## Troubleshooting

### Fallback Not Triggering

1. **Check Fallback Enabled**: Ensure `Use Fallback` checkbox is checked
2. **Verify Fallback Models**: Check fallback models are configured correctly
3. **Review Error Types**: Verify errors trigger fallback (some errors may not trigger fallback)
4. **Check Logs**: Review logs for fallback attempts and reasons

### Fallback Models Failing

1. **Check Connection Status**: Verify fallback connections are active and configured correctly
2. **Verify Model Availability**: Ensure fallback models are available from the provider
3. **Review Error Messages**: Check error messages to understand why fallback models are failing
4. **Test Fallback Models**: Test fallback models independently to verify they work

### All Models Failing

If all models (primary + fallbacks) are failing:

1. **Check Provider Status**: Verify provider services are operational
2. **Review Network Connectivity**: Check network connectivity to providers
3. **Verify Credentials**: Ensure all connections have valid credentials
4. **Check Capacity**: Verify connections have available capacity
5. **Review Error Patterns**: Look for common error patterns across providers

## Next Steps

- [Dynamic Routing](./routing.md) - Learn about dynamic routing rules
- [Capacity](./capacity.md) - Set resource-level capacity limits
- [AI Resources Overview](./index.md) - Return to AI Resources overview
