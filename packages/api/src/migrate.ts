import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configSchema } from './config/schema';
import { MigrationsModule } from './migrations/migrations.module';
import { MigrationsService } from './migrations/migrations.service';
import { AppLoggerModule } from './logger/logger.module';
import { QuestDBMigrationsModule } from './completion/usage/questdb/migrations/migrations.module';
import { QuestDBMigrationsService } from './completion/usage/questdb/migrations/migrations.service';
import { AWSTimestreamMigrationsModule } from './completion/usage/aws-timestream/migrations/migrations.module';
import { AWSTimestreamMigrationsService } from './completion/usage/aws-timestream/migrations/migrations.service';
import { BaseMigrationsService } from './migrations/base';

const baseImports = [
  ConfigModule.forRoot({
    isGlobal: true,
    validationSchema: configSchema,
  }),
  AppLoggerModule,
  MigrationsModule,
];

@Module({
  imports: [...baseImports],
})
class DBMigrationModule {}

@Module({
  imports: [...baseImports, QuestDBMigrationsModule],
})
class QuestDBMigrationModule {}

@Module({
  imports: [...baseImports, AWSTimestreamMigrationsModule],
})
class AWSTimestreamMigrationModule {}

async function runMigration() {
  let app: INestApplicationContext;
  const argv = await yargs(hideBin(process.argv))
    .option('reset', {
      type: 'boolean',
      description: 'Reset the database migrations',
    })
    .option('type', {
      type: 'string',
      choices: ['app', 'questdb', 'aws-timestream'],
      description: 'Run migrations for App, QuestDB or AWS Timestream',
      default: 'app',
    })
    .option('target', {
      type: 'string',
      description: 'Target migration to reset to (e.g. 01, 02, 03, etc.)',
    })
    .parse();

  let migrator: BaseMigrationsService;
  switch (argv.type) {
    case 'app': {
      app = await NestFactory.createApplicationContext(DBMigrationModule);
      migrator = app.get(MigrationsService);
      break;
    }
    case 'questdb': {
      app = await NestFactory.createApplicationContext(QuestDBMigrationModule);
      migrator = app.get(QuestDBMigrationsService);
      break;
    }
    case 'aws-timestream': {
      app = await NestFactory.createApplicationContext(
        AWSTimestreamMigrationModule
      );
      migrator = app.get(AWSTimestreamMigrationsService);
      break;
    }
    default:
      throw new Error(`Invalid migration type: ${argv.type}`);
  }

  try {
    if (argv.reset) {
      console.log('Resetting database migrations...');
      await migrator.resetMigrations(argv.target);
      console.log('Migration reset completed successfully');
    } else {
      console.log('Running database migrations...');
      await migrator.migrate();
      console.log('Migration completed successfully');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

runMigration().catch(console.error);
