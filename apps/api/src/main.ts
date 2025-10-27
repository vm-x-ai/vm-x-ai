import { LoggerErrorInterceptor, Logger as PinoLogger } from 'nestjs-pino';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { GlobalExceptionFilter } from './error';
import { OidcProviderService } from './auth/provider/oidc-provider.service';
import fastifyExpress from '@fastify/express';
import { join } from 'path';

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
    console.log('Registering fastifyExpress');
    await fastify.register(fastifyExpress);
  }

  const oidcProvider = app.get(OidcProviderService);

  // Mount the OIDC provider
  fastify.use('/oauth2', oidcProvider.provider.callback());

  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  app.enableCors();
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

  app.useStaticAssets({
    root: join(__dirname, 'public'),
    prefix: '/public/',
  });
  app.setViewEngine({
    engine: {
      handlebars: require('handlebars'),
    },
    templates: join(__dirname, 'views'),
  });

  // Configure API versioning using URI strategy
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const config = new DocumentBuilder()
    .setTitle('VM-X AI API')
    .setDescription('VM-X AI API')
    .setVersion('1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap();
