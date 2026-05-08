import dedent from 'string-dedent';
import type { Language, SnippetVars } from './snippets';

export type AdvancedPatternId = 'overrides' | 'metadata' | 'connection-model';

export type AdvancedSnippet = {
  language: Language;
  monaco: string;
  code: string;
};

export type AdvancedPatternDefinition = {
  id: AdvancedPatternId;
  label: string;
  /** Headline for the pattern (rendered above the code). */
  description: string;
  snippets: AdvancedSnippet[];
};

/**
 * Three "escape hatch" patterns for the gateway that aren't visible
 * from the basic Chat Completions / Responses / Anthropic Messages
 * snippets. Each one composes through the same VM-X envelope:
 *
 *   - `vmx.resourceConfigOverrides` — patch the saved resource on a
 *     per-request basis (different model, different fallback chain,
 *     extra default args). The merge is shallow + per-key, so the
 *     overrides leave anything they don't mention untouched.
 *   - `vmx.metadata` — caller-side key/value pairs that survive into
 *     the audit row, time-series metrics, and `x-vmx-metadata-*`
 *     response headers. Useful for tagging requests with the calling
 *     feature, user, or A/B variant.
 *   - `<connection name>/<model>` — bypass the resource layer entirely
 *     and call a specific connection/model directly. No routing, no
 *     fallback — just a direct passthrough using the named AI
 *     Connection's credentials.
 */
export function getAdvancedPatterns(
  vars: SnippetVars
): AdvancedPatternDefinition[] {
  return [
    {
      id: 'overrides',
      label: 'Override resource properties',
      description:
        'Patch the saved AI Resource for one request via `vmx.resourceConfigOverrides`. Anything you set wins; anything you omit stays as-configured.',
      snippets: [
        {
          language: 'nodejs',
          monaco: 'typescript',
          code: overridesNodeJs(vars),
        },
        { language: 'python', monaco: 'python', code: overridesPython(vars) },
        { language: 'curl', monaco: 'shell', code: overridesCurl(vars) },
      ],
    },
    {
      id: 'metadata',
      label: 'Custom metadata',
      description:
        '`vmx.metadata` flows through to the audit row, the time-series metrics, and the `x-vmx-metadata-*` response headers — handy for tagging by feature, user, or A/B bucket.',
      snippets: [
        {
          language: 'nodejs',
          monaco: 'typescript',
          code: metadataNodeJs(vars),
        },
        { language: 'python', monaco: 'python', code: metadataPython(vars) },
        { language: 'curl', monaco: 'shell', code: metadataCurl(vars) },
      ],
    },
    {
      id: 'connection-model',
      label: 'Connection / model passthrough',
      description:
        'Skip the resource layer entirely by passing `model: "<connection-name>/<provider-model>"`. No routing, no fallback — VM-X looks up the named AI Connection and calls the upstream provider directly.',
      snippets: [
        {
          language: 'nodejs',
          monaco: 'typescript',
          code: connModelNodeJs(vars),
        },
        { language: 'python', monaco: 'python', code: connModelPython(vars) },
        { language: 'curl', monaco: 'shell', code: connModelCurl(vars) },
      ],
    },
  ];
}

// ─── Resource overrides ──────────────────────────────────────────────────

