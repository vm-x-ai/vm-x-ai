import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configSchema } from './config/schema';
import { MigrationsModule } from './migrations/migrations.module';
import { MigrationsService } from './migrations/migrations.service';
import { AppLoggerModule } from './logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configSchema,
    }),
    AppLoggerModule,
    MigrationsModule,
  ],
})
class MigrationModule {}

async function runMigration() {
  const app = await NestFactory.createApplicationContext(MigrationModule);
  const migrationsService = app.get(MigrationsService);

  const args = process.argv.slice(2);

  try {
    if (args.includes('--reset')) {
      console.log('Resetting database migrations...');
      await migrationsService.resetMigrations();
      console.log('Migration reset completed successfully');
    } else {
      console.log('Running database migrations...');
      await migrationsService.migrate();
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
