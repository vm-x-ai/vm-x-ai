import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import PinoHttp from 'pino';
import { FastifyRequest } from 'fastify';
import _ from 'lodash';

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ConfigModule.envVariablesLoaded;
        return {
          pinoHttp: {
            transport:
              config.get('NODE_ENV') !== 'production' &&
              config.get('NODE_ENV') !== 'development'
                ? {
                    target: 'pino-pretty',
                    options: {
                      colorize: true,
                      ignore: 'pid,hostname',
                      messageFormat:
                        '{if req.method}[{req.method} - {req.url} - {res.statusCode}] {end}{msg}',
                    },
                  }
                : (undefined as unknown as PinoHttp.TransportSingleOptions),
            quietReqLogger: false,
            quietResLogger: false,
            serializers: {
              req: (req) => _.omit(req, ['headers']),
            },
            autoLogging: {
              ignore: (req) => {
                const href =
                  (req as unknown as FastifyRequest).originalUrl ?? req.url;
                return href.startsWith('/healthcheck');
              },
            },
            formatters: {
              level: (label) => {
                return { level: label };
              },
              messageKey: 'message',
            },
            useLevel: 'info',
            level: config.get('LOG_LEVEL') ?? 'info',
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
