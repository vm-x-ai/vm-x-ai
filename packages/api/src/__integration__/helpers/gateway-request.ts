/**
 * Test-side GatewayRequest envelope used by the harness's `service.complete()`
 * shim and the flow specs. The real orchestrator's
 * `CompletionService.completion()` accepts the same structural shape on its
 * `originalGatewayRequest` parameter — Phase E moved away from the public
 * `complete({format,body})` entrypoint, so this type lives in test land
 * only.
 */
export type GatewayRequest =
  | { format: 'chat-completions'; body: unknown }
  | { format: 'responses'; body: unknown }
  | { format: 'anthropic'; body: unknown };
