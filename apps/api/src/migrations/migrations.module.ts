import { Module } from '@nestjs/common';
import { MigrationsService } from './migrations.service';
import { PasswordService } from '../auth/password.service';

@Module({
  imports: [],
  providers: [MigrationsService, PasswordService],
  exports: [MigrationsService],
})
export class MigrationsModule {}
