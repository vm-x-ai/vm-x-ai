import { Kysely, Migration, sql } from 'kysely';
import { PasswordService } from '../auth/password.service';
import { DB, PublicProviderType } from '../storage/entities.generated';

export const migration = (passwordService: PasswordService): Migration => ({
  async up(db: Kysely<DB>): Promise<void> {
    // Create ProviderType enum type first
    await sql`CREATE TYPE PROVIDER_TYPE AS ENUM ('LOCAL', 'OIDC')`.execute(db);

    await db.schema
      .createTable('users')
      .addColumn('id', 'uuid', (col) =>
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('first_name', 'text', (col) => col.notNull())
      .addColumn('last_name', 'text', (col) => col.notNull())
      .addColumn('username', 'text', (col) => col.notNull())
      .addColumn('email', 'text', (col) => col.notNull())
      .addColumn('email_verified', 'boolean', (col) =>
        col.notNull().defaultTo(false)
      )
      .addColumn('picture_url', 'text')
      .addColumn('provider_type', sql`PROVIDER_TYPE`, (col) => col.notNull())
      .addColumn('provider_id', 'text', (col) => col.notNull())
      .addColumn('provider_metadata', 'jsonb')
      .addColumn('password_hash', 'text')
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('created_by', 'uuid', (col) => col.references('users.id'))
      .addColumn('updated_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('updated_by', 'uuid', (col) => col.references('users.id'))
      .addUniqueConstraint('users_email_unique', ['email'])
      .addUniqueConstraint('users_username_unique', ['username'])
      .execute();

    // Add indexes for specified columns
    await db.schema
      .createIndex('idx_users_email')
      .on('users')
      .column('email')
      .execute();

    await db.schema
      .createIndex('idx_users_username')
      .on('users')
      .column('username')
      .execute();

    await db.schema
      .createIndex('idx_users_username_password_hash')
      .on('users')
      .column('username')
      .column('password_hash')
      .execute();

    await db.schema
      .createIndex('idx_users_email_password_hash')
      .on('users')
      .column('email')
      .column('password_hash')
      .execute();

    await db.schema
      .createIndex('idx_users_provider_type')
      .on('users')
      .column('provider_type')
      .execute();

    await db.schema
      .createIndex('idx_users_provider_id')
      .on('users')
      .column('provider_id')
      .execute();

    await db.schema
      .createIndex('idx_users_created_by')
      .on('users')
      .column('created_by')
      .execute();

    await db.schema
      .createIndex('idx_users_updated_by')
      .on('users')
      .column('updated_by')
      .execute();

    await db
      .insertInto('users')
      .values({
        name: 'Admin',
        firstName: 'Admin',
        lastName: 'Admin',
        username: 'admin',
        email: 'admin@example.com',
        providerType: PublicProviderType.LOCAL,
        providerId: 'local',
        emailVerified: true,
        passwordHash: await passwordService.hash('admin'),
      })
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_users_email').execute();
    await db.schema.dropIndex('idx_users_username').execute();
    await db.schema.dropIndex('idx_users_username_password_hash').execute();
    await db.schema.dropIndex('idx_users_email_password_hash').execute();
    await db.schema.dropIndex('idx_users_provider_type').execute();
    await db.schema.dropIndex('idx_users_provider_id').execute();
    await db.schema.dropTable('users').execute();
    await sql`DROP TYPE IF EXISTS PROVIDER_TYPE`.execute(db);
  },
});