function overridesNodeJs({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    import OpenAI from "openai";
    import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

    const openai = new OpenAI({
      baseURL: \`${baseUrl}/v1/completion/${workspaceId}/${environmentId}\`,
      apiKey: '<VM_X_API_KEY>',
    });

    // Type the OpenAI fields with the SDK's own request type, then
    // intersect with the gateway-only \`vmx\` envelope. The gateway
    // strips \`vmx\` before forwarding to the upstream provider, so it's
    // safe to mix freely with regular OpenAI fields — the cast just
    // bridges the OpenAI SDK's strict typing.
    const body: ChatCompletionCreateParamsNonStreaming & {
      vmx: {
        resourceConfigOverrides: {
          model?: {
            provider: string;
            connectionId: string;
            model: string;
            maxRetries?: number;
            timeoutMs?: number;
          };
          defaultArgs?: Record<string, unknown>;
        };
      };
    } = {
      model: '${resourceName}',
      messages: [{ role: 'user', content: 'summarize this PDF' }],
      vmx: {
        resourceConfigOverrides: {
          // Force a different primary model just for this request,
          // without changing the saved resource. The per-call retry +
          // timeout knobs live on the same \`model\` object — they are
          // resolved together so the override always references the
          // same connection/model the override picked.
          model: {
            provider: 'anthropic',
            connectionId: '<ANTHROPIC_CONNECTION_ID>',
            model: 'claude-haiku-4-5-20251001',
            maxRetries: 1,
            timeoutMs: 8000,
          },
          // Layer extra default args on top of the resource's own.
          defaultArgs: { temperature: 0, reasoning_effort: 'low' },
        },
      },
    };

    const completion = await openai.chat.completions.create(body);
  `;
}

function overridesPython({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    from openai import OpenAI

    client = OpenAI(
        base_url=f'${baseUrl}/v1/completion/${workspaceId}/${environmentId}',
        api_key='<VM_X_API_KEY>',
    )

    completion = client.chat.completions.create(
        model='${resourceName}',
        messages=[{'role': 'user', 'content': 'summarize this PDF'}],
        # 'vmx' is the gateway envelope. extra_body keeps the openai SDK happy.
        extra_body={
            'vmx': {
                'resourceConfigOverrides': {
                    'model': {
                        'provider': 'anthropic',
                        'connectionId': '<ANTHROPIC_CONNECTION_ID>',
                        'model': 'claude-haiku-4-5-20251001',
                        'maxRetries': 1,
                        'timeoutMs': 8000,
                    },
                    'defaultArgs': {
                        'temperature': 0,
                        'reasoning_effort': 'low',
                    },
                },
            },
        },
    )
  `;
}

function overridesCurl({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    curl ${baseUrl}/v1/completion/${workspaceId}/${environmentId}/chat/completions \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer <VM_X_API_KEY>" \\
      -d '{
        "model": "${resourceName}",
        "messages": [
          {"role": "user", "content": "summarize this PDF"}
        ],
        "vmx": {
          "resourceConfigOverrides": {
            "model": {
              "provider": "anthropic",
              "connectionId": "<ANTHROPIC_CONNECTION_ID>",
              "model": "claude-haiku-4-5-20251001",
              "maxRetries": 1,
              "timeoutMs": 8000
            },
            "defaultArgs": {
              "temperature": 0,
              "reasoning_effort": "low"
            }
          }
        }
      }'
  `;
}

// ─── Custom metadata ─────────────────────────────────────────────────────

function metadataNodeJs({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    import OpenAI from "openai";
    import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

    const openai = new OpenAI({
      baseURL: \`${baseUrl}/v1/completion/${workspaceId}/${environmentId}\`,
      apiKey: '<VM_X_API_KEY>',
    });

    // Same pattern as the override snippet — type the OpenAI fields
    // with the SDK's own request type, intersect with the
    // gateway-only \`vmx\` envelope, no \`as any\` needed.
    const body: ChatCompletionCreateParamsNonStreaming & {
      vmx: {
        metadata?: Record<string, string>;
        correlationId?: string;
      };
    } = {
      model: '${resourceName}',
      messages: [{ role: 'user', content: 'tldr this thread' }],
      vmx: {
        // Plain key/value pairs. They land on the audit row, on the
        // time-series usage metrics, and on the response as
        // 'x-vmx-metadata-<key>' headers.
        metadata: {
          feature: 'thread-summary',
          userId: 'u_42',
          experiment: 'B',
        },
        // Optional: a stable correlation id you control, instead of
        // letting VM-X generate one.
        correlationId: 'req_abc123',
      },
    };

    const completion = await openai.chat.completions.create(body);
  `;
}

function metadataPython({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    from openai import OpenAI

    client = OpenAI(
        base_url=f'${baseUrl}/v1/completion/${workspaceId}/${environmentId}',
        api_key='<VM_X_API_KEY>',
    )

    completion = client.chat.completions.create(
        model='${resourceName}',
        messages=[{'role': 'user', 'content': 'tldr this thread'}],
        extra_body={
            'vmx': {
                'metadata': {
                    'feature': 'thread-summary',
                    'userId': 'u_42',
                    'experiment': 'B',
                },
                'correlationId': 'req_abc123',
            },
        },
    )
  `;
}

function metadataCurl({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    curl ${baseUrl}/v1/completion/${workspaceId}/${environmentId}/chat/completions \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer <VM_X_API_KEY>" \\
      -d '{
        "model": "${resourceName}",
        "messages": [
          {"role": "user", "content": "tldr this thread"}
        ],
        "vmx": {
          "metadata": {
            "feature": "thread-summary",
            "userId": "u_42",
            "experiment": "B"
          },
          "correlationId": "req_abc123"
        }
      }'
  `;
}

// ─── Connection / model passthrough ──────────────────────────────────────

function connModelNodeJs({ workspaceId, environmentId, baseUrl }: SnippetVars) {
  return dedent`
    import OpenAI from "openai";

    const openai = new OpenAI({
      baseURL: \`${baseUrl}/v1/completion/${workspaceId}/${environmentId}\`,
      apiKey: '<VM_X_API_KEY>',
    });

    // No routing, no fallback — VM-X looks up the AI Connection named
    // 'openai-prod' and calls 'gpt-4.1' on it directly. The slash
    // delimiter is what tells the gateway to skip the resource layer.
    const completion = await openai.chat.completions.create({
      model: 'openai-prod/gpt-4.1',
      messages: [{ role: 'user', content: 'classify this email' }],
    });
  `;
}

function connModelPython({ workspaceId, environmentId, baseUrl }: SnippetVars) {
  return dedent`
    from openai import OpenAI

    client = OpenAI(
        base_url=f'${baseUrl}/v1/completion/${workspaceId}/${environmentId}',
        api_key='<VM_X_API_KEY>',
    )

    # 'openai-prod' is the AI Connection name; 'gpt-4.1' is the upstream model.
    # VM-X skips the resource layer entirely — pure passthrough.
    completion = client.chat.completions.create(
        model='openai-prod/gpt-4.1',
        messages=[{'role': 'user', 'content': 'classify this email'}],
    )
  `;
}

function connModelCurl({ workspaceId, environmentId, baseUrl }: SnippetVars) {
  return dedent`
    curl ${baseUrl}/v1/completion/${workspaceId}/${environmentId}/chat/completions \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer <VM_X_API_KEY>" \\
      -d '{
        "model": "openai-prod/gpt-4.1",
        "messages": [
          {"role": "user", "content": "classify this email"}
        ]
      }'
  `;
}
