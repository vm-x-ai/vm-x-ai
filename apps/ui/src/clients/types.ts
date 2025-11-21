import { ServiceError } from './api';

export type ApiResponse<T> =
  | (
      | {
          data: T;
          error: undefined;
        }
      | {
          data: undefined;
          error: ServiceError;
        }
    )
  | {
      data: T;
    };
