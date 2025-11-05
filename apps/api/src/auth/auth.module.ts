import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { UsersModule } from '../users/users.module';
import { OidcStrategy } from './strategies/oidc.strategy';
import { FederatedLoginService } from './federated-login/federated-login.service';
import { OidcProviderService } from './provider/oidc-provider.service';
import { OidcInteractionController } from './provider/oidc-interaction.controller';
import { APP_GUARD } from '@nestjs/core';
import { AppGuard, GlobalGuard } from './auth.guard';
import { VaultModule } from '../vault/vault.module';

@Module({
  imports: [
    UsersModule,
    VaultModule,
  ],
  controllers: [OidcInteractionController],
  providers: [
    AuthService,
    PasswordService,
    FederatedLoginService,
    OidcStrategy,
    OidcProviderService,
    AppGuard,
    {
      provide: APP_GUARD,
      useClass: GlobalGuard,
    },
  ],
  exports: [AuthService, PasswordService, OidcProviderService],
})
export class AuthModule {}
