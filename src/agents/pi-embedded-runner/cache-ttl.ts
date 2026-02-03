type CustomEntryLike = { type?: unknown; customType?: unknown; data?: unknown };

export const CACHE_TTL_CUSTOM_TYPE = "openclaw.cache-ttl";

export type CacheTtlEntryData = {
  timestamp: number;
  provider?: string;
  modelId?: string;
};

/**
 * Check if a provider/model combination supports cache TTL tracking.
 * Supported providers:
 * - Anthropic (all models)
 * - OpenRouter with Anthropic models
 * - Google Gemini 2.5+ models (implicit/explicit caching)
 */
export function isCacheTtlEligibleProvider(provider: string, modelId: string): boolean {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModelId = modelId.toLowerCase();

  // Anthropic: all models support caching
  if (normalizedProvider === "anthropic") {
    return true;
  }

  // OpenRouter with Anthropic models
  if (normalizedProvider === "openrouter" && normalizedModelId.startsWith("anthropic/")) {
    return true;
  }

  // Google Gemini: 2.5+ models support context caching
  if (isGeminiCacheEligible(normalizedProvider, normalizedModelId)) {
    return true;
  }

  return false;
}

/**
 * Check if a Google Gemini model supports context caching.
 * Gemini 2.5+ models support both implicit and explicit caching.
 * Minimum token requirements: Gemini 2.5 Flash: 1,024 / Gemini 2.5 Pro: 4,096
 */
export function isGeminiCacheEligible(provider: string, modelId: string): boolean {
  const normalizedProvider = provider.toLowerCase();
  if (
    normalizedProvider !== "google" &&
    normalizedProvider !== "google-gemini-cli" &&
    normalizedProvider !== "google-antigravity"
  ) {
    return false;
  }

  const normalizedModelId = modelId.toLowerCase();
  // Gemini 2.5+ and 3.x models support caching
  return (
    normalizedModelId.includes("gemini-2.5") ||
    normalizedModelId.includes("gemini-3") ||
    normalizedModelId.includes("gemini-exp") ||
    normalizedModelId.includes("gemini-2.0")
  );
}

export function readLastCacheTtlTimestamp(sessionManager: unknown): number | null {
  const sm = sessionManager as { getEntries?: () => CustomEntryLike[] };
  if (!sm?.getEntries) {
    return null;
  }
  try {
    const entries = sm.getEntries();
    let last: number | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type !== "custom" || entry?.customType !== CACHE_TTL_CUSTOM_TYPE) {
        continue;
      }
      const data = entry?.data as Partial<CacheTtlEntryData> | undefined;
      const ts = typeof data?.timestamp === "number" ? data.timestamp : null;
      if (ts && Number.isFinite(ts)) {
        last = ts;
        break;
      }
    }
    return last;
  } catch {
    return null;
  }
}

export function appendCacheTtlTimestamp(sessionManager: unknown, data: CacheTtlEntryData): void {
  const sm = sessionManager as {
    appendCustomEntry?: (customType: string, data: unknown) => void;
  };
  if (!sm?.appendCustomEntry) {
    return;
  }
  try {
    sm.appendCustomEntry(CACHE_TTL_CUSTOM_TYPE, data);
  } catch {
    // ignore persistence failures
  }
}
