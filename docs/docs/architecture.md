---
sidebar_position: 3
---

# Architecture

VM-X AI is built on a modern, scalable stack designed for production use. This page provides an overview of the technical architecture and components.

## Technology Stack

### Backend (API Server)

- **Framework**: [NestJS](https://nestjs.com/) - Progressive Node.js framework
- **Runtime**: Node.js 24+
- **Language**: TypeScript
- **HTTP Server**: Fastify (high-performance HTTP framework)
- **Database ORM**: Kysely (type-safe SQL query builder)

### Frontend (UI Application)

- **Framework**: [Next.js](https://nextjs.org/) - React framework with server-side rendering
- **UI Library**: Material-UI (MUI) - React component library
- **State Management**: Zustand
- **API Client**: Auto-generated from OpenAPI specification

### Data Storage

#### Primary Database: PostgreSQL

- **Purpose**: Configuration data, audit logs, user management
- **Schema**: Managed through Kysely migrations
- **Connection Pooling**: Separate read/write pools for scalability
- **Features**:
  - Workspaces and environments for multi-tenancy
  - AI Connections and AI Resources configuration
  - API Keys and user management
  - Completion audit logs

#### Time-Series Database

**QuestDB** (default) or **AWS Timestream**

- **Purpose**: High-performance storage of usage metrics
- **Data**: Token usage, request counts, latency metrics
- **Query Performance**: Optimized for time-series queries
- **Integration**: Automatic export from completion service

### Caching and Capacity Tracking

**Redis** (Single or Cluster mode)

- **Purpose**: 
  - Capacity tracking (RPM, TPM counters)
  - Caching of AI connections and resources
  - Prioritization metrics storage
  - Session management
- **Modes**:
  - Single node: For development and small deployments
  - Cluster: For production high availability

### Encryption

**AWS KMS** (production) or **Libsodium** (development)

- **Purpose**: Encrypt sensitive credentials (API keys, tokens)
- **Storage**: Encrypted credentials stored in PostgreSQL
- **Access**: Decryption happens in-memory only

### Observability

**OpenTelemetry** Integration

- **Traces**: Distributed tracing across services
- **Metrics**: Custom metrics for completion requests, routing, capacity
- **Export**: Compatible with any OpenTelemetry backend (Datadog, Jaeger, Prometheus, etc.)

## System Architecture

```mermaid
graph TB
    Internet[Internet]
    LB[Load Balancer / Ingress<br/>Istio Gateway / ALB / NLB]
    
    UI1[UI Pod<br/>Next.js<br/>Port: 3001]
    API1[API Pod<br/>NestJS<br/>Port: 3000]
    API2[API Pod<br/>NestJS<br/>Port: 3000]
    
    PG[(PostgreSQL<br/>Config & Audit)]
    Redis[(Redis<br/>Capacity & Cache)]
    QuestDB[(QuestDB<br/>Metrics)]
    KMS[AWS KMS<br/>Encryption]
    
    Internet --> LB
    LB --> UI1
    LB --> API1
    LB --> API2
    
    API1 --> PG
    API2 --> PG
    API1 --> Redis
    API2 --> Redis
    API1 --> QuestDB
    API2 --> QuestDB
    API1 --> KMS
    API2 --> KMS
    
    style Internet fill:#e3f2fd
    style LB fill:#fff3e0
    style UI1 fill:#e8f5e9
    style API1 fill:#e8f5e9
    style API2 fill:#e8f5e9
    style PG fill:#f3e5f5
    style Redis fill:#ffebee
    style QuestDB fill:#e0f2f1
    style KMS fill:#fff9c4
```

## Request Flow

### 1. Client Request

```mermaid
sequenceDiagram
    participant App as Application
    participant VMX as VM-X AI API
    participant Auth as Auth Service
    participant Resource as AI Resource
    participant Gate as Gate Service
    participant Routing as Routing Service
    participant Connection as AI Connection
    participant Provider as AI Provider
    
    App->>VMX: OpenAI SDK Request<br/>baseURL: /v1/completion/{workspaceId}/{environmentId}
    VMX->>Auth: Validate API Key
    Auth-->>VMX: API Key Valid
    VMX->>Resource: Load AI Resource
    Resource-->>VMX: Resource Config
    VMX->>Gate: Check Capacity
    Gate-->>VMX: Capacity OK
    VMX->>Routing: Evaluate Routing
    Routing-->>VMX: Selected Model
    VMX->>Connection: Get Connection
    Connection-->>VMX: Connection Config
    VMX->>Provider: Make Request
    Provider-->>VMX: Stream Response
    VMX-->>App: Stream to Client
```

The application uses the standard OpenAI SDK to make requests:

```typescript
import OpenAI from 'openai';

const workspaceId = "6c41dc1b-910c-4358-beef-2c609d38db31";
const environmentId = "6c1957ca-77ca-49b3-8fa1-0590281b8b44";

const openai = new OpenAI({
  apiKey: 'vmx-api-key-here',
  baseURL: `https://vm-x-ai.example.com/v1/completion/${workspaceId}/${environmentId}`,
});

