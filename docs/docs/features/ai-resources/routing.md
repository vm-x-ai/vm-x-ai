---
sidebar_position: 2
---

# Dynamic Routing

Routing allows you to dynamically select different models based on request characteristics. This enables intelligent request distribution, cost optimization, and performance tuning.

![Dynamic Routing Configuration](/pages/ai-resource-dynamic-route1.png)

## Overview

Dynamic routing evaluates conditions for each request and selects the most appropriate model based on:

- **Token count**: Route small requests to faster/cheaper models
- **Error rates**: Automatically switch providers when error rates are high
- **Tool usage**: Route tool-enabled requests to models that support tools
- **Content analysis**: Route based on message content or patterns
- **Traffic splitting**: A/B test models or gradually roll out new models

## Basic Routing

Route based on simple conditions. This example demonstrates token-based routing, where requests with fewer than 100 input tokens are routed to a faster, cost-effective model (Groq with `openai/gpt-oss-20b`), while larger requests use the default primary model.

**Use Case**: Optimize costs and latency by routing small, simple queries to faster models while reserving more powerful models for complex requests.

**How it works**: The routing condition evaluates `tokens.input` using the `LESS_THAN` comparator with a value of 100. When a request has fewer than 100 input tokens, it automatically routes to the specified Groq connection and model instead of the primary model.

![Basic Routing Configuration](/pages/ai-resource-dynamic-basic-routing.png)

## Routing Based on Error Rate

Automatically switch to a different provider when error rates exceed a threshold. This example monitors the error rate over the last 5 minutes and routes to Groq with `openai/gpt-oss-20b` if the error rate exceeds 10%.

**Use Case**: Maintain high availability by automatically failing over to a backup provider when the primary provider experiences issues. This is especially useful for production workloads where uptime is critical.

**How it works**: The routing condition uses `errorRate(10)` to calculate the error percentage over the last 5 minutes. When this percentage exceeds 10% (using the `GREATER_THAN` comparator), all subsequent requests are routed to the specified Groq connection and model until the error rate drops below the threshold.

**Benefits**: 
- Automatic failover without manual intervention
- Reduces downtime during provider outages
- Helps maintain service reliability

![Error Rate Routing Configuration](/pages/ai-resource-dynamic-error-rate.png)

## Routing Based on Tools Usage

Route requests that include function calling or tool usage to models that support these features. This example routes any request with tools to Groq with `openai/gpt-oss-20b`, which supports tool/function calling.

**Use Case**: Ensure requests requiring function calling or tool usage are handled by models with robust tool support, while simpler requests can use more cost-effective models.

**How it works**: The routing condition checks `request.toolsCount` using the `GREATER_THAN` comparator with a value of 0. When a request includes one or more tools (toolsCount > 0), it routes to the specified Groq connection and model.

**Benefits**:
- Guarantees tool-enabled requests use compatible models
- Prevents tool-related errors from using incompatible models
- Optimizes costs by only using premium models when needed

![Tools-Based Routing Configuration](/pages/ai-resource-dynamic-has-tools.png)

## Available Routing Fields and Expressions

VM-X AI provides a comprehensive set of routing conditions based on request characteristics:

### Token-Based Conditions

- **`tokens.input`**: Number of input tokens in the request
  - Example: Route to Groq if input tokens < 100
- **`request.allMessagesContent.length`**: Total character length of all messages
  - Example: Route based on prompt length in characters

### Content-Based Conditions

- **`request.lastMessage.content`**: Content of the last user message
  - Supports: `CONTAINS` (text search), `PATTERN` (regex pattern matching)
  - Example: Route to specific model if message contains certain keywords
- **`request.allMessagesContent`**: Combined content of all messages
  - Supports: `CONTAINS` (text search)
  - Example: Route if any message contains specific text

### Tool-Based Conditions

- **`request.toolsCount`**: Number of tools in the request
  - Supports: `GREATER_THAN` (typically with value 0 to check if tools exist)
  - Example: Route to GPT-4 if request has tools

### Error Rate Conditions

- **`errorRate(5)`**: Error rate in the last 5 minutes
- **`errorRate(10)`**: Error rate in the last 10 minutes
  - Supports: `GREATER_THAN` (percentage)
  - Example: Switch to fallback provider if error rate > 10% in last 10 minutes

## Available Comparators

- **`LESS_THAN`**: Field is less than value
- **`GREATER_THAN`**: Field is greater than value
- **`CONTAINS`**: Field contains value (for strings)
- **`PATTERN`**: Field matches regex pattern (for strings)

## Traffic Splitting

Use traffic splitting for A/B testing, gradual rollouts, or canary deployments. This example routes 50% of requests matching the condition (input tokens > 0) to Groq with `openai/gpt-oss-20b`, while the other 50% use the default primary model.

**Use Case**: 
- **A/B Testing**: Compare performance, quality, or cost between different models
- **Gradual Rollouts**: Safely introduce new models by starting with a small percentage of traffic
- **Canary Deployments**: Test new models in production with limited exposure

**How it works**: The routing condition matches any requests, but the `traffic` field limits this route to only 50% of matching requests. The remaining 50% of matching requests continue to use the primary model. This creates a controlled split where you can monitor and compare both models' performance.

**Best Practices**:
- Start with a low percentage (10-20%) when testing new models
- Monitor error rates, latency, and quality metrics for both routes
- Gradually increase the percentage as confidence grows
- Use audit logs to track which route each request took

The `traffic` field specifies the percentage (0-100) of matching requests that should use this route. If multiple routing conditions match the same request, the first matching condition with traffic splitting is applied.

![Traffic Splitting Configuration](/pages/ai-resource-dynamic-traffic.png)

## Best Practices

### 1. Start with Simple Conditions

Begin with basic routing:
- Token-based routing (small vs. large requests)
- Tool-based routing (requests with/without tools)
- Error rate-based routing (fallback when errors are high)

### 2. Test Routing Conditions

Before deploying:
- Test routing conditions with sample requests
- Verify routing logic works as expected
- Monitor routing decisions in audit logs

### 3. Use Traffic Splitting for Rollouts

Gradually roll out new models:
- Start with low traffic percentage (10-20%)
- Monitor performance and errors
- Gradually increase traffic percentage
- Fully switch when confident

### 4. Monitor Routing Decisions

Regularly review:
- Which routes are being used most
- Routing decision patterns
- Performance differences between routes
- Error rates per route

## Troubleshooting

### Routing Not Working

1. **Check Routing Enabled**: Ensure routing is enabled in the resource configuration
2. **Verify Conditions**: Check routing conditions are correct and match your use case
3. **Review Logs**: Check audit logs for routing decisions to see which conditions are being evaluated
4. **Test Conditions**: Test routing conditions with sample requests to verify they work as expected

### Wrong Model Selected

1. **Check Condition Order**: Routing conditions are evaluated in order - ensure conditions are ordered correctly
2. **Verify Expressions**: Check that expressions match the request characteristics
3. **Review Traffic Splitting**: If using traffic splitting, verify the percentage is set correctly
4. **Check Connection Availability**: Ensure the selected connection and model are available and configured correctly

## Next Steps

- [Fallback](./fallback.md) - Configure automatic fallback
- [Capacity](./capacity.md) - Set resource-level capacity limits
- [AI Resources Overview](./index.md) - Return to AI Resources overview

