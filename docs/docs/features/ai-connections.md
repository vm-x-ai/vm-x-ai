---
sidebar_position: 1
---

# AI Connections

AI Connections represent connections to specific AI providers with their credentials and capacity configuration. This guide covers everything you need to know about creating and managing AI Connections.

## What is an AI Connection?

An AI Connection encapsulates:

- **Provider**: The AI provider (OpenAI, Anthropic, Google Gemini, Groq, AWS Bedrock)
- **Credentials**: Encrypted API keys or authentication tokens
- **Capacity**: Custom capacity limits (e.g., 100 RPM, 100,000 TPM)
- **Discovered Capacity**: Automatically discovered rate limits from the provider

## Creating an AI Connection

1. Navigate to **AI Connections** in the UI
2. Click **Create Connection**
3. Fill in the connection details:
   - **Name**: A descriptive name for the connection
   - **Description**: Optional description
   - **Provider**: Select the AI provider
   - **Configuration**: Provider-specific configuration (API keys, region, etc.)
   - **Capacity**: Define capacity limits (optional)

You can also use the quick add feature for faster connection setup:

![AI Connection Quick Add](/pages/ai-connection-quick-add.png)


## Provider-Specific Configuration

### OpenAI

```json
{
  "provider": "openai",
  "config": {
    "apiKey": "sk-..."
  }
}
```

### Anthropic

```json
{
  "provider": "anthropic",
  "config": {
    "apiKey": "sk-ant-..."
  }
}
```

### Google Gemini

```json
{
  "provider": "google",
  "config": {
    "apiKey": "..."
  }
}
```

### Groq

```json
{
  "provider": "groq",
  "config": {
    "apiKey": "..."
  }
}
```

### AWS Bedrock

AWS Bedrock uses IAM roles for authentication. You need to create an IAM role in your AWS account and provide its ARN:

```json
{
  "provider": "aws-bedrock",
  "config": {
    "region": "us-east-1",
    "iamRoleArn": "arn:aws:iam::123456789012:role/vm-x-ai-bedrock-role"
  }
}
```

**IAM Role Setup:**

1. Create an IAM role in your AWS account with Bedrock permissions
2. Configure the role's trust policy to allow VM-X AI to assume it
3. Use the role ARN in the connection configuration

A CloudFormation template is available in the repository at [`packages/api/assets/aws/cfn/bedrock-iam-role.yaml`](https://github.com/vm-x-ai/open-vm-x-ai/blob/main/packages/api/assets/aws/cfn/bedrock-iam-role.yaml) to help you create the required IAM role.

## Capacity Configuration

Capacity limits control how many requests and tokens can be used within a time period.

### Capacity Periods

Supported periods:
- **minute**: Requests/tokens per minute
- **hour**: Requests/tokens per hour
- **day**: Requests/tokens per day

### Example Configuration

```json
{
  "capacity": [
    {
      "period": "minute",
      "requests": 100,
      "tokens": 100000
    },
    {
      "period": "hour",
      "requests": 5000,
      "tokens": 5000000
    },
    {
      "period": "day",
      "requests": 100000,
      "tokens": 100000000
    }
  ]
}
```

### Capacity Enforcement

Capacity is enforced at the connection level. When a request exceeds capacity:
- The request is rejected with a `429 Too Many Requests` status
- An error message indicates which limit was exceeded
- The client should retry after the rate limit window resets

## Discovered Capacity

VM-X AI automatically discovers rate limits from provider responses:

- **X-RateLimit-Limit-Requests**: Maximum requests per window
- **X-RateLimit-Limit-Tokens**: Maximum tokens per window

Discovered capacity is stored in the connection and can be viewed in the UI. This helps you:
- Understand actual provider limits
- Optimize your capacity configuration
- Monitor provider rate limit changes

## Credential Security

### Encryption

Credentials are encrypted at rest using:
- **AWS KMS**: For production environments (recommended)
- **Libsodium**: For local development and small deployments

### Credential Storage

- Credentials are stored encrypted in PostgreSQL
- Decryption happens in-memory only
- Credentials are never exposed in:
  - API responses
  - Logs
  - Error messages

### Credential Rotation

To rotate credentials:

1. Update the connection configuration with new credentials
2. The old credentials are immediately replaced
3. No downtime required - existing requests continue with old credentials until new ones are used

## Best Practices

### 1. One Connection Per Provider Account

Create separate connections for:
- Different provider accounts
- Different regions (for AWS Bedrock)
- Different environments (development, staging, production)

### 2. Set Realistic Capacity

Base capacity limits on:
- Provider quotas
- Your usage patterns
- Cost considerations

Monitor discovered capacity to understand actual provider limits.

### 3. Monitor Usage

Regularly review:
- Capacity utilization
- Discovered capacity changes
- Error rates

### 5. Secure Credentials

- Use AWS KMS for production
- Rotate credentials regularly
- Never commit credentials to version control
- Use least-privilege access for AWS KMS keys

## Updating an AI Connection

1. Navigate to the connection
2. Click **Edit**
3. Update the desired fields
4. Click **Save**

## Viewing Connection Details

Navigate to **AI Connections** and click on a connection to view:
- Connection details
- Capacity configuration
- Discovered capacity
- Usage statistics

## Troubleshooting

### Connection Not Working

1. **Verify Credentials**: Ensure API keys are correct and valid
2. **Check Provider Status**: Verify the provider service is operational
3. **Review Logs**: Check API logs for error messages
4. **Test Connection**: Use the provider's API directly to verify credentials

### Capacity Limits Too Restrictive

1. **Review Capacity Configuration**: Check if limits are too low
2. **Monitor Usage**: Review actual usage patterns
3. **Adjust Limits**: Increase capacity limits as needed
4. **Consider Prioritization**: Use prioritization to allocate capacity fairly

### Discovered Capacity Not Updating

1. **Make Requests**: Discovered capacity is updated when requests are made
2. **Check Provider Headers**: Verify provider returns rate limit headers
3. **Review Logs**: Check for errors in capacity discovery
