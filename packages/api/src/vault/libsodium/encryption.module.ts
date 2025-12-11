import { Global, Module } from '@nestjs/common';
import { LibsodiumEncryptionService } from './encryption.service';
import { ENCRYPTION_SERVICE } from '../encryption.service.base';

@Global()
@Module({
  imports: [],
  providers: [
    {
      provide: ENCRYPTION_SERVICE,
      useClass: LibsodiumEncryptionService,
    },
  ],
  exports: [ENCRYPTION_SERVICE],
})
export class LibsodiumEncryptionModule {}
