import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as blueprints from '@aws-quickstart/eks-blueprints';
import {
  HelmChart,
  KubernetesManifest,
  KubernetesObjectValue,
  KubernetesVersion,
} from 'aws-cdk-lib/aws-eks';
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
import { CfnDatabase } from 'aws-cdk-lib/aws-timestream';
import * as iam from 'aws-cdk-lib/aws-iam';

blueprints.HelmAddOn.validateHelmVersions = true;

export class EKSStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'VPC', {
      vpcName: 'vm-x-ai-example-vpc',
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
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

    const addOns: blueprints.ClusterAddOn[] = [
      new blueprints.addons.MetricsServerAddOn(),
      new blueprints.addons.AwsLoadBalancerControllerAddOn(),
      new blueprints.addons.VpcCniAddOn(),
      new blueprints.addons.CoreDnsAddOn(),
      new blueprints.addons.KubeProxyAddOn(),
      new blueprints.addons.IstioBaseAddOn(),
      new blueprints.addons.IstioControlPlaneAddOn({
        values: {
          meshConfig: {
            enableTracing: true,

            defaultProviders: {
              tracing: ['otel'],
            },

            extensionProviders: [
              {
                name: 'otel',
                opentelemetry: {
                  service: 'vm-x-ai-otel-collector.vm-x-ai.svc.cluster.local',
                  port: 4317, // OTLP gRPC
                },
              },
            ],

            // Ensure trace context headers are preserved
            defaultConfig: {
              tracing: {
                sampling: 100,
              },
              proxyMetadata: {
                ISTIO_META_DNS_CAPTURE: 'true',
              },
            },
            // Enable access logging for debugging
            accessLogFile: '/dev/stdout',
            accessLogEncoding: 'JSON',
          },
        },
      }),
      new blueprints.addons.IstioCniAddon(),
      new blueprints.addons.IstioIngressGatewayAddon({
        values: {
          service: {
            annotations: {
              'service.beta.kubernetes.io/aws-load-balancer-type': 'nlb',
              'service.beta.kubernetes.io/aws-load-balancer-scheme':
                'internet-facing',
              'service.beta.kubernetes.io/aws-load-balancer-subnets': vpc
                .selectSubnets({
                  subnetType: SubnetType.PUBLIC,
                })
                .subnetIds.join(','),
            },
          },
        },
      }),
      new blueprints.addons.ExternalsSecretsAddOn({}),
      new blueprints.addons.EbsCsiDefaultStorageClassAddOn(),
      new blueprints.addons.EbsCsiDriverAddOn(),
    ];

    const adminRoleArn = `arn:aws:iam::${this.account}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AWSAdministratorAccess_ee10c8d485cb1dd8`;

    const clusterSecurityGroup = new SecurityGroup(
      this,
      'ClusterSecurityGroup',
      {
        vpc: vpc,
        description: 'Security group for the EKS cluster',
        allowAllOutbound: true,
      }
    );

