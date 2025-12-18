import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from '@opentelemetry/core';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import process from 'process';

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const basePath = process.env.BASE_PATH || '';

const otelSDK = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    }),
    exportIntervalMillis: 60000, // 1 minute
  }),
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    })
  ),
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'vm-x-ai-service',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  contextManager: new AsyncLocalStorageContextManager(),
  textMapPropagator: new CompositePropagator({
    propagators: [
      new B3Propagator(),
      new JaegerPropagator(),
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
    ],
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          const healthcheckPath = basePath
            ? `${basePath}/healthcheck`
            : '/healthcheck';
          return url.startsWith(healthcheckPath);
        },
      },
      '@opentelemetry/instrumentation-fastify': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-openai': {
        enabled: false,
      },
    }),
  ],
});

export default otelSDK;

// You can also use the shutdown method to gracefully shut down the SDK before process shutdown
// or on some operating system signal.
process.on('SIGTERM', () => {
  otelSDK
    .shutdown()
    .then(
      () => console.log('SDK shut down successfully'),
      (err) => console.log('Error shutting down SDK', err)
    )
    .finally(() => process.exit(0));
});
