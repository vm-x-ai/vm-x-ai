import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtPayloadDto } from '../dto/jwt-payload.dto';
import * as jwksRsa from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'oidc') {
  constructor(configService: ConfigService) {
    const issuer = configService.getOrThrow<string>('OIDC_PROVIDER_ISSUER');
    const jwksUri = `${issuer}/jwks`;

    super({
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri,
      }),

      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtPayloadDto) {
    return payload;
  }
}
