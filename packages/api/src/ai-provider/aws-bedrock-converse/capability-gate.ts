import { HttpStatus } from '@nestjs/common';
import { CompletionError } from '../../gateway/completion.types';

/**
 * T19: minimal per-model capability gate for Bedrock Converse. The
 * gateway forwards `tools` / reasoning config / cache_control to
 * whatever model the resource is pointed at — Bedrock then surfaces
 * an opaque 400 when the model doesn't support the feature. This
 * helper turns the most common mismatches into clear gateway-side
 * errors before the SDK call.
 *
 * Scope is intentionally narrow: only the well-known no-tool-support
 * models. Vision / reasoning / caching gating is best handled by
 * Bedrock's own validation (the per-model matrix is huge and the
 * upstream errors there are usually clear). Expanding this gate over
 * time as customers report opaque 400s is the natural follow-up.
 */

/**
 * Models that don't support tool use at all. Returning a 400 from the
 * gateway with this list catches the most common Bedrock 400s where
 * "ValidationException: this model doesn't support tool use" comes
 * back as a 100ms-wasted call instead of an immediate refusal.
 */
const NO_TOOL_SUPPORT_PATTERNS = [
  /amazon\.titan-text/i,
  /mistral\.mistral-7b/i,
  /mistral\.mixtral-8x7b/i,
  /meta\.llama3-(8b|70b)-/i,
  /meta\.llama3-2-(1b|3b)-/i,
  /deepseek\.deepseek-r1/i,
];

export function assertModelSupportsFeatures(
  modelId: string,
  features: { tools?: boolean }
): void {
  if (features.tools && !modelSupportsTools(modelId)) {
    throw new CompletionError({
      message: `Bedrock model ${modelId} does not support tool use. Drop the \`tools\` field, or route this request to a Claude / Nova / Llama-4 / Mistral-Large model that does.`,
      rate: false,
      retryable: false,
      statusCode: HttpStatus.BAD_REQUEST,
      failureReason: 'Bedrock model does not support tool use',
      openAICompatibleError: { code: 'bedrock_model_does_not_support_tools' },
    });
  }
}

export function modelSupportsTools(modelId: string): boolean {
  return !NO_TOOL_SUPPORT_PATTERNS.some((p) => p.test(modelId));
}
