import { registerOTel } from '@vercel/otel';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import {
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from '@opentelemetry/core';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';

export function register() {
  registerOTel({
    serviceName: 'vm-x-ai-ui',
    propagators: [
      new B3Propagator(),
      new JaegerPropagator(),
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
    ],
    instrumentationConfig: {
      fetch: {
        propagateContextUrls: [new RegExp(`^${process.env.API_BASE_URL}/.*`)],
      },
    },
  });
}
