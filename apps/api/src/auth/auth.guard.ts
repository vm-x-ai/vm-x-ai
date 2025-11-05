import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { PassportResult } from './strategies/oidc.strategy';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IGNORE_GLOBAL_GUARD_KEY = 'ignoreGlobalGuard';
export const IgnoreGlobalGuard = () =>
  SetMetadata(IGNORE_GLOBAL_GUARD_KEY, true);

export const AuthenticatedUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return (request.user as PassportResult)?.user;
  }
);

@Injectable()
export class GlobalGuard extends AuthGuard('oidc') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const ignoreGlobalGuard = this.reflector.getAllAndOverride<boolean>(
      IGNORE_GLOBAL_GUARD_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (ignoreGlobalGuard || isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}

@Injectable()
export class AppGuard extends AuthGuard('oidc') {}
