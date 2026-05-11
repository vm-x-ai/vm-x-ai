// Shared configuration loaded from `.env.local`. Each example imports
// `load()` once at startup. Defaults assume the local docker-compose
// stack on port 3030 and the env vars produced by
// `pnpm exec nx run vercel-ai-example:setup`.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

function loadEnvLocal(): void {
  const envFile = resolve(projectRoot, '.env.local');
  if (!existsSync(envFile)) return;
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

export interface GatewayConfig {
  baseUrl: string;
  workspaceId: string;
  environmentId: string;
  apiKey: string;
  openaiResource: string;
  openaiSearchResource: string | undefined;
  anthropicResource: string | undefined;
  /** OpenAI-SDK base URL for /chat/completions and /responses. */
  openaiBaseUrl: string;
  /** Anthropic-SDK base URL — Anthropic provider appends `/v1/messages`. */
  anthropicBaseUrl: string;
}

function require_(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Run \`pnpm exec nx run vercel-ai-example:setup\` first.`
    );
  }
  return v;
}

export function load(): GatewayConfig {
  const baseUrl = process.env.VMX_BASE_URL ?? 'http://localhost:3030/api';
  const workspaceId = require_('VMX_WORKSPACE_ID');
  const environmentId = require_('VMX_ENVIRONMENT_ID');
  const apiKey = require_('VMX_API_KEY');
  const openaiResource = require_('VMX_OPENAI_RESOURCE');
  const completionPrefix = `${baseUrl}/v1/completion/${workspaceId}/${environmentId}`;
  return {
    baseUrl,
    workspaceId,
    environmentId,
    apiKey,
    openaiResource,
    openaiSearchResource: process.env.VMX_OPENAI_SEARCH_RESOURCE,
    anthropicResource: process.env.VMX_ANTHROPIC_RESOURCE,
    openaiBaseUrl: completionPrefix,
    anthropicBaseUrl: `${completionPrefix}/anthropic`,
  };
}
