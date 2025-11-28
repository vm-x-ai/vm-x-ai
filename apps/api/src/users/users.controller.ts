import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserEntity } from './entities/user.entity';
import { ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ServiceError } from '../types';
import { RoleGuard } from '../role/role.guard';
import { USER_BASE_RESOURCE, UserActions } from './permissions/actions';

@Controller('user')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(RoleGuard(UserActions.LIST, USER_BASE_RESOURCE))
  @ApiOperation({
    operationId: 'getUsers',
    summary: 'List all users',
    description: 'Returns a list of all users.',
  })
  @ApiOkResponse({
    type: UserEntity,
    isArray: true,
    description: 'List all users',
  })
  public async getAll(): Promise<UserEntity[]> {
    return this.usersService.getAll();
  }
}
