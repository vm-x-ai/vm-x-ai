import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cluster, RedisOptions } from 'ioredis';
import Redis from 'ioredis';

@Injectable()
export class RedisClient {
  public client: Cluster;
  public streamClient: Cluster;

  constructor(private readonly configService: ConfigService) {
    const redisOptions: RedisOptions | undefined =
      process.env.LOCAL !== 'true'
        ? {
            tls: {
              rejectUnauthorized: false,
            },
            connectTimeout: 2000,
          }
        : undefined;

    const redisClusterNodes = [
      {
        host: this.configService.getOrThrow<string>('REDIS_HOST'),
        port: this.configService.getOrThrow<number>('REDIS_PORT'),
      },
    ];

    this.client = new Redis.Cluster(redisClusterNodes, {
      redisOptions,
    });

    this.streamClient = new Redis.Cluster(redisClusterNodes, {
      redisOptions,
    });
  }
}
