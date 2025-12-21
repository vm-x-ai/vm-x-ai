# Contributing to VM-X AI

Thank you for your interest in contributing to VM-X AI! This document provides guidelines and instructions for setting up a development environment.

## Development Setup

### Prerequisites

- Node.js (v20 or higher)
- pnpm (package manager)
- Docker and Docker Compose (for local services)
- PostgreSQL (via Docker Compose)
- Redis (via Docker Compose)
- QuestDB (via Docker Compose, optional - for time-series data)

### Getting Started

1. **Clone the repository**

```bash
git clone https://github.com/vm-x-ai/open-vm-x-ai.git
cd open-vm-x-ai
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Start local services with Docker Compose**

```bash
docker-compose up
```

This will start:
- PostgreSQL (port 5440)
- Redis Cluster (port 7001)
- QuestDB (port 8812)

4. **Configure environment variables**

Create `.env.local` files for both the API and UI packages:

#### `packages/api/.env.local`

```env
LOCAL=true
BASE_URL=http://localhost:3000

# PG Database
DATABASE_HOST=localhost
DATABASE_RO_HOST=localhost
DATABASE_PORT=5440
DATABASE_USER=admin
DATABASE_PASSWORD=password
DATABASE_DB_NAME=vmxai

# Redis
REDIS_HOST=localhost
REDIS_PORT=7001
REDIS_MODE=cluster

# Vault
ENCRYPTION_PROVIDER=libsodium

# Libsodium
LIBSODIUM_ENCRYPTION_KEY=mPpddUYSuhIkuLq6MqeARZSEBZiwWm0HwEGQD5YSMFc=

# Timeseries Database
COMPLETION_USAGE_PROVIDER=questdb

# QuestDB
QUESTDB_HOST=localhost
QUESTDB_PORT=8812
QUESTDB_USER=admin
QUESTDB_PASSWORD=password
QUESTDB_DB_NAME=vmxai

# UI
UI_BASE_URL=http://localhost:3001

OTEL_LOG_LEVEL=error
```

#### `packages/ui/.env.local`

```env
AUTH_SECRET="iK0aiF1Hc57/P4Jym7Dz51sjlleE6onQXcAFBG7uvss=" # Added by `npx auth`. Read more: https://cli.authjs.dev
AUTH_OIDC_ISSUER=http://localhost:3000/oauth2
AUTH_OIDC_CLIENT_ID=ui
AUTH_OIDC_CLIENT_SECRET=ui

API_BASE_URL=http://localhost:3000
```

5. **Run database migrations**

```bash
pnpm nx run api:migrate
```

6. **Start the development servers**

In separate terminals:

```bash
# Start the API server
pnpm nx run api:serve

# Start the UI server
pnpm nx run ui:dev
```

The API will be available at `http://localhost:3000` and the UI at `http://localhost:3001`.

## Project Structure

VM-X AI is an Nx monorepo with the following main packages:

- **`packages/api`**: NestJS backend API server
- **`packages/ui`**: Next.js frontend application
- **`packages/shared`**: Shared types and utilities
- **`docs`**: Docusaurus documentation site

## Development Workflow

1. **Create a branch** from `main` for your changes
2. **Make your changes** following the code style and conventions
3. **Update documentation** if needed
4. **Submit a pull request** with a clear description of your changes

## Building

```bash
# Build all projects
pnpm nx affected:build

# Build a specific project
pnpm nx build api
pnpm nx build ui
```

## Code Style

- Follow the existing code style in the repository
- Use TypeScript for all new code
- Add JSDoc comments for public APIs
- Follow the linting rules configured in the project

## Documentation

- Update relevant documentation when adding new features
- Documentation is in the `docs` directory
- Run the docs build to verify changes:

```bash
pnpm nx run docs:build
```

## Submitting Changes

1. **Fork the repository** (if you don't have write access)
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add some amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request** with a clear description of your changes

## Questions?

- Check the [documentation](https://vm-x-ai.github.io/)
- Open an issue on GitHub
- Review existing issues and discussions

Thank you for contributing to VM-X AI! 🚀

