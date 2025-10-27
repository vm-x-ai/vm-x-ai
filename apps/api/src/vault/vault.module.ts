import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import vault from 'node-vault';
import { EncryptionService } from './encryption.service';
import { EncryptionController } from './encryption.controller';
import { SecretService } from './secrets.service';

@Global()
@Module({
  imports: [],
  controllers: [EncryptionController],
  providers: [
    {
      provide: 'VAULT_CLIENT',
      inject: [ConfigService, PinoLogger],
      useFactory: async (configService: ConfigService, logger: PinoLogger) => {
        const client = vault({
          apiVersion: 'v1',
          endpoint: configService.getOrThrow<string>('VAULT_ADDR'),
        });

        async function login() {
          logger.info('Logging in to Vault...');
          const result = await client.approleLogin({
            role_id: configService.getOrThrow<string>('VAULT_APPROLE_ROLE_ID'),
            secret_id: configService.getOrThrow<string>(
              'VAULT_APPROLE_SECRET_ID'
            ),
          });
          logger.info('Vault token login successful');
          client.token = result.auth.client_token;
        }

        await login();

        // Renew every 45 minutes
        setInterval(async () => {
          try {
            await login();
            logger.info('Vault token renewed');
          } catch (err) {
            logger.error('Vault re-login failed', err);
          }
        }, 45 * 60 * 1000);

        return client;
      },
    },
    EncryptionService,
    SecretService,
  ],
  exports: ['VAULT_CLIENT', EncryptionService, SecretService],
})
export class VaultModule {}
