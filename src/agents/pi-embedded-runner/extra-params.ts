import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../config/config.js";
import { log } from "./logger.js";

const OPENROUTER_APP_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://openclaw.ai",
  "X-Title": "OpenClaw",
};

/**
 * Resolve provider-specific extra params from model config.
 * Used to pass through stream params like temperature/maxTokens.
 *
 * @internal Exported for testing only
 */
export function resolveExtraParams(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
}): Record<string, unknown> | undefined {
  const modelKey = `${params.provider}/${params.modelId}`;
  const modelConfig = params.cfg?.agents?.defaults?.models?.[modelKey];
  return modelConfig?.params ? { ...modelConfig.params } : undefined;
}

type CacheRetention = "none" | "short" | "long";
type CacheRetentionStreamOptions = Partial<SimpleStreamOptions> & {
  cacheRetention?: CacheRetention;
};

/**
 * Check if a provider is a Google/Gemini provider.
 */
function isGoogleProvider(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return (
    normalized === "google" ||
    normalized === "google-gemini-cli" ||
    normalized === "google-antigravity"
  );
}

/**
 * Resolve cacheRetention from extraParams, supporting both new `cacheRetention`
 * and legacy `cacheControlTtl` values for backwards compatibility.
 *
 * Mapping: "5m" → "short", "1h" → "long"
 *
 * Supported providers:
 * - Anthropic: Uses cache_control in request
 * - Google Gemini: Uses context caching (implicit/explicit)
 *
 * OpenRouter uses openai-completions API with hardcoded cache_control,
 * not the cacheRetention stream option.
 */
function resolveCacheRetention(
  extraParams: Record<string, unknown> | undefined,
  provider: string,
): CacheRetention | undefined {
  // Support both Anthropic and Google providers
  if (provider !== "anthropic" && !isGoogleProvider(provider)) {
    return undefined;
  }

  // Prefer new cacheRetention if present
  const newVal = extraParams?.cacheRetention;
  if (newVal === "none" || newVal === "short" || newVal === "long") {
    return newVal;
  }

  // Fall back to legacy cacheControlTtl with mapping
  const legacy = extraParams?.cacheControlTtl;
  if (legacy === "5m") {
    return "short";
  }
  if (legacy === "1h") {
    return "long";
  }

  // Default for Google: enable short caching (5 min) for better implicit cache hits
  // Gemini's implicit caching works best when system prompts are stable
  if (isGoogleProvider(provider)) {
    return "short";
  }

  return undefined;
}

/**
 * Resolve Gemini-specific cache TTL in seconds.
 * Used for explicit caching configuration.
 *
 * | cacheRetention | TTL (seconds) |
 * |----------------|---------------|
 * | "short"        | 300 (5 min)   |
 * | "long"         | 3600 (1 hour) |
 */
export function resolveGeminiCacheTtlSeconds(cacheRetention: CacheRetention): number | undefined {
  switch (cacheRetention) {
    case "short":
      return 300;
    case "long":
      return 3600;
    case "none":
    default:
      return undefined;
  }
}

type GeminiCacheStreamOptions = CacheRetentionStreamOptions & {
  /** Gemini-specific: TTL for cached content in seconds */
  cacheTtlSeconds?: number;
};

function createStreamFnWithExtraParams(
  baseStreamFn: StreamFn | undefined,
  extraParams: Record<string, unknown> | undefined,
  provider: string,
): StreamFn | undefined {
  // For Google providers, we want to apply default caching even without explicit extraParams
  const isGoogle = isGoogleProvider(provider);
  if (!isGoogle && (!extraParams || Object.keys(extraParams).length === 0)) {
    return undefined;
  }

  const streamParams: GeminiCacheStreamOptions = {};
  if (typeof extraParams?.temperature === "number") {
    streamParams.temperature = extraParams.temperature;
  }
  if (typeof extraParams?.maxTokens === "number") {
    streamParams.maxTokens = extraParams.maxTokens;
  }

  const cacheRetention = resolveCacheRetention(extraParams, provider);
  if (cacheRetention && cacheRetention !== "none") {
    streamParams.cacheRetention = cacheRetention;

    // For Google providers, also set cacheTtlSeconds for explicit caching
    if (isGoogle) {
      const ttlSeconds = resolveGeminiCacheTtlSeconds(cacheRetention);
      if (ttlSeconds) {
        streamParams.cacheTtlSeconds = ttlSeconds;
      }
    }
  }

  if (Object.keys(streamParams).length === 0) {
    return undefined;
  }

  const providerHint = isGoogle ? " (Gemini context caching enabled)" : "";
  log.debug(`creating streamFn wrapper with params: ${JSON.stringify(streamParams)}${providerHint}`);

  const underlying = baseStreamFn ?? streamSimple;
  const wrappedStreamFn: StreamFn = (model, context, options) =>
    underlying(model, context, {
      ...streamParams,
      ...options,
    });

  return wrappedStreamFn;
}

/**
 * Create a streamFn wrapper that adds OpenRouter app attribution headers.
 * These headers allow OpenClaw to appear on OpenRouter's leaderboard.
 */
function createOpenRouterHeadersWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    underlying(model, context, {
      ...options,
      headers: {
        ...OPENROUTER_APP_HEADERS,
        ...options?.headers,
      },
    });
}

/**
 * Apply extra params (like temperature) to an agent's streamFn.
 * Also adds OpenRouter app attribution headers when using the OpenRouter provider.
 *
 * @internal Exported for testing
 */
export function applyExtraParamsToAgent(
  agent: { streamFn?: StreamFn },
  cfg: OpenClawConfig | undefined,
  provider: string,
  modelId: string,
  extraParamsOverride?: Record<string, unknown>,
): void {
  const extraParams = resolveExtraParams({
    cfg,
    provider,
    modelId,
  });
  const override =
    extraParamsOverride && Object.keys(extraParamsOverride).length > 0
      ? Object.fromEntries(
          Object.entries(extraParamsOverride).filter(([, value]) => value !== undefined),
        )
      : undefined;
  const merged = Object.assign({}, extraParams, override);
  const wrappedStreamFn = createStreamFnWithExtraParams(agent.streamFn, merged, provider);

  if (wrappedStreamFn) {
    log.debug(`applying extraParams to agent streamFn for ${provider}/${modelId}`);
    agent.streamFn = wrappedStreamFn;
  }

  if (provider === "openrouter") {
    log.debug(`applying OpenRouter app attribution headers for ${provider}/${modelId}`);
    agent.streamFn = createOpenRouterHeadersWrapper(agent.streamFn);
  }
}
