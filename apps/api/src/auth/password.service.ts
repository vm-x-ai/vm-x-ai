import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class PasswordService {
  public async hash(password: string): Promise<string> {
    return await argon2.hash(password);
  }

  public async verify(password: string, hash: string): Promise<boolean> {
    return await argon2.verify(hash, password);
  }
}
