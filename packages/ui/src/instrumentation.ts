import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({ serviceName: 'vm-x-ai-ui' });
}
