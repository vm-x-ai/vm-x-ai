---
sidebar_position: 4
---

# Usage and Analytics

VM-X AI provides comprehensive usage tracking and analytics through audit logs and time-series metrics. This guide explains how to access and use this data.

## Overview

VM-X AI tracks:

- **Audit Logs**: Complete record of every request
- **Usage Metrics**: Time-series data for capacity planning
- **Performance Metrics**: Latency, throughput, error rates

## Audit Logs

Audit logs provide a complete record of every AI request made through VM-X AI.

### What's Logged

Each audit log entry includes:

- **Request Details**: Model, provider, messages, parameters
- **Response Details**: Response content, tokens used, latency
- **Routing Information**: Which model was used, routing decisions
- **Fallback Information**: Fallback attempts and results
- **Capacity Information**: Capacity checks and prioritization decisions
- **Metadata**: Request ID, correlation ID, API key, user, timestamp

### Accessing Audit Logs

1. Navigate to **Audit** in the UI
2. Use filters to find specific requests:

   - Date range
   - Resource
   - Provider
   - Model
   - Status code
   - API key
   - User

3. Click on a request to view details:
   - Request payload
   - Response data
   - Routing events
   - Capacity events
   - Error information

### Audit Log Fields

- **id**: Unique request ID
- **timestamp**: Request timestamp
- **workspaceId**: Workspace ID
- **environmentId**: Environment ID
- **resourceId**: AI Resource ID
- **connectionId**: AI Connection ID
- **provider**: Provider name
- **model**: Model name
- **statusCode**: HTTP status code
- **duration**: Request duration in milliseconds
- **requestPayload**: Complete request payload
- **responseData**: Response data
- **events**: Array of events (routing, capacity, etc.)
- **apiKeyId**: API key used
- **userId**: User who made the request
- **sourceIp**: Source IP address
- **errorMessage**: Error message (if any)
- **failureReason**: Failure reason (if any)

### Exporting Audit Logs

Audit logs can be exported for:

- Compliance requirements
- Analysis in external tools
- Backup and archival

## Usage Metrics

Usage metrics are stored in a time-series database (QuestDB or AWS Timestream) for efficient querying and analysis.

### Metrics Tracked

- **Request Count**: Number of requests per time period
- **Token Usage**: Prompt tokens, completion tokens, total tokens
- **Latency**: Request duration, time to first token
- **Error Rates**: Error counts and percentages
- **Capacity Usage**: RPM and TPM utilization
- **Provider Metrics**: Per-provider statistics

### Accessing Usage Metrics

Navigate to **Usage** in the UI to view:

- Usage charts and graphs
- Token usage over time
- Request counts
- Error rates
- Capacity utilization

![Usage Dashboard](/pages/usage-dashboard.png)

## OpenTelemetry Integration

VM-X AI exports metrics and traces to OpenTelemetry-compatible backends.

### Metrics Exported

- **completion.requests.total**: Total completion requests
- **completion.requests.success**: Successful requests
- **completion.requests.error**: Failed requests
- **completion.tokens.total**: Total tokens used
- **completion.tokens.prompt**: Prompt tokens
- **completion.tokens.completion**: Completion tokens
- **completion.duration**: Request duration
- **completion.routing.duration**: Routing evaluation duration
- **completion.gate.duration**: Capacity gate duration

### Traces Exported

- **Request Lifecycle**: Full request lifecycle
- **Provider Calls**: Individual provider requests
- **Routing Decisions**: Routing condition evaluation
- **Capacity Checks**: Capacity and prioritization gates

### Configuring OpenTelemetry

Set environment variables:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

### Supported Backends

- **Datadog**: Via OpenTelemetry collector
- **Prometheus**: Via OpenTelemetry collector
- **Jaeger**: Direct OTLP export
- **AWS X-Ray**: Via OpenTelemetry collector
- **Any OpenTelemetry-compatible backend**

## Dashboard Examples

### Request Volume

Track request volume over time:

- Requests per hour/day
- Requests by resource
- Requests by provider

### Token Usage

Monitor token usage:

- Total tokens per period
- Prompt vs. completion tokens
- Token usage by resource
- Token usage by provider

### Error Rates

Monitor error rates:

- Error rate over time
- Errors by provider
- Errors by resource
- Error types

### Capacity Utilization

Track capacity usage:

- RPM utilization
- TPM utilization
- Capacity by resource
- Capacity by connection

## Best Practices

### 1. Regular Monitoring

- Review usage metrics regularly
- Set up alerts for anomalies
- Monitor capacity utilization
- Track error rates

### 2. Capacity Planning

- Use historical data for capacity planning
- Identify usage patterns
- Plan for peak usage
- Adjust capacity based on trends

### 3. Performance Optimization

- Analyze token usage by provider
- Identify performance bottlenecks
- Optimize routing based on latency and throughput
- Monitor performance trends

### 4. Performance Optimization

- Monitor latency metrics
- Identify slow operations
- Optimize routing based on performance
- Track provider performance

### 5. Compliance

- Retain audit logs as required
- Export logs for compliance
- Monitor access patterns
- Track user activity

## Exporting Data

### Audit Logs

Export audit logs for:

- Compliance requirements
- External analysis
- Backup and archival

### Usage Metrics

Export usage metrics to:

- Business intelligence tools
- Performance analysis tools
- Custom dashboards
