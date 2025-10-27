import { IsOptional, IsString } from 'class-validator';
import { EncryptionService } from './encryption.service';
import { Body, Controller, Post } from '@nestjs/common';

class EncryptBody {
  @IsString()
  plaintext: string;
  @IsOptional()
  @IsString()
  context?: string;
}

class DecryptBody {
  @IsString()
  ciphertext: string;
  @IsOptional()
  @IsString()
  context?: string;
}

@Controller('encryption')
export class EncryptionController {
  constructor(private readonly encryptionService: EncryptionService) {}

  @Post('encrypt')
  async encrypt(@Body() body: EncryptBody) {
    return this.encryptionService.encrypt(body.plaintext, body.context);
  }

  @Post('decrypt')
  async decrypt(@Body() body: DecryptBody) {
    return this.encryptionService.decrypt(body.ciphertext, body.context);
  }
}
