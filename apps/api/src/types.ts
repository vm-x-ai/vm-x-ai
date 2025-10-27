import { ApiProperty } from '@nestjs/swagger';
import { $enum } from 'ts-enum-util';

export enum ErrorCode {
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  OIDC_NOT_CONFIGURED = 'OIDC_NOT_CONFIGURED',
  OIDC_RESPONSE_ERROR = 'OIDC_RESPONSE_ERROR',
}

export const errorCode = $enum(ErrorCode).getKeys();

export class ServiceError {
  @ApiProperty({
    description: 'The error message',
    example: 'The error message',
  })
  errorMessage: string;

  @ApiProperty({
    enum: errorCode,
    enumName: 'ErrorCode',
    description: 'The error code',
    example: ErrorCode.OIDC_NOT_CONFIGURED,
  })
  errorCode: ErrorCode;

  @ApiProperty({
    description: 'The error details',
    example: {
      details: 'The error details',
    },
  })
  details?: Record<string, unknown>;

  constructor(data: ServiceError) {
    this.errorMessage = data.errorMessage;
    this.errorCode = data.errorCode;
    this.details = data.details;
  }

  static fromCode(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>
  ) {
    return new ServiceError({
      errorCode: $enum(ErrorCode).getKeyOrThrow(code) as ErrorCode,
      errorMessage: message ?? code,
      details,
    });
  }
}
