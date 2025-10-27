import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MigrationsModule } from '../migrations/migrations.module';

@Global()
@Module({
  imports: [MigrationsModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
