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
git clone https://github.com/vm-x-ai/vm-x-ai.git
cd vm-x-ai
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

## Updating UI Client Types

When you make changes to the API (e.g., adding new endpoints, modifying request/response schemas), you need to regenerate the TypeScript client types used by the UI.

1. **Ensure the API server is running** (it must be accessible at `http://localhost:3000`)

2. **Generate the client types**:

```bash
pnpm nx run ui:gen-client
```

This command reads the OpenAPI/Swagger specification from `http://localhost:3000/docs-json` and generates TypeScript client code in `packages/ui/src/clients/api`.

The configuration for this process is in `packages/ui/openapi-ts.api.config.ts`.

## Database Types and Migrations

### Generating Database Types

After making database schema changes (via migrations), you should regenerate the TypeScript database types to reflect the new schema.

1. **Ensure the database is running and migrations are up to date**

2. **Generate the database types**:

```bash
pnpm nx run api:codegen
```

This command uses `kysely-codegen` to introspect your PostgreSQL database and generate TypeScript types in `packages/api/src/storage/entities.generated.ts`.

The configuration for this process is in `packages/api/.kysely-codegenrc.ts`.

### Adding a Migration

When you need to modify the database schema, you should create a new migration file:

1. **Create a new migration file** in `packages/api/src/migrations/`

   The file should be named with a sequential number followed by a descriptive name, for example:

   - `16-add-user-preferences-table.ts`
   - `17-update-workspace-schema.ts`

2. **Define the migration** with `up` and `down` methods:

```typescript
import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    // Define the schema changes here
    await db.schema
      .createTable('user_preferences')
      .addColumn('preference_id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
      .addColumn('key', 'text', (col) => col.notNull())
      .addColumn('value', 'text')
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .execute();

    // Add indexes if needed
    await db.schema.createIndex('idx_user_preferences_user_id').on('user_preferences').column('user_id').execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Define how to rollback the migration
    await db.schema.dropIndex('idx_user_preferences_user_id').execute();
    await db.schema.dropTable('user_preferences').execute();
  },
};
```

3. **Register the migration** in `packages/api/src/migrations/migrations.service.ts`:

   Add an import at the top:

   ```typescript
   import { migration as migration16 } from './16-add-user-preferences-table';
   ```

   Add the migration to the `ListMigrationProvider` object:

   ```typescript
   provider: new ListMigrationProvider({
     // ... existing migrations ...
     '15': migration15,
     '16': migration16,  // Add your new migration here
   }),
   ```

4. **Run the migration**:

```bash
pnpm nx run api:migrate
```

5. **Regenerate database types** (as described above):

```bash
pnpm nx run api:codegen
```

**Note**: Migration numbers should be sequential and match the order in which they should be applied. Always test migrations in a local environment before committing.

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
