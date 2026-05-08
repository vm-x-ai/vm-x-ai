import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis-client';
import KeyvRedis, { createCluster } from '@keyv/redis';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.getOrThrow<string>('REDIS_HOST');
        const redisPort = configService.getOrThrow<number>('REDIS_PORT');
        const redisMode = configService.getOrThrow<'single' | 'cluster'>(
          'REDIS_MODE'
        );
        const url = `redis://${redisHost}:${redisPort}`;

        if (redisMode === 'cluster') {
          const cluster = createCluster({ rootNodes: [{ url }] });
          return { stores: [new KeyvRedis(cluster)] };
        } else if (redisMode === 'single') {
          return { stores: [new KeyvRedis(url)] };
        }

        throw new Error(`Invalid Redis mode: ${redisMode}`);
      },
    }),
  ],
  providers: [RedisClient],
  exports: [RedisClient],
})
export class AppCacheModule {}
