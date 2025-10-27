import { CacheModule } from '@nestjs/cache-manager';
import { Global, Logger, Module } from '@nestjs/common';
import { RedisClient } from './redis-client';
import KeyvRedis, { Keyv } from '@keyv/redis';
import { ConfigService } from '@nestjs/config';
import { CacheableMemory } from 'cacheable';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.getOrThrow<string>('REDIS_HOST');
        const redisPort = configService.getOrThrow<number>('REDIS_PORT');
        const url = `redis://${redisHost}:${redisPort}`;
        return {
          stores: [
            // In-memory cache
            new Keyv({
              store: new CacheableMemory({ ttl: 60000, lruSize: 5000 }),
            }),
            // Redis cache
            new KeyvRedis({ url }),
          ],
        };
      },
    }),
  ],
  providers: [Logger, RedisClient],
  exports: [RedisClient],
})
export class AppCacheModule {}
