import { Strategy } from 'passport-http-bearer';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { OidcProviderService } from '../provider/oidc-provider.service';

@Injectable()
export class OidcStrategy extends PassportStrategy(Strategy, 'oidc') {
  constructor(private readonly oidcProvider: OidcProviderService) {
    super();
  }

  async validate(token: string) {
    return await this.oidcProvider.provider.AccessToken.find(token);
  }
}