    const eksName = 'vm-x-ai-eks-cluster';
    const clusterBuilder = blueprints.EksBlueprint.builder()
      .account(this.account)
      .region(this.region)
      .addOns(...addOns)
      .version(KubernetesVersion.V1_34)
      .resourceProvider(
        blueprints.GlobalResources.Vpc,
        new blueprints.DirectVpcProvider(vpc)
      )
      .clusterProvider(
        new blueprints.AutomodeClusterProvider({
          version: KubernetesVersion.V1_34,
          vpcSubnets: [
            {
              subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
          ],
          nodePools: ['system', 'general-purpose'],
          securityGroup: clusterSecurityGroup,
        })
      )
      .teams(
        new blueprints.teams.PlatformTeam({
          name: 'admin',
          userRoleArn: adminRoleArn,
        })
      )
      .build(this, eksName, {
        stackName: eksName,
      });

    const cluster = clusterBuilder.getClusterInfo().cluster;

    cluster.connections.allowTo(
      database.connections,
      Port.tcp(5432),
      'Allow access from EKS cluster 2'
    );

    const externalSecretsChart = cluster.stack.node
      .findAll()
      .find((node) => node.node.id.includes('chart-external-secrets'));

    if (!externalSecretsChart) {
      throw new Error('External Secrets chart not found');
    }

    const ebsStorageClassManifest = cluster.stack.node
      .findAll()
      .find((node) => node.node.id.includes('ebs-storage-class'));

    if (!ebsStorageClassManifest) {
      throw new Error('EBS storage class manifest not found');
    }

    const clusterSecretStore = new KubernetesManifest(
      cluster.stack,
      'ClusterSecretStore',
      {
        cluster: cluster,
        manifest: [
          {
            apiVersion: 'external-secrets.io/v1',
            kind: 'ClusterSecretStore',
            metadata: { name: 'default' },
            spec: {
              provider: {
                aws: {
                  service: 'SecretsManager',
                  region: this.region,
                  auth: {
                    jwt: {
                      serviceAccountRef: {
                        name: 'external-secrets-sa',
                        namespace: 'external-secrets',
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      }
    );

    clusterSecretStore.node.addDependency(externalSecretsChart);

    const encryptionKey = new Key(cluster.stack, 'EncryptionKey', {
      alias: 'alias/vm-x-ai-encryption-key',
      description: 'Encryption key for vm-x-ai',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const timestreamDatabase = new CfnDatabase(
      cluster.stack,
      'TimestreamDatabase',
      {
        databaseName: 'vm-x-ai',
      }
    );

    const namespaceName = 'vm-x-ai';

    const namespace = new KubernetesManifest(cluster.stack, 'Namespace', {
      cluster: cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: namespaceName,
            labels: {
              'istio-injection': 'enabled',
            },
          },
        },
      ],
    });

    // Get the encryption key ARN
    const encryptionKeyArn = encryptionKey.keyArn;

    // Get the Timestream database name
    const timestreamDatabaseName = timestreamDatabase.databaseName || 'vm-x-ai';

    // Resolve the ingress gateway ELB DNS
    const ingressGatewayAddress = new KubernetesObjectValue(
      cluster.stack,
      'ExternalIngressGatewayAddress',
      {
        cluster: cluster,
        objectType: 'service',
        objectName: 'ingressgateway',
        objectNamespace: 'istio-system',
        jsonPath: '.status.loadBalancer.ingress[0].hostname',
      }
    );

    const apiServiceAccountName = 'vm-x-ai-api';

    // Wait for namespace and ingress gateway to be ready
    ingressGatewayAddress.node.addDependency(namespace);

    const apiServiceAccount = cluster.addServiceAccount('APIServiceAccount', {
      name: apiServiceAccountName,
      namespace: namespaceName,
    });

    // Grant KMS permissions
    encryptionKey.grantDecrypt(apiServiceAccount.role);
    encryptionKey.grantEncrypt(apiServiceAccount.role);

    // Grant Timestream permissions
    apiServiceAccount.role.attachInlinePolicy(
      new iam.Policy(cluster.stack, 'TimestreamPolicy', {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'timestream:Describe*',
              'timestream:Write*',
              'timestream:List*',
              'timestream:Select',
              'timestream:Query',
              'timestream:CreateTable',
              'timestream:DeleteTable',
              'timestream:UpdateTable',
            ],
            resources: [
              `arn:aws:timestream:${this.region}:${this.account}:database/${timestreamDatabaseName}/*`,
              `arn:aws:timestream:${this.region}:${this.account}:database/${timestreamDatabaseName}`,
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['timestream:DescribeEndpoints'],
            resources: [`*`],
          }),
        ],
      })
    );

    apiServiceAccount.node.addDependency(namespace);

    // Install Helm chart from the repository
    const helmChart = new HelmChart(cluster.stack, 'VmXAiHelmChart', {
      cluster: cluster,
      chart: 'vm-x-ai',
      repository: 'https://vm-x-ai.github.io/open-vm-x-ai/helm/',
      namespace: 'vm-x-ai',
      release: 'vm-x-ai',
      values: {
        // API configuration with minimal resources
        api: {
          replicaCount: 1,
          resources: {
            requests: {
              cpu: '200m',
              memory: '256Mi',
            },
            limits: {
              cpu: '1000m',
              memory: '1Gi',
            },
          },
          // Avoid conflicts with Next.js API routes when both are deployed to same host
          env: {
            BASE_PATH: '/_api',
            OTEL_TRACES_SAMPLER: 'always_on',
          },
          encryption: {
            provider: 'aws-kms',
            awsKms: {
              keyId: encryptionKeyArn,
            },
          },
          aws: {
            region: this.region,
          },
          timeseriesDb: {
            provider: 'aws-timestream',
            awsTimestream: {
              databaseName: timestreamDatabaseName,
            },
          },
        },

        // UI configuration with minimal resources
        ui: {
          replicaCount: 1,
          env: {
            OTEL_TRACES_SAMPLER: 'always_on',
          },
          resources: {
            requests: {
              cpu: '100m',
              memory: '128Mi',
            },
            limits: {
              cpu: '500m',
              memory: '512Mi',
            },
          },
        },

        // Disable PostgreSQL (using external RDS)
        postgresql: {
          enabled: false,
          external: {
            roHost: database.clusterReadEndpoint.hostname,
            ssl: true, // Enable SSL for AWS RDS connections
          },
        },

        // Enable Redis single node
        // redis: {
        //   enabled: true,
        //   mode: 'single',
        //   single: {
        //     persistence: {
        //       enabled: true,
        //       size: '10Gi',
        //       storageClass: 'auto-ebs-sc',
        //     },
        //     resources: {
        //       requests: {
        //         cpu: '200m',
        //         memory: '256Mi',
        //       },
        //       limits: {
        //         cpu: '500m',
        //         memory: '512Mi',
        //       },
        //     },
        //   },
        // },

        // Enable Redis cluster
        redis: {
          enabled: true,
          mode: 'cluster',
          cluster: {
            nodes: 3,
            replicas: 1,
            persistence: {
              enabled: true,
              size: '10Gi',
              storageClass: 'auto-ebs-sc',
            },
            resources: {
              requests: {
                cpu: '200m',
                memory: '256Mi',
              },
              limits: {
                cpu: '500m',
                memory: '512Mi',
              },
            },
          },
        },

        // Disable QuestDB
        questdb: {
          enabled: false,
        },

        // OpenTelemetry configuration
        otel: {
          enabled: true,
          collector: {
            enabled: true,
          },
          jaeger: {
            enabled: true,
            ingress: {
              enabled: true,
            },
          },
          prometheus: {
            enabled: true,
            persistence: {
              enabled: true,
              size: '10Gi',
              storageClass: 'auto-ebs-sc',
            },
          },
          loki: {
            enabled: true,
            persistence: {
              enabled: true,
              size: '20Gi',
              storageClass: 'auto-ebs-sc',
            },
          },
          grafana: {
            enabled: true,
            ingress: {
              enabled: true,
            },
            persistence: {
              enabled: true,
              size: '10Gi',
              storageClass: 'auto-ebs-sc',
            },
          },
        },

        // Service account configuration (use the IRSA-enabled service account)
        serviceAccount: {
          create: false, // Don't create, we're using the one with IRSA
          name: apiServiceAccountName,
        },

        // Secrets configuration
        secrets: {
          database: {
            method: 'eso',
            externalSecrets: {
              secretKey: 'vm-x-ai-database-secret',
              passwordKey: 'password',
              hostKey: 'host',
              portKey: 'port',
              databaseKey: 'dbname',
              usernameKey: 'username',
            },
          },
          ui: {
            method: 'create', // Auto-generate UI auth secret
          },
          externalSecrets: {
            enabled: true,
            secretStore: {
              name: 'default',
              kind: 'ClusterSecretStore',
            },
          },
        },

        // Ingress configuration with resolved ELB DNS
        ingress: {
          enabled: true,
          istio: {
            host: ingressGatewayAddress.value,
            gateway: {
              name: 'vm-x-ai-gateway',
              namespace: 'istio-system',
              selector: {
                istio: 'ingressgateway',
              },
              servers: [
                {
                  port: {
                    number: 80,
                    name: 'http',
                    protocol: 'HTTP',
                  },
                },
              ],
            },
            virtualService: {
              gateways: ['istio-system/vm-x-ai-gateway'],
            },
          },
        },
      },
      wait: true,
      timeout: cdk.Duration.minutes(10),
    });

    // Add dependencies
    helmChart.node.addDependency(namespace);
    helmChart.node.addDependency(clusterSecretStore);
    helmChart.node.addDependency(ingressGatewayAddress);
    helmChart.node.addDependency(ebsStorageClassManifest);
    helmChart.node.addDependency(apiServiceAccount);

    new cdk.CfnOutput(cluster.stack, 'ApplicationUrl', {
      value: `http://${ingressGatewayAddress.value}`,
      description: 'Application URL',
    });
  }
}