const completion = await openai.chat.completions.create({
  model: 'chat-completion', // Resource name, not actual model
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### 2. Authentication & Authorization

VM-X AI supports multiple authentication methods:

#### API Key Authentication

```mermaid
flowchart LR
    A[API Request] --> B{Validate API Key}
    B -->|Valid| C{Check Resource Access}
    B -->|Invalid| D[401 Unauthorized]
    C -->|Authorized| E[Establish User Context]
    C -->|Unauthorized| F[403 Forbidden]
```

- API key is validated
- Resource access is checked
- User context is established (if applicable)

#### OIDC Federated Login (SSO)

For UI access, VM-X AI supports OIDC federated login:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant API
    participant OIDC as OIDC Provider
    participant DB
    
    User->>UI: Click SSO Login
    UI->>OIDC: Redirect to OIDC Provider
    OIDC->>User: Authenticate
    User->>OIDC: Provide Credentials
    OIDC->>UI: Redirect with Authorization Code
    UI->>API: Exchange Code for Token
    API->>OIDC: Validate Token
    OIDC-->>API: Token Valid + User Info
    API->>DB: Create/Update User
    DB-->>API: User Created/Updated
    API->>UI: Session Created
    UI-->>User: Logged In
```

**OIDC Configuration:**

Configure via environment variables:
- `OIDC_FEDERATED_ISSUER`: OIDC issuer URL (required)
- `OIDC_FEDERATED_CLIENT_ID`: OIDC client ID (required)
- `OIDC_FEDERATED_CLIENT_SECRET`: OIDC client secret (optional)
- `OIDC_FEDERATED_SCOPE`: OIDC scopes (default: `openid profile email`)
- `OIDC_FEDERATED_DEFAULT_ROLE`: Default role for federated users (default: `power-user`)

When OIDC is configured, the login page displays an "SSO Login" button. After successful authentication, users are automatically created (if they don't exist) and assigned the default role.

### 3. Resource Resolution

```mermaid
flowchart TD
    A[Load AI Resource] --> B{Routing Enabled?}
    B -->|Yes| C[Evaluate Routing Conditions]
    B -->|No| D[Use Primary Model]
    C -->|Match| E[Use Routed Model]
    C -->|No Match| D
```

- AI Resource is loaded from cache or database
- Routing conditions are evaluated
- Primary or routed model is selected

### 4. Capacity Check

```mermaid
flowchart TD
    A[Request Received] --> B{Connection Capacity OK?}
    B -->|No| C[429 Too Many Requests]
    B -->|Yes| D{Resource Capacity OK?}
    D -->|No| C
    D -->|Yes| E{Prioritization Gate}
    E -->|Allowed| F[Proceed]
    E -->|Denied| C
```

- Connection-level capacity is checked (RPM, TPM)
- Resource-level capacity is checked
- Prioritization gate evaluates if request should proceed

### 5. Provider Request

```mermaid
sequenceDiagram
    participant API as VM-X AI API
    participant Vault as Vault Service
    participant Provider as AI Provider
    
    API->>Vault: Decrypt Credentials
    Vault-->>API: Decrypted Credentials
    API->>Provider: Make Request
    Provider-->>API: Stream Response
    API-->>API: Stream to Client
```

- Credentials are decrypted (AWS KMS or Libsodium)
- Request is made to the selected AI provider
- Response is streamed back to the client

### 6. Fallback (if needed)

```mermaid
flowchart TD
    A[Primary Model Request] --> B{Success?}
    B -->|Yes| C[Return Response]
    B -->|No| D{More Fallbacks?}
    D -->|Yes| E[Try Next Fallback]
    D -->|No| F[Return Error]
    E --> B
```

- If primary model fails, fallback models are tried in order
- First successful response is returned
- All attempts are logged for analysis

### 7. Metrics & Audit

```mermaid
flowchart LR
    A[Request Complete] --> B[Update Redis Counters]
    A --> C[Push to QuestDB/Timestream]
    A --> D[Store Audit Log in PostgreSQL]
    
    B --> E[Capacity Tracking]
    C --> F[Usage Metrics]
    D --> G[Audit Trail]
```

- Capacity counters are updated in Redis
- Usage metrics are pushed to time-series database
- Audit log entry is created in PostgreSQL

## Component Details

### API Server (NestJS)

**Key Modules:**

- **Completion Module**: Handles chat completion requests
- **AI Connection Module**: Manages provider connections
- **AI Resource Module**: Manages logical resources
- **API Key Module**: Manages API keys and access control
- **Capacity Module**: Tracks and enforces capacity limits
- **Prioritization Module**: Implements prioritization algorithms
- **Audit Module**: Stores completion audit logs
- **Usage Module**: Stores time-series usage metrics
- **Vault Module**: Handles credential encryption/decryption

**Key Services:**

- `CompletionService`: Main request handler
- `ResourceRoutingService`: Evaluates routing conditions
- `GateService`: Capacity and prioritization checks
- `AIConnectionService`: Connection management
- `AIResourceService`: Resource management
- `CompletionAuditService`: Audit logging
- `CompletionUsageService`: Usage metrics

### UI Application (Next.js)

**Key Features:**

- **Workspace Management**: Multi-workspace support
- **Environment Management**: Isolated environments per workspace
- **AI Connection Management**: Create and configure connections
- **AI Resource Management**: Create and configure resources
- **API Key Management**: Generate and manage API keys
- **Audit Log Viewer**: Browse and filter completion logs
- **Usage Dashboard**: View usage metrics and charts
- **Prioritization Configuration**: Configure pool definitions

### Data Flow

#### Configuration Data

```mermaid
flowchart LR
    UI[UI] --> API[API]
    API --> PG[(PostgreSQL)]
    PG --> Cache[(Redis Cache)]
    Cache --> API
```

Configuration changes flow from UI to API, are stored in PostgreSQL, and cached in Redis for fast access.

#### Usage Metrics

```mermaid
flowchart LR
    API[API] --> TS[(QuestDB/Timestream)]
    TS --> Dashboard[Dashboard]
    TS --> Export[OpenTelemetry Export]
```

Usage metrics are written to time-series database and can be queried for dashboards or exported to OpenTelemetry.

#### Audit Logs

```mermaid
flowchart LR
    API[API] --> PG[(PostgreSQL)]
    PG --> UI[UI Audit Viewer]
    PG --> Export[Export]
```

Audit logs are stored in PostgreSQL and can be viewed in the UI or exported.

## Scalability

### Horizontal Scaling

- **API Pods**: Stateless, can scale horizontally
- **UI Pods**: Stateless, can scale horizontally
- **Redis**: Cluster mode for high availability
- **PostgreSQL**: Read replicas for read scaling

### Caching Strategy

- **AI Connections**: Cached in Redis with TTL
- **AI Resources**: Cached in Redis with TTL
- **Capacity Counters**: Stored in Redis with expiration
- **Database Queries**: Connection pooling for efficiency

### Performance Optimizations

- **Connection Pooling**: Separate read/write pools
- **Batch Operations**: Audit logs and metrics are batched
- **Async Processing**: Non-blocking operations where possible
- **Streaming Responses**: Support for streaming completions

## Security

### Encryption

- **At Rest**: Credentials encrypted in PostgreSQL
- **In Transit**: TLS/HTTPS for all communications
- **In Memory**: Credentials decrypted only when needed

### Access Control

- **API Keys**: Resource-level access control
- **Workspaces**: Multi-tenant isolation
- **Environments**: Additional isolation layer

### Audit

- **Complete Audit Trail**: Every request is logged
- **Immutable Logs**: Audit logs cannot be modified
- **Compliance Ready**: Structured for compliance requirements

## Observability

### Metrics

- **Request Count**: Total requests per resource/connection
- **Token Usage**: Prompt, completion, and total tokens
- **Latency**: Request duration, time to first token
- **Error Rates**: Error counts and rates
- **Capacity Usage**: RPM and TPM utilization

### Traces

- **Distributed Tracing**: Full request lifecycle
- **Provider Calls**: Trace individual provider requests
- **Routing Decisions**: Trace routing condition evaluation
- **Capacity Checks**: Trace capacity and prioritization gates

### Logs

- **Structured Logging**: JSON logs with context
- **Request Logs**: All completion requests
- **Error Logs**: Detailed error information
- **Audit Logs**: Complete audit trail

## Deployment Options

VM-X AI can be deployed in various environments:

- **Local Development**: Docker Compose
- **Kubernetes**: Helm chart for any Kubernetes cluster
- **AWS EKS**: Complete CDK stack with EKS
- **AWS ECS**: Complete CDK stack with ECS Fargate

See the [Deployment Guides](../deployment/minikube) for detailed instructions.

