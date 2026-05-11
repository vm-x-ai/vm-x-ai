// Shared configuration loaded from `.env.local`. The Claude Agent SDK
// is configured via `options.env` — the SDK spawns the Claude Code CLI,
// which reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` from the env
// we hand it. We point those at the VM-X `/anthropic` prefix; the CLI
// appends `/v1/messages` (which VM-X exposes as an alias for
// `/anthropic/messages`).

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
  anthropicResource: string;
  /** Base URL the Claude CLI uses. The CLI appends `/v1/messages`. */
  anthropicBaseUrl: string;
  /**
   * Optional override for the Claude Code CLI binary. The TS SDK ships
   * platform-specific binaries via optional deps (musl/gnu/darwin/win);
   * if the matching one isn't installed or isn't compatible (e.g. musl
   * binary on a glibc host), set `CLAUDE_CLI_PATH=$(which claude)` so
   * the SDK uses your system binary instead.
   */
  pathToClaudeCodeExecutable: string | undefined;
}

function require_(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Run \`pnpm exec nx run claude-agent-sdk-ts-example:setup\` first.`
    );
  }
  return value;
}

export function load(): GatewayConfig {
  const baseUrl = process.env.VMX_BASE_URL ?? 'http://localhost:3030/api';
  const workspaceId = require_(
    'VMX_WORKSPACE_ID',
    process.env.VMX_WORKSPACE_ID
  );
  const environmentId = require_(
    'VMX_ENVIRONMENT_ID',
    process.env.VMX_ENVIRONMENT_ID
  );
  const apiKey = require_('VMX_API_KEY', process.env.VMX_API_KEY);
  // The agent CLI sends `output_config.effort` on every request, which
  // Haiku models reject — prefer the agent-tier resource (Sonnet) that
  // the seed script creates for this purpose.
  const anthropicResource = require_(
    'VMX_ANTHROPIC_AGENT_RESOURCE or VMX_ANTHROPIC_RESOURCE',
    process.env.VMX_ANTHROPIC_AGENT_RESOURCE ??
      process.env.VMX_ANTHROPIC_RESOURCE
  );

  return {
    baseUrl,
    workspaceId,
    environmentId,
    apiKey,
    anthropicResource,
    anthropicBaseUrl: `${baseUrl}/v1/completion/${workspaceId}/${environmentId}/anthropic`,
    pathToClaudeCodeExecutable: process.env.CLAUDE_CLI_PATH || undefined,
  };
}

// Env vars the spawned `claude` CLI inherits from the parent process
// that would make it behave as if it's running inside another Claude
// Code session — and silently skip the `ANTHROPIC_API_KEY` auth path
// in favour of parent-session OAuth tokens. Only relevant when this
// example is run inside another Claude Code session (e.g. during
// development); kept defensive so the example works in either case.
const CLAUDE_PARENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_AGENT_SDK_VERSION',
  'AI_AGENT',
];

export function optionsEnv(cfg: GatewayConfig): Record<string, string> {
  // Inherit the parent process env so the spawned CLI sees PATH, HOME,
  // etc.; only the Anthropic-pointer vars are overridden. Parent-
  // Claude-Code-session markers are stripped so the spawned CLI
  // doesn't think it's a nested agent and skip ANTHROPIC_API_KEY auth.
  const inherited: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue;
    if (CLAUDE_PARENT_SESSION_VARS.includes(k)) continue;
    inherited[k] = v;
  }
  return {
    ...inherited,
    ANTHROPIC_BASE_URL: cfg.anthropicBaseUrl,
    ANTHROPIC_API_KEY: cfg.apiKey,
  };
}
