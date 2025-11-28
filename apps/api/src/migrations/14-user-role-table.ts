import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('user_roles')
      .addColumn('user_id', 'uuid', (col) =>
        col.notNull().references('users.id').onDelete('cascade')
      )
      .addColumn('role_id', 'uuid', (col) =>
        col.notNull().references('roles.role_id').onDelete('cascade')
      )
      .addColumn('assigned_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('assigned_by', 'uuid', (col) =>
        col.notNull().references('users.id')
      )
      .addPrimaryKeyConstraint('pk_user_roles', ['user_id', 'role_id'])
      .execute();

    await db.schema
      .createIndex('idx_user_roles_assigned_by')
      .on('user_roles')
      .column('assigned_by')
      .execute();

    await db.schema
      .createIndex('idx_user_roles_user_id')
      .on('user_roles')
      .column('user_id')
      .execute();

    const adminUserId = await db
      .selectFrom('users')
      .select('id')
      .where('username', '=', 'admin')
      .executeTakeFirstOrThrow();

    const adminRoleId = await db
      .selectFrom('roles')
      .select('roleId')
      .where('name', '=', 'admin')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('userRoles')
      .values({
        roleId: adminRoleId.roleId,
        userId: adminUserId.id,
        assignedBy: adminUserId.id,
        assignedAt: new Date(),
      })
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_user_roles_assigned_by').execute();
    await db.schema.dropIndex('idx_user_roles_user_id').execute();
    await db.schema.dropTable('user_roles').execute();
  },
};
