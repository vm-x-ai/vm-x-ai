import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Body,
  VERSION_NEUTRAL,
  Query,
  Redirect,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { OidcProviderService } from './oidc-provider.service';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InteractionResults } from 'oidc-provider';
import { AuthService } from '../auth.service';
import { FederatedLoginService } from '../federated-login/federated-login.service';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { ConsentDto } from './dto/consent.dto';
import { Public } from '../auth.guard';

@Public()
@Controller({ path: 'interaction', version: VERSION_NEUTRAL })
export class OidcInteractionController {
  constructor(
    private readonly federatedLoginService: FederatedLoginService,
    private readonly oidc: OidcProviderService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {}

  // Step 1: render (or return data for) login/consent
  @Get(':uid')
  async showInteraction(
    @Param('uid') uid: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply
  ) {
    const details = await this.oidc.provider.interactionDetails(
      req.raw,
      res.raw
    );

    const federatedLoginUrl = this.federatedLoginService.enabled
      ? await this.federatedLoginService.getAuthorizationUrl(uid)
      : null;

    if (details.prompt.name === 'login') {
      // Show login form
      res.header('Content-Type', 'text/html').send(
        `
      <html>
        <body>
          <h2>Login required for ${details.params.client_id}</h2>
          <form method="post" action="/interaction/${uid}/login">
            <input name="username" placeholder="user" />
            <input name="password" placeholder="password" type="password" />
            <button type="submit">Login</button>
            ${
              federatedLoginUrl
                ? `<a href="${federatedLoginUrl}">SSO Login</a>`
                : ''
            }
          </form>
        </body>
      </html>
    `
      );
    } else if (details.prompt.name === 'consent') {
      // Show consent form
      res.header('Content-Type', 'text/html').send(
        `
      <html>
        <body>
          <h2>Consent required for ${details.params.client_id}</h2>
          <p>Do you want to grant access to this application?</p>
          <form method="post" action="/interaction/${uid}/consent">
            <button type="submit" name="consent" value="yes">Allow</button>
            <button type="submit" name="consent" value="no">Deny</button>
          </form>
        </body>
      </html>
    `
      );
    } else {
      res.status(400).send(`Unknown prompt: ${details.prompt.name}`);
    }
  }

  // Step 2: handle login submission
  @Post(':uid/login')
  async login(
    @Param('uid') uid: string,
    @Body() body: LoginDto,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply
  ) {
    const interactionDetails = await this.oidc.provider.interactionDetails(
      req.raw,
      res.raw
    );
    const authUser = await this.authService.validateUser(
      body.username,
      body.password
    );
    // Example: accept any credentials
    if (authUser) {
      const result: InteractionResults = {
        login: { accountId: authUser.id },
      };

      const autoConsentClientIds = this.configService
        .getOrThrow<string>('OIDC_PROVIDER_AUTO_CONSENT_CLIENT_IDS')
        .split(',');

      if (
        autoConsentClientIds.includes(
          interactionDetails.params.client_id as string
        )
      ) {
        const grant = new this.oidc.provider.Grant({
          accountId: authUser.id,
          clientId: interactionDetails.params.client_id as string,
        });

        grant.addOIDCScope(interactionDetails.params.scope as string);
        grant.addResourceScope(
          'https://vm-x.ai',
          interactionDetails.params.scope as string
        );

        const grantId = await grant.save();
        result.consent = {
          grantId,
        };
      }

      await this.oidc.provider.interactionFinished(req.raw, res.raw, result, {
        mergeWithLastSubmission: false,
      });
      return;
    }

    res.status(400).send('Invalid credentials');
  }

  // Add consent handler
  @Post(':uid/consent')
  async consent(
    @Param('uid') uid: string,
    @Body() body: ConsentDto,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply
  ) {
    const interactionDetails = await this.oidc.provider.interactionDetails(
      req.raw,
      res.raw
    );

    if (body.consent === 'yes') {
      let { grantId } = interactionDetails;
      const {
        prompt: { details },
        session,
      } = interactionDetails;

      const grant = grantId
        ? await this.oidc.provider.Grant.find(grantId)
        : new this.oidc.provider.Grant({
            accountId: session?.accountId,
            clientId: interactionDetails.params.client_id as string,
          });

      if (!grant) {
        throw new BadRequestException('Grant not found');
      }

      if (details.missingOIDCScope) {
        grant.addOIDCScope((details.missingOIDCScope as string[]).join(' '));
      }
      if (details.missingOIDCClaims) {
        grant.addOIDCClaims(details.missingOIDCClaims as string[]);
      }
      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(
          details.missingResourceScopes
        )) {
          grant.addResourceScope(indicator, scopes.join(' '));
        }
      }

      grantId = await grant.save();
      const consent: InteractionResults['consent'] = {};
      if (!interactionDetails.grantId) {
        consent.grantId = grantId;
      }

      const result = {
        consent,
      };

      await this.oidc.provider.interactionFinished(req.raw, res.raw, result, {
        mergeWithLastSubmission: false,
      });
      return;
    } else {
      // User denied consent
      const result = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };

      await this.oidc.provider.interactionFinished(req.raw, res.raw, result, {
        mergeWithLastSubmission: false,
      });
      return;
    }
  }

  @Get('federated/callback')
  @Redirect()
  async federatedCallback(
    @Req() req: FastifyRequest,
    @Query('state') state: string | undefined
  ) {
    return {
      url: `/interaction/${state}/federated?${new URLSearchParams(
        req.query as Record<string, string>
      ).toString()}`,
      statusCode: HttpStatus.FOUND,
    };
  }

  @Get(':uid/federated')
  async federatedInteraction(
    @Param('uid') uid: string,
    @Req() req: FastifyRequest<{ Querystring: { state: string | undefined } }>,
    @Res() res: FastifyReply
  ) {
    const user = await this.federatedLoginService.callback(req);
    const result = {
      login: { accountId: user.id },
    };

    await this.oidc.provider.interactionFinished(req.raw, res.raw, result, {
      mergeWithLastSubmission: false,
    });
  }
}
