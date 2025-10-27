import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './storage/database.module';
import { configSchema } from './config/schema';
import { MigrationsModule } from './migrations/migrations.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { UsersModule } from './users/users.module';
import { AppLoggerModule } from './logger/logger.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configSchema,
    }),
    AppLoggerModule,
    MigrationsModule,
    DatabaseModule,
    HealthcheckModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
