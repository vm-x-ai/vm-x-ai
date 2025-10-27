import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.usersService.getByUsername(username);
    if (!user || !user.passwordHash) {
      return null;
    }

    const valid = await this.passwordService.verify(
      password,
      user.passwordHash
    );
    return valid ? user : null;
  }
}
