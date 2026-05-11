import dedent from 'string-dedent';

export type EndpointId = 'chat' | 'responses' | 'anthropic';
export type Language = 'nodejs' | 'python' | 'curl';

export type EndpointSnippet = {
  /** Tab label for the language selector. */
  language: Language;
  /** Monaco language identifier. */
  monaco: string;
  /** The code body. */
  code: string;
};

export type EndpointDefinition = {
  id: EndpointId;
  label: string;
  /**
   * One-line summary shown above the code blocks; describes what the
   * endpoint accepts so users picking a tab can see if it matches the
   * SDK they're already using.
   */
  description: string;
  snippets: EndpointSnippet[];
};

export type SnippetVars = {
  workspaceId: string;
  environmentId: string;
  baseUrl: string;
  resourceName: string;
};

/**
 * VM-X gateway exposes three completion-shaped routes under
 * `/v1/completion/{wid}/{eid}/`. They share auth + audit + capacity
 * but accept different request bodies, matching the SDK the caller
 * already wrote against. Snippets show a "hello world" call for each.
 */
export function getEndpoints(vars: SnippetVars): EndpointDefinition[] {
  return [
    {
      id: 'chat',
      label: 'Chat Completions',
      description:
        'OpenAI Chat Completions shape. Use any OpenAI-compatible SDK by overriding `baseURL`.',
      snippets: [
        {
          language: 'nodejs',
          monaco: 'typescript',
          code: chatNodeJs(vars),
        },
        {
          language: 'python',
          monaco: 'python',
          code: chatPython(vars),
        },
        {
          language: 'curl',
          monaco: 'shell',
          code: chatCurl(vars),
        },
      ],
    },
    {
      id: 'responses',
      label: 'Responses',
      description:
        'OpenAI Responses API shape. Same auth, swap `client.chat.completions.create` for `client.responses.create`.',
      snippets: [
        {
          language: 'nodejs',
          monaco: 'typescript',
          code: responsesNodeJs(vars),
        },
        {
          language: 'python',
          monaco: 'python',
          code: responsesPython(vars),
        },
        {
          language: 'curl',
          monaco: 'shell',
          code: responsesCurl(vars),
        },
      ],
    },
    {
      id: 'anthropic',
      label: 'Anthropic Messages',
      description:
        'Anthropic Messages API shape. Drop-in for the `@anthropic-ai/sdk` package — point `baseURL` at VM-X.',
      snippets: [
        {
          language: 'nodejs',
          monaco: 'typescript',
          code: anthropicNodeJs(vars),
        },
        {
          language: 'python',
          monaco: 'python',
          code: anthropicPython(vars),
        },
        {
          language: 'curl',
          monaco: 'shell',
          code: anthropicCurl(vars),
        },
      ],
    },
  ];
}

// ─── Chat Completions ────────────────────────────────────────────────────

