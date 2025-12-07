import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import vault from 'node-vault';
import { HashcorpEncryptionService } from './encryption.service';
import { ENCRYPTION_SERVICE } from '../encryption.service.base';

@Global()
@Module({
  imports: [],
  providers: [
    {
      provide: 'VAULT_CLIENT',
      inject: [ConfigService, PinoLogger],
      useFactory: async (configService: ConfigService, logger: PinoLogger) => {
        const client = vault({
          apiVersion: 'v1',
          endpoint: configService.getOrThrow<string>('VAULT_HASHCORP_ADDR'),
        });

        async function login() {
          logger.info('Logging in to Vault...');
          const result = await client.approleLogin({
            role_id: configService.getOrThrow<string>('VAULT_HASHCORP_APPROLE_ROLE_ID'),
            secret_id: configService.getOrThrow<string>(
              'VAULT_HASHCORP_APPROLE_SECRET_ID'
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
    {
      provide: ENCRYPTION_SERVICE,
      useClass: HashcorpEncryptionService,
    },
  ],
  exports: [ENCRYPTION_SERVICE],
})
export class HashcorpEncryptionModule {}
