import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentityProvider } from '@smithy/types';

export type AWSBedrockAIConnectionConfig = {
  iamRoleArn: string;
  region: string;
  performanceConfig?: {
    latency?: 'standard' | 'optimized';
  };
  /**
   * T21: optional Bedrock Guardrails configuration applied to every
   * inference call on this connection. `guardrailIdentifier` is the
   * guardrail ID (or its full ARN); `guardrailVersion` is `'DRAFT'` or
   * a published version string. When set, Converse paths attach
   * `guardrailConfig` to the command input; Invoke paths set
   * `X-Amzn-Bedrock-GuardrailIdentifier` / `-Version` headers.
   * `trace` defaults to `'enabled'` so the audit row sees the
   * guardrail assessments.
   */
  guardrailConfig?: {
    guardrailIdentifier: string;
    guardrailVersion: string;
    trace?: 'enabled' | 'disabled' | 'enabled_full';
  };
};

@Injectable()
export abstract class AWSBedrockBaseProvider {
  private readonly cachedProviders = new Map<
    string,
    AwsCredentialIdentityProvider
  >();

  constructor(
    protected readonly logger: PinoLogger,
    protected readonly configService: ConfigService
  ) {}

  protected async createClient(
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>
  ): Promise<BedrockRuntimeClient> {
    if (connection.config) {
      const credentials = await this.getAwsSdkCredentials(connection);
      return new BedrockRuntimeClient({
        region: connection.config.region,
        credentials,
      });
    }

    return new BedrockRuntimeClient({});
  }

  protected async getAwsSdkCredentials(
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>
  ): Promise<AwsCredentialIdentityProvider | undefined> {
    if (!connection.config) {
      return undefined;
    }

    // Cache credentials per (workspace, environment, role-ARN) tuple,
    // not just per role-ARN. Two tenants could legitimately point at
    // the same role with different ExternalIds — caching by role
    // alone risked handing tenant A's STS provider to tenant B (the
    // ExternalId field below is built from workspaceId:environmentId).
    const cacheKey = `${connection.workspaceId}:${connection.environmentId}:${connection.config.iamRoleArn}`;
    const cached = this.cachedProviders.get(cacheKey);
    if (cached) return cached;

    const credentials = fromTemporaryCredentials({
      params: {
        RoleArn: connection.config.iamRoleArn,
        RoleSessionName: 'vm-x-server-cross-account-session',
        ExternalId: `${connection.workspaceId}:${connection.environmentId}`,
      },
    });

    this.cachedProviders.set(cacheKey, credentials);

    return credentials;
  }
}