function chatNodeJs({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    import OpenAI from "openai";

    const workspaceId = "${workspaceId}";
    const environmentId = "${environmentId}";
    const resourceName = "${resourceName}";

    const openai = new OpenAI({
      baseURL: \`${baseUrl}/v1/completion/\${workspaceId}/\${environmentId}\`,
      apiKey: '<VM_X_API_KEY>',
    });

    async function main() {
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: "You are a helpful assistant." }],
        model: resourceName, // VM-X Resource Name
      });

      console.log(completion.choices[0]);
    }

    main();
  `;
}

function chatPython({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    from openai import OpenAI

    workspace_id = "${workspaceId}"
    environment_id = "${environmentId}"
    resource_name = "${resourceName}"

    client = OpenAI(
        base_url=f'${baseUrl}/v1/completion/{workspace_id}/{environment_id}',
        api_key='<VM_X_API_KEY>',
    )

    completion = client.chat.completions.create(
        model=resource_name, # VM-X Resource Name
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello!"}
        ]
    )

    print(completion.choices[0].message)
  `;
}

function chatCurl({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    export WORKSPACE_ID="${workspaceId}"
    export ENVIRONMENT_ID="${environmentId}"
    export RESOURCE_NAME="${resourceName}"
    export VM_X_API_KEY="<VM_X_API_KEY>"

    curl ${baseUrl}/v1/completion/$WORKSPACE_ID/$ENVIRONMENT_ID/chat/completions \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer $VM_X_API_KEY" \\
      -d '{
        "model": "'$RESOURCE_NAME'",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Hello!"}
        ]
      }'
  `;
}

// ─── Responses API ───────────────────────────────────────────────────────

function responsesNodeJs({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    import OpenAI from "openai";

    const workspaceId = "${workspaceId}";
    const environmentId = "${environmentId}";
    const resourceName = "${resourceName}";

    const openai = new OpenAI({
      baseURL: \`${baseUrl}/v1/completion/\${workspaceId}/\${environmentId}\`,
      apiKey: '<VM_X_API_KEY>',
    });

    async function main() {
      const response = await openai.responses.create({
        model: resourceName,
        input: "Write a one-sentence bedtime story about a unicorn.",
      });

      console.log(response.output_text);
    }

    main();
  `;
}

function responsesPython({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    from openai import OpenAI

    workspace_id = "${workspaceId}"
    environment_id = "${environmentId}"
    resource_name = "${resourceName}"

    client = OpenAI(
        base_url=f'${baseUrl}/v1/completion/{workspace_id}/{environment_id}',
        api_key='<VM_X_API_KEY>',
    )

    response = client.responses.create(
        model=resource_name,
        input="Write a one-sentence bedtime story about a unicorn.",
    )

    print(response.output_text)
  `;
}

function responsesCurl({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    export WORKSPACE_ID="${workspaceId}"
    export ENVIRONMENT_ID="${environmentId}"
    export RESOURCE_NAME="${resourceName}"
    export VM_X_API_KEY="<VM_X_API_KEY>"

    curl ${baseUrl}/v1/completion/$WORKSPACE_ID/$ENVIRONMENT_ID/responses \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer $VM_X_API_KEY" \\
      -d '{
        "model": "'$RESOURCE_NAME'",
        "input": "Write a one-sentence bedtime story about a unicorn."
      }'
  `;
}

// ─── Anthropic Messages ──────────────────────────────────────────────────

function anthropicNodeJs({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    import Anthropic from "@anthropic-ai/sdk";

    const workspaceId = "${workspaceId}";
    const environmentId = "${environmentId}";
    const resourceName = "${resourceName}";

    // Point the Anthropic SDK at VM-X. The gateway serves the
    // Messages API verbatim, so existing callers don't need to change
    // their request shape.
    const anthropic = new Anthropic({
      baseURL: \`${baseUrl}/v1/completion/\${workspaceId}/\${environmentId}/anthropic\`,
      apiKey: '<VM_X_API_KEY>',
    });

    async function main() {
      const message = await anthropic.messages.create({
        model: resourceName, // VM-X Resource Name
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Hello, Claude!" },
        ],
      });

      console.log(message.content);
    }

    main();
  `;
}

function anthropicPython({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    from anthropic import Anthropic

    workspace_id = "${workspaceId}"
    environment_id = "${environmentId}"
    resource_name = "${resourceName}"

    client = Anthropic(
        base_url=f'${baseUrl}/v1/completion/{workspace_id}/{environment_id}/anthropic',
        api_key='<VM_X_API_KEY>',
    )

    message = client.messages.create(
        model=resource_name,
        max_tokens=1024,
        messages=[
            {"role": "user", "content": "Hello, Claude!"},
        ],
    )

    print(message.content)
  `;
}

function anthropicCurl({
  workspaceId,
  environmentId,
  baseUrl,
  resourceName,
}: SnippetVars) {
  return dedent`
    export WORKSPACE_ID="${workspaceId}"
    export ENVIRONMENT_ID="${environmentId}"
    export RESOURCE_NAME="${resourceName}"
    export VM_X_API_KEY="<VM_X_API_KEY>"

    curl ${baseUrl}/v1/completion/$WORKSPACE_ID/$ENVIRONMENT_ID/anthropic/messages \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer $VM_X_API_KEY" \\
      -d '{
        "model": "'$RESOURCE_NAME'",
        "max_tokens": 1024,
        "messages": [
          {"role": "user", "content": "Hello, Claude!"}
        ]
      }'
  `;
}
