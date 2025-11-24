import { LoggerErrorInterceptor, Logger as PinoLogger } from 'nestjs-pino';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { GlobalExceptionFilter } from './error';
import { OidcProviderService } from './auth/provider/oidc-provider.service';
import fastifyExpress from '@fastify/express';
import { setupOpenAPIDocumentation } from './openapi';
import { join } from 'path';
import '@fastify/view';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 100 * 1024 * 1024, // 100MB
    })
  );
  const fastify = app.getHttpAdapter().getInstance();
  // Register the plugin to allow Express-style middleware
  if (typeof fastify.use !== 'function') {
    await fastify.register(fastifyExpress);
  }

  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  app.enableCors({
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    })
  );
  app.useGlobalFilters(
    new GlobalExceptionFilter(
      app.get(HttpAdapterHost).httpAdapter,
      app.get(PinoLogger)
    )
  );

  // Configure API versioning using URI strategy
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  setupOpenAPIDocumentation(app);

  await app.init();

  const oidcProvider = app.get(OidcProviderService);
  // Mount the OIDC provider
  fastify.use('/oauth2', oidcProvider.provider.callback());

  app.useStaticAssets({
    root: join(__dirname, '..', 'assets'),
    prefix: '/assets/',
  });

  app.setViewEngine({
    engine: {
      ejs: require('ejs'),
    },
    templates: join(__dirname, '..', 'views'),
    layout: '_layout.ejs',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap();
