import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { FederatedLoginService } from './federated-login/federated-login.service';
import { OidcProviderService } from './provider/oidc-provider.service';
import { OidcInteractionController } from './provider/oidc-interaction.controller';
import { APP_GUARD } from '@nestjs/core';
import { AppGuard } from './auth.guard';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        global: true,
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '60s' },
      }),
    }),
  ],
  controllers: [OidcInteractionController],
  providers: [
    AuthService,
    PasswordService,
    FederatedLoginService,
    JwtStrategy,
    OidcProviderService,
    {
      provide: APP_GUARD,
      useClass: AppGuard,
    },
  ],
  exports: [AuthService, PasswordService, OidcProviderService],
})
export class AuthModule {}
