import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import _ from 'lodash';
import { PinoLogger } from 'nestjs-pino';
import { ServiceError } from './types';
import { AbstractHttpAdapter } from '@nestjs/core';
import { $enum } from 'ts-enum-util';
import { ERROR_MESSAGES, ErrorCode } from './error-code';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapter: AbstractHttpAdapter,
    private readonly logger: PinoLogger
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();

    if (exception instanceof HttpException) {
      const httpStatus = exception.getStatus();
      const httpResponse = exception?.getResponse();
      const cause =
        (exception?.cause as Error | undefined)?.stack ??
        exception?.cause ??
        exception;

      const description = (
        exception as unknown as { options?: { description?: string } }
      )?.options?.description;

      if (httpResponse instanceof ServiceError) {
        this.logger.error(httpResponse.errorMessage, { cause, description });
        this.httpAdapter.reply(ctx.getResponse(), httpResponse, httpStatus);
        return;
      }

      // Handle standard HTTP exceptions
      const responseBody: ServiceError = {
        errorCode:
          (httpStatus.toString() as ErrorCode) ??
          ErrorCode.INTERNAL_SERVER_ERROR,
        errorMessage: _.isString(httpResponse)
          ? httpResponse
          : (httpResponse as Error)?.message?.toString() ?? undefined,
      };

      this.httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
      return;
    }

    this.logger.error(
      {
        cause: (exception as Error)?.stack ?? exception,
      },
      $enum(ErrorCode).getKeyOrDefault(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Internal Server Error'
      )
    );

    const responseBody = Object.assign(
      ServiceError.fromCode(
        ErrorCode.INTERNAL_SERVER_ERROR,
        (exception as Error)?.message
      )
    );

    this.httpAdapter.reply(
      ctx.getResponse(),
      responseBody,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

export function throwServiceError(
  statusCode: HttpStatus,
  errorCode: ErrorCode,
  errorArgs: Record<string, unknown> = {},
  details: Record<string, unknown> = {},
  error?: Error,
): never {
  const errorMessage = _.template(ERROR_MESSAGES[errorCode])(errorArgs);
  throw new HttpException(
    new ServiceError({
      errorCode,
      errorMessage,
      details: { cause: error, ...details },
    }),
    statusCode
  );
}
