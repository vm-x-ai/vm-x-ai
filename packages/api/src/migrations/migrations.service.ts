import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Migrator } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { migration as migration01 } from './1-create-users';
import { migration as migration02 } from './2-create-oidc-provider';
import { migration as migration03 } from './3-workspace-table';
import { migration as migration04 } from './4-workspace-user-table';
import { migration as migration05 } from './5-environment-table';
import { migration as migration06 } from './6-ai-connection-table';
import { migration as migration07 } from './7-ai-resource-table';
import { migration as migration08 } from './8-pool-definition-table';
import { migration as migration09 } from './9-api-key-table';
import { migration as migration10 } from './10-completion-audit-table';
import { migration as migration11 } from './11-completion-batch-table';
import { migration as migration12 } from './12-completion-batch-item-table';
import { migration as migration13 } from './13-role-table';
import { migration as migration14 } from './14-user-role-table';
import { migration as migration15 } from './15-secrets-table';
import { PasswordService } from '../auth/password.service';
import { BaseMigrationsService, ListMigrationProvider } from './base';

@Injectable()
export class MigrationsService extends BaseMigrationsService {
  constructor(
    logger: PinoLogger,
    configService: ConfigService,
    private readonly passwordService: PasswordService
  ) {
    super(logger, configService, 'DATABASE_HOST', 'main');

    this.migrator = new Migrator({
      db: this.db.withSchema(
        configService.getOrThrow<string>('DATABASE_SCHEMA')
      ),
      provider: new ListMigrationProvider({
        '01': migration01(this.passwordService),
        '02': migration02,
        '03': migration03,
        '04': migration04,
        '05': migration05,
        '06': migration06,
        '07': migration07,
        '08': migration08,
        '09': migration09,
        '10': migration10,
        '11': migration11,
        '12': migration12,
        '13': migration13,
        '14': migration14,
        '15': migration15,
      }),
    });
  }
}
