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
import { RESOURCE_INDICATOR } from './consts';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@Public()
@ApiTags('OIDC Interaction')
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
  @ApiOkResponse({
    description: 'Show Login/Consent Interaction HTML page',
  })
  async showInteraction(
    @Param('uid') uid: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply
  ) {
    const details = await this.oidc.provider.interactionDetails(
      req.raw,
      res.raw
    );

    const { url: federatedLoginUrl, codeVerifier } = this.federatedLoginService
      .enabled
      ? await this.federatedLoginService.getAuthorizationUrl(uid)
      : {};

    details.params.federatedLoginCodeVerifier = codeVerifier;
    await details.persist();
    const client = await this.oidc.provider.Client.find(
      details.params.client_id as string
    );

    if (details.prompt.name === 'login') {
      // Show login form
      return res.view('login.ejs', {
        uid,
        clientId: details.params.client_id,
        federatedLoginUrl,
      });
    } else if (details.prompt.name === 'consent') {
      // Show consent form
      return res.view('consent.ejs', {
        uid,
        clientId: details.params.client_id,
        clientName: client?.clientName ?? details.params.client_id,
        scopes: details.prompt.details?.missingOIDCScope || [],
      });
    } else {
      res.status(400).send(`Unknown prompt: ${details.prompt.name}`);
    }
  }

  // Step 2: handle login submission
  @Post(':uid/login')
  @ApiOkResponse({
    description: 'Handle login submission',
  })
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
          RESOURCE_INDICATOR,
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

    res.redirect(
      `/interaction/${uid}?error=invalid_credentials`,
      HttpStatus.FOUND
    );
  }

  // Add consent handler
  @Post(':uid/consent')
  @ApiOkResponse({
    description: 'Handle consent submission',
  })
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
  @ApiOkResponse({
    description:
      'Static federated callback that redirects to the UID interaction federated page',
  })
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
  @ApiOkResponse({
    description: 'Continues with the federated login process',
  })
  async federatedInteraction(
    @Param('uid') uid: string,
    @Req() req: FastifyRequest<{ Querystring: { state: string | undefined } }>,
    @Res() res: FastifyReply
  ) {
    const details = await this.oidc.provider.interactionDetails(
      req.raw,
      res.raw
    );
    const codeVerifier = details.params.federatedLoginCodeVerifier;
    if (!codeVerifier) {
      throw new BadRequestException('Code verifier is required');
    }
    const user = await this.federatedLoginService.callback(
      req,
      codeVerifier as string
    );
    const result: InteractionResults = {
      login: { accountId: user.id },
    };

    const autoConsentClientIds = this.configService
      .getOrThrow<string>('OIDC_PROVIDER_AUTO_CONSENT_CLIENT_IDS')
      .split(',');

    if (autoConsentClientIds.includes(details.params.client_id as string)) {
      const grant = new this.oidc.provider.Grant({
        accountId: user.id,
        clientId: details.params.client_id as string,
      });

      grant.addOIDCScope(details.params.scope as string);
      grant.addResourceScope(
        RESOURCE_INDICATOR,
        details.params.scope as string
      );

      const grantId = await grant.save();
      result.consent = {
        grantId,
      };
    }

    await this.oidc.provider.interactionFinished(req.raw, res.raw, result, {
      mergeWithLastSubmission: false,
    });
  }
}
