export type ProviderVerifyErrorCode =
  | "invalid_request"
  | "invalid_api_key"
  | "incompatible_endpoint"
  | "timeout"
  | "network_error"
  | "unknown_error";

export type ProviderVerifyError = {
  code: ProviderVerifyErrorCode;
  message: string;
};

export type ProviderVerifyResult =
  | {
      ok: true;
      models: string[];
    }
  | {
      ok: false;
      error: ProviderVerifyError;
    };

export type ProviderType = "openai_compatible" | "gemini" | "anthropic";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL_BY_PROVIDER: Record<ProviderType, string> = {
  openai_compatible: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  anthropic: "https://api.anthropic.com"
};

function normalizeBaseUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (!url.hostname) {
    return null;
  }

  const sanitized = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  return sanitized || url.origin;
}

function resolveBaseUrl(input: string | undefined, provider: ProviderType): string | null {
  const provided = typeof input === "string" ? input.trim() : "";
  if (!provided) {
    return DEFAULT_BASE_URL_BY_PROVIDER[provider];
  }
  return normalizeBaseUrl(provided);
}

function isGeminiOpenAiCompat(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes("/openai");
}

function buildModelEndpoints(baseUrl: string, provider: ProviderType): string[] {
  const base = baseUrl.replace(/\/+$/, "");
  const endpoints: string[] = [];

  if (provider === "anthropic") {
    if (base.toLowerCase().endsWith("/v1")) {
      endpoints.push(`${base}/models`);
    } else {
      endpoints.push(`${base}/v1/models`);
    }
    return [...new Set(endpoints)];
  }

  if (provider === "gemini" && !isGeminiOpenAiCompat(base)) {
    endpoints.push(`${base}/v1beta/models`);
    endpoints.push(`${base}/v1/models`);
    return [...new Set(endpoints)];
  }

  if (base.toLowerCase().endsWith("/v1")) {
    endpoints.push(`${base}/models`);
  } else {
    endpoints.push(`${base}/v1/models`);
  }
  endpoints.push(`${base}/models`);

  return [...new Set(endpoints)];
}

function extractModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as { data?: unknown; models?: unknown };
  const fromData = Array.isArray(root.data) ? root.data : [];
  const fromModels = Array.isArray(root.models) ? root.models : [];
  const list = fromData.length > 0 ? fromData : fromModels;

  const models = list
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const row = item as { id?: unknown; name?: unknown };
      if (typeof row.id === "string" && row.id.trim()) {
        return row.id.trim();
      }
      if (typeof row.name === "string" && row.name.trim()) {
        return row.name.trim();
      }
      return "";
    })
    .filter(Boolean);

  return [...new Set(models)];
}

function buildFetchRequest(url: string, apiKey: string, provider: ProviderType): { url: string; headers: Record<string, string> } {
  if (provider === "anthropic") {
    return {
      url,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json"
      }
    };
  }

  if (provider === "gemini" && !isGeminiOpenAiCompat(url)) {
    return {
      url,
      headers: {
        "x-goog-api-key": apiKey,
        Accept: "application/json"
      }
    };
  }

  return {
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    }
  };
}

async function fetchWithTimeout(url: string, apiKey: string, timeoutMs: number, provider: ProviderType): Promise<Response> {
  const req = buildFetchRequest(url, apiKey, provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(req.url, {
      method: "GET",
      headers: req.headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    const message = payload?.error?.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // ignore json parse failures
  }
  return `Provider returned HTTP ${response.status}.`;
}

function looksLikeInvalidKey(status: number, message: string): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  const text = message.toLowerCase();
  return (
    text.includes("api key not valid") ||
    text.includes("invalid api key") ||
    text.includes("invalid authentication") ||
    text.includes("permission denied") ||
    text.includes("unauthorized")
  );
}

export async function verifyProviderApiKey(input: {
  baseUrl?: string;
  apiKey: string;
  provider?: ProviderType;
  timeoutMs?: number;
}): Promise<ProviderVerifyResult> {
  const provider = input.provider ?? "openai_compatible";
  const baseUrl = resolveBaseUrl(input.baseUrl, provider);
  const apiKey = input.apiKey.trim();
  const timeoutMs = input.timeoutMs && input.timeoutMs >= 8_000 ? Math.min(input.timeoutMs, 40_000) : DEFAULT_TIMEOUT_MS;

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: "apiKey is required; baseUrl must use http/https when provided."
      }
    };
  }

  const endpoints = buildModelEndpoints(baseUrl, provider);
  let sawIncompatible = false;

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithTimeout(endpoint, apiKey, timeoutMs, provider);

      const errorMessage = response.ok ? "" : await readErrorMessage(response);
      if (looksLikeInvalidKey(response.status, errorMessage)) {
        return {
          ok: false,
          error: {
            code: "invalid_api_key",
            message: "API key is invalid or unauthorized for this provider."
          }
        };
      }

      if (response.status === 404 || response.status === 405) {
        sawIncompatible = true;
        continue;
      }

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "unknown_error",
            message: errorMessage
          }
        };
      }

      const payload = (await response.json()) as unknown;
      const models = extractModels(payload);
      if (models.length === 0) {
        sawIncompatible = true;
        continue;
      }

      return { ok: true, models };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          error: {
            code: "timeout",
            message: `Provider request timed out after ${timeoutMs}ms.`
          }
        };
      }

      return {
        ok: false,
        error: {
          code: "network_error",
          message: error instanceof Error ? error.message : "Failed to reach provider endpoint."
        }
      };
    }
  }

  if (sawIncompatible) {
    return {
      ok: false,
      error: {
        code: "incompatible_endpoint",
        message: "Provider models endpoint is incompatible or baseUrl is incorrect."
      }
    };
  }

  return {
    ok: false,
    error: {
      code: "unknown_error",
      message: "Unable to verify provider API key."
    }
  };
}
