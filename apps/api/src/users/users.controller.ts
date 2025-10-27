import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import { ApiOkResponse } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('local'))
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOkResponse({
    type: UserEntity,
    isArray: true,
    description: 'List all users',
  })
  public async getAll(): Promise<UserEntity[]> {
    return this.usersService.getAll();
  }
}
