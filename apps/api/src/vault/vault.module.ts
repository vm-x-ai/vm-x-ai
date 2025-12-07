import { Global, Module } from '@nestjs/common';
import { SecretService } from './secrets.service';
import { HashcorpEncryptionModule } from './hashcorp/encryption.module';
import { ConditionalModule } from '@nestjs/config';
import { AwsKmsEncryptionModule } from './aws-kms/encryption.module';

@Global()
@Module({
  imports: [
    ConditionalModule.registerWhen(
      HashcorpEncryptionModule,
      (env: NodeJS.ProcessEnv) => env.VAULT_ENCRYPTION_SERVICE === 'hashcorp'
    ),
    ConditionalModule.registerWhen(
      AwsKmsEncryptionModule,
      (env: NodeJS.ProcessEnv) => env.VAULT_ENCRYPTION_SERVICE === 'aws-kms'
    ),
  ],
  providers: [SecretService],
  exports: [SecretService],
})
export class VaultModule {}
