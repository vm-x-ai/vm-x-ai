import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';
import { RolePolicyEffect } from '../role/entities/role.entity';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('roles')
      .addColumn('role_id', 'uuid', (col) =>
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('policy', 'jsonb', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('created_by', 'uuid', (col) =>
        col.notNull().references('users.id')
      )
      .addColumn('updated_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('updated_by', 'uuid', (col) =>
        col.notNull().references('users.id')
      )
      .execute();

    await db.schema
      .createIndex('idx_roles_created_by')
      .on('roles')
      .column('created_by')
      .execute();

    await db.schema
      .createIndex('idx_roles_updated_by')
      .on('roles')
      .column('updated_by')
      .execute();

    const adminUserId = await db
      .selectFrom('users')
      .select('id')
      .where('username', '=', 'admin')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('roles')
      .values({
        name: 'admin',
        description: 'Administrator role',
        policy: JSON.stringify({
          statements: [
            {
              effect: RolePolicyEffect.ALLOW,
              actions: ['*'],
              resources: ['*'],
            },
          ],
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: adminUserId.id,
        updatedBy: adminUserId.id,
      })
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_roles_created_by').execute();
    await db.schema.dropIndex('idx_roles_updated_by').execute();
    await db.schema.dropTable('roles').execute();
  },
};
