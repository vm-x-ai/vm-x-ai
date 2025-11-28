import { Module } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { EnvironmentController } from './environment.controller';
import { WorkspaceModule } from '../workspace/workspace.module';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [WorkspaceModule, RoleModule],
  controllers: [EnvironmentController],
  providers: [EnvironmentService],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
