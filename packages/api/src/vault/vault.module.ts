import { Global, Module } from '@nestjs/common';
import { SecretService } from './secrets.service';
import { LibsodiumEncryptionModule } from './libsodium/encryption.module';
import { ConditionalModule } from '@nestjs/config';
import { AwsKmsEncryptionModule } from './aws-kms/encryption.module';

@Global()
@Module({
  imports: [
    ConditionalModule.registerWhen(
      LibsodiumEncryptionModule,
      (env: NodeJS.ProcessEnv) => env.ENCRYPTION_PROVIDER === 'libsodium'
    ),
    ConditionalModule.registerWhen(
      AwsKmsEncryptionModule,
      (env: NodeJS.ProcessEnv) => env.ENCRYPTION_PROVIDER === 'aws-kms'
    ),
  ],
  providers: [SecretService],
  exports: [SecretService],
})
export class VaultModule {}
