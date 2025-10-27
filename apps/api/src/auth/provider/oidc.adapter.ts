import { DatabaseService } from '../../storage/database.service';
import { Adapter, AdapterPayload } from 'oidc-provider';

export class KyselyAdapter implements Adapter {
  constructor(public modelName: string, public db: DatabaseService) {}

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number
  ): Promise<void> {
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null;
    const grantId = payload.grantId || null;

    await this.db.writer
      .insertInto('oidcProvider')
      .values({
        id,
        payload: JSON.stringify(payload),
        grantId,
        expiresAt,
        uid: payload.uid || null,
        userCode: payload.userCode || null,
        consumed: false,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          payload: JSON.stringify(payload),
          grantId,
          expiresAt,
        })
      )
      .execute();
  }

  async find(id: string): Promise<void | AdapterPayload> {
    const row = await this.db.reader
      .selectFrom('oidcProvider')
      .select(['payload', 'expiresAt'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      await this.destroy(id);
      return undefined;
    }
    return row.payload as AdapterPayload;
  }

  async findByUserCode(userCode: string): Promise<void | AdapterPayload> {
    const row = await this.db.reader
      .selectFrom('oidcProvider')
      .select(['payload', 'expiresAt', 'id'])
      .where('userCode', '=', userCode)
      .executeTakeFirst();

    if (!row) return undefined;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      await this.destroy(row.id);
      return undefined;
    }
    return row.payload as AdapterPayload;
  }

  async findByUid(uid: string): Promise<void | AdapterPayload> {
    const row = await this.db.reader
      .selectFrom('oidcProvider')
      .select(['payload', 'expiresAt', 'id'])
      .where('uid', '=', uid)
      .executeTakeFirst();
    if (!row) return undefined;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      await this.destroy(row.id);
      return undefined;
    }

    return row.payload as AdapterPayload;
  }

  async consume(id: string): Promise<void> {
    await this.db.writer
      .updateTable('oidcProvider')
      .set({ consumed: true })
      .where('id', '=', id)
      .execute();
  }

  async destroy(id: string): Promise<void> {
    await this.db.writer
      .deleteFrom('oidcProvider')
      .where('id', '=', id)
      .execute();
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.db.writer
      .deleteFrom('oidcProvider')
      .where('grantId', '=', grantId)
      .execute();
  }
}
