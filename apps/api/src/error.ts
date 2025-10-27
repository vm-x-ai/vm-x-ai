import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import _ from 'lodash';
import { PinoLogger } from 'nestjs-pino';
import { ErrorCode, ServiceError } from './types';
import { AbstractHttpAdapter } from '@nestjs/core';
import { $enum } from 'ts-enum-util';

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
      $enum(ErrorCode).getKeyOrDefault(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Internal Server Error'
      ),
      {
        cause: (exception as Error)?.stack ?? exception,
      }
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
  errorMessage: string,
  error?: Error
): never {
  throw new HttpException(
    new ServiceError({ errorCode, errorMessage, details: { cause: error } }),
    statusCode
  );
}
