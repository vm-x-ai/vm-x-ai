/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  IpAddresses,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
} from 'aws-cdk-lib/aws-rds';
import { Key } from 'aws-cdk-lib/aws-kms';
import { CfnServerlessCache } from 'aws-cdk-lib/aws-elasticache';
import {
  AwsLogDriver,
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  Secret as ECSSecret,
  ContainerDependencyCondition,
} from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  Protocol,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as fs from 'node:fs';

export class ECSStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'VPC', {
      vpcName: 'vm-x-ai-example-vpc',
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    const database = new DatabaseCluster(this, 'Database', {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_17_6,
      }),
      vpc,
      clusterIdentifier: 'vm-x-ai-rds-cluster',
      vpcSubnets: {
        // Production: Deploy on a private subnet
        subnetType: SubnetType.PUBLIC,
      },
      writer: ClusterInstance.provisioned('writer', {
        publiclyAccessible: true,
        instanceType: InstanceType.of(
          InstanceClass.BURSTABLE3,
          InstanceSize.MEDIUM
        ),
      }),
      credentials: Credentials.fromGeneratedSecret('vmxai', {
        secretName: 'vm-x-ai-database-secret',
      }),
      defaultDatabaseName: 'vmxai',
    });

    const encryptionKey = new Key(this, 'EncryptionKey', {
      alias: 'alias/vm-x-ai-encryption-key',
      description: 'Encryption key for vm-x-ai',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const redisSecurityGroup = new SecurityGroup(
      this,
      'ElastiCacheSecurityGroup',
      {
        vpc,
        allowAllOutbound: true,
        description: 'ElastiCache Security Group',
        securityGroupName: 'vm-x-ai-elasti-cache-security-group',
      }
    );

    const redisCluster = new CfnServerlessCache(this, 'ServerlessCache', {
      engine: 'valkey',
      serverlessCacheName: 'vm-x-ai-valkey-serverless-cache',
      securityGroupIds: [redisSecurityGroup.securityGroupId],
      // Production: Deploy on a private subnet
      subnetIds: vpc.publicSubnets.map((subnet) => subnet.subnetId),
      majorEngineVersion: '7',
    });

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: 'vm-x-ai-cluster',
      vpc,
    });

    const apiLoadBalancer = new ApplicationLoadBalancer(
      this,
      'API/LoadBalancer',
      {
        vpc,
        loadBalancerName: 'vm-x-ai-api',
        internetFacing: true,
        vpcSubnets: {
          // Production: Deploy on a private subnet
          subnetType: SubnetType.PUBLIC,
        },
        http2Enabled: true,
      }
    );

    const uiLoadBalancer = new ApplicationLoadBalancer(
      this,
      'UI/LoadBalancer',
      {
        vpc,
        loadBalancerName: 'vm-x-ai-ui',
        internetFacing: true,
        vpcSubnets: {
          // Production: Deploy on a private subnet
          subnetType: SubnetType.PUBLIC,
        },
        http2Enabled: true,
      }
    );

    const apiTaskDefinition = new FargateTaskDefinition(this, 'API/TaskDef', {
      memoryLimitMiB: 1024,
      cpu: 512,
      family: 'vm-x-ai-api-task-definition',
    });

    const uiTaskDefinition = new FargateTaskDefinition(this, 'UI/TaskDef', {
      memoryLimitMiB: 1024,
      cpu: 512,
      family: 'vm-x-ai-ui-task-definition',
    });

    const apiLogGroup = new LogGroup(this, 'API/LogGroup', {
      logGroupName: '/aws/ecs/vm-x-ai-api',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: RetentionDays.TWO_WEEKS,
    });

    const uiLogGroup = new LogGroup(this, 'UI/LogGroup', {
      logGroupName: '/aws/ecs/vm-x-ai-ui',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: RetentionDays.TWO_WEEKS,
    });

    const collectorLogGroup = new LogGroup(this, 'Collector/LogGroup', {
      logGroupName: '/aws/ecs/vm-x-ai-collector',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: RetentionDays.TWO_WEEKS,
    });

    const uiAuthSecret = new Secret(this, 'UI/AuthSecret', {
      secretName: 'vm-x-ai-ui-auth-secret',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'auth-secret',
        passwordLength: 32,
      },
    });

    const otelConfig = new StringParameter(this, 'OtelConfigParameter', {
      parameterName: 'vm-x-ai-otel-config',
      description: 'OpenTelemetry Collector Config',
      stringValue: fs.readFileSync('ecs-otel-config.yaml', 'utf8'),
    });

    const otelPolicy = new Policy(this, 'OtelPolicy', {
      statements: [
        new PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          effect: Effect.ALLOW,
          resources: ['*'],
        }),
        new PolicyStatement({
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
            'xray:GetSamplingStatisticSummaries',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:CreateLogGroup',
            'logs:DescribeLogStreams',
            'logs:DescribeLogGroups',
          ],
          resources: ['*'],
        }),
      ],
    });

    const otelContainerConfig = {
      containerName: 'otel-collector',
      image: ContainerImage.fromRegistry('amazon/aws-otel-collector'),
      cpu: 256,
      memoryLimitMiB: 512,
      secrets: {
        AOT_CONFIG_CONTENT: ECSSecret.fromSsmParameter(otelConfig),
      },
      healthCheck: {
        command: ['CMD', '/healthcheck'],
        interval: cdk.Duration.seconds(6),
        retries: 5,
        timeout: cdk.Duration.seconds(5),
        startPeriod: cdk.Duration.seconds(1),
      },
      logging: new AwsLogDriver({
        logGroup: collectorLogGroup,
        streamPrefix: 'api',
      }),
    };

    const apiOtelCollector = apiTaskDefinition.addContainer(
      'API/OtelCollector',
      otelContainerConfig
    );

    const uiOtelCollector = uiTaskDefinition.addContainer(
      'UI/OtelCollector',
      otelContainerConfig
    );

    const uiContainer = uiTaskDefinition.addContainer('UI/Container', {
      image: ContainerImage.fromRegistry('vmxai/ui:latest'),
      portMappings: [{ containerPort: 3001 }],
      containerName: 'ui',
      environment: {
        // Production: Use a custom domain name for the UI
        AUTH_URL: `http://${uiLoadBalancer.loadBalancerDnsName}`,
        // Production: Use a custom domain name for the API
        AUTH_OIDC_ISSUER: `http://${apiLoadBalancer.loadBalancerDnsName}/oauth2`,
        AUTH_OIDC_CLIENT_ID: 'ui',
        AUTH_OIDC_CLIENT_SECRET: 'ui',
        AUTH_REDIRECT_PROXY_URL: `http://${uiLoadBalancer.loadBalancerDnsName}/api/auth`,
        API_BASE_URL: `http://${apiLoadBalancer.loadBalancerDnsName}`,
      },
      secrets: {
        AUTH_SECRET: ECSSecret.fromSecretsManager(uiAuthSecret, 'auth-secret'),
      },
      logging: new AwsLogDriver({
        logGroup: uiLogGroup,
        streamPrefix: 'ecs',
      }),
    });

    uiContainer.addContainerDependencies({
      container: uiOtelCollector,
      condition: ContainerDependencyCondition.START,
    });

    uiTaskDefinition.taskRole.attachInlinePolicy(otelPolicy);

    apiTaskDefinition
      .addContainer('API/Container', {
        image: ContainerImage.fromRegistry('vmxai/api:latest'),
        portMappings: [{ containerPort: 3000 }],
        containerName: 'api',
        environment: {
          LOG_LEVEL: 'info',
          NODE_ENV: 'production',
          PORT: '3000',
          // Production: Use a custom domain name for the API
          BASE_URL: `http://${apiLoadBalancer.loadBalancerDnsName}`,
          // Production: Use a custom domain name for the UI
          UI_BASE_URL: `http://${uiLoadBalancer.loadBalancerDnsName}`,
          DATABASE_RO_HOST: database.clusterReadEndpoint.hostname,
          DATABASE_SSL: 'true',
          REDIS_HOST: redisCluster.attrEndpointAddress,
          REDIS_PORT: redisCluster.attrEndpointPort,
          REDIS_MODE: 'cluster',
          REDIS_TLS: 'true',
          ENCRYPTION_PROVIDER: 'aws-kms',
          AWS_KMS_KEY_ID: encryptionKey.keyArn,

          OTEL_ENABLED: 'true',
          OTEL_LOG_LEVEL: 'error',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        },
        secrets: {
          DATABASE_HOST: ECSSecret.fromSecretsManager(database.secret!, 'host'),
          DATABASE_PORT: ECSSecret.fromSecretsManager(database.secret!, 'port'),
          DATABASE_DB_NAME: ECSSecret.fromSecretsManager(
            database.secret!,
            'dbname'
          ),
          DATABASE_USER: ECSSecret.fromSecretsManager(
            database.secret!,
            'username'
          ),
          DATABASE_PASSWORD: ECSSecret.fromSecretsManager(
            database.secret!,
            'password'
          ),
        },
        logging: new AwsLogDriver({
          logGroup: apiLogGroup,
          streamPrefix: 'ecs',
        }),
      })
      .addContainerDependencies({
        container: apiOtelCollector,
        condition: ContainerDependencyCondition.START,
      });

    apiTaskDefinition.taskRole.attachInlinePolicy(otelPolicy);

    const apiService = new FargateService(this, 'API/Service', {
      cluster,
      serviceName: 'vm-x-ai-api',
      enableExecuteCommand: true,
      desiredCount: 1,
      vpcSubnets: {
        // Production: Deploy on a private subnet
        subnetType: SubnetType.PUBLIC,
      },
      taskDefinition: apiTaskDefinition,
      // Production: Disable public IP assignment
      assignPublicIp: true,
    });

    const uiService = new FargateService(this, 'UI/Service', {
      cluster,
      serviceName: 'vm-x-ai-ui',
      enableExecuteCommand: true,
      desiredCount: 1,
      vpcSubnets: {
        // Production: Deploy on a private subnet
        subnetType: SubnetType.PUBLIC,
      },
      taskDefinition: uiTaskDefinition,
      // Production: Disable public IP assignment
      assignPublicIp: true,
    });

    const apiListener = apiLoadBalancer.addListener('API/HTTP', {
      protocol: ApplicationProtocol.HTTP,
      port: 80,
    });

    const uiListener = uiLoadBalancer.addListener('UI/HTTP', {
      protocol: ApplicationProtocol.HTTP,
      port: 80,
    });

    apiListener.addTargets('API/Target', {
      targetGroupName: 'vm-x-ai-api-target-group',
      port: 3000,
      targets: [
        apiService.loadBalancerTarget({
          containerName: 'api',
          containerPort: 3000,
        }),
      ],
      protocol: ApplicationProtocol.HTTP,
      deregistrationDelay: cdk.Duration.seconds(15),
      healthCheck: {
        path: '/healthcheck',
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: '200',
        port: '3000',
        protocol: Protocol.HTTP,
      },
    });

    uiListener.addTargets('UI/Target', {
      targetGroupName: 'vm-x-ai-ui-target-group',
      port: 3001,
      targets: [
        uiService.loadBalancerTarget({
          containerName: 'ui',
          containerPort: 3001,
        }),
      ],
      protocol: ApplicationProtocol.HTTP,
      deregistrationDelay: cdk.Duration.seconds(15),
      healthCheck: {
        path: '/api/healthcheck',
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: '200',
        port: '3001',
        protocol: Protocol.HTTP,
      },
    });

    // Allow the API service to connect to the Redis and database
    apiService.connections.allowTo(redisSecurityGroup, Port.tcp(6379));
    // Allow the API service to connect to the database
    apiService.connections.allowTo(database.connections, Port.tcp(5432));

    encryptionKey.grantEncryptDecrypt(apiTaskDefinition.taskRole);

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: apiLoadBalancer.loadBalancerDnsName,
      description: 'API URL',
    });

    new cdk.CfnOutput(this, 'UiUrl', {
      value: uiLoadBalancer.loadBalancerDnsName,
      description: 'UI URL',
    });
  }
}
