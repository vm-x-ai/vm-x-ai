import { Global, Module } from '@nestjs/common';
import { AwsKmsEncryptionService } from './encryption.service';
import { ENCRYPTION_SERVICE } from '../encryption.service.base';

@Global()
@Module({
  imports: [],
  providers: [
    {
      provide: ENCRYPTION_SERVICE,
      useClass: AwsKmsEncryptionService,
    },
  ],
  exports: [ENCRYPTION_SERVICE],
})
export class AwsKmsEncryptionModule {}
