import { patchSchema, type Page, type Patch } from "@packages/blocks";

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

type GeneratePatchInput = {
  page: Page;
  selectedBlockIds: string[];
  instruction: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ClaudeResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ProviderKind = "openai_compatible" | "bigmodel" | "anthropic" | "gemini";

const DEFAULT_LLM_TIMEOUT_MS = 90_000;

function resolveTimeoutMs(): number {
  const raw = process.env.LLM_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_LLM_TIMEOUT_MS;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 5_000) {
    return DEFAULT_LLM_TIMEOUT_MS;
  }

  return Math.floor(value);
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, pathName: string): string {
  return `${trimTrailingSlash(baseUrl)}${pathName}`;
}

function detectProvider(baseUrl: string): ProviderKind {
  const normalized = baseUrl.trim().toLowerCase();

  if (normalized.includes("anthropic.com") || normalized.includes("claude")) {
    return "anthropic";
  }

  if (
    normalized.includes("generativelanguage.googleapis.com") ||
    normalized.includes("googleapis.com") ||
    normalized.includes("gemini")
  ) {
    return "gemini";
  }

  if (normalized.includes("bigmodel.cn") || normalized.includes("zhipu")) {
    return "bigmodel";
  }

  return "openai_compatible";
}

function resolveDefaultModelByBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().toLowerCase();

  if (normalized.includes("bigmodel.cn") || normalized.includes("zhipu")) {
    return "glm-4-flash";
  }

  if (normalized.includes("moonshot.cn") || normalized.includes("kimi")) {
    return "moonshot-v1-8k";
  }

  if (normalized.includes("minimax")) {
    return "MiniMax-M1";
  }

  if (normalized.includes("deepseek.com") || normalized.includes("deepseek")) {
    return "deepseek-chat";
  }

  if (normalized.includes("anthropic.com") || normalized.includes("claude")) {
    return "claude-3-5-sonnet-latest";
  }

  if (
    normalized.includes("generativelanguage.googleapis.com") ||
    normalized.includes("googleapis.com") ||
    normalized.includes("gemini")
  ) {
    return "gemini-2.0-flash";
  }

  return "gpt-4o-mini";
}

function resolveEndpoint(baseUrl: string, provider: ProviderKind, model: string, apiKey: string): string {
  const trimmed = trimTrailingSlash(baseUrl);
  if (trimmed.endsWith("/v1/chat/completions") || trimmed.endsWith("/chat/completions") || trimmed.endsWith("/v1/messages")) {
    return trimmed;
  }

  if (provider === "anthropic") {
    return joinUrl(trimmed, "/v1/messages");
  }

  if (provider === "gemini") {
    if (trimmed.includes("/openai")) {
      return joinUrl(trimmed, "/chat/completions");
    }
    const encodedModel = encodeURIComponent(model);
    const separator = trimmed.includes("?") ? "&" : "?";
    return `${joinUrl(trimmed, `/v1beta/models/${encodedModel}:generateContent`)}${separator}key=${encodeURIComponent(apiKey)}`;
  }

  if (provider === "bigmodel") {
    if (trimmed.includes("/api/coding/paas/v4") || trimmed.includes("/api/paas/v4")) {
      return joinUrl(trimmed, "/chat/completions");
    }
    return joinUrl(trimmed, "/v1/chat/completions");
  }

  if (trimmed.endsWith("/v1")) {
    return joinUrl(trimmed, "/chat/completions");
  }

  return joinUrl(trimmed, "/v1/chat/completions");
}

function getSelectedBlocks(page: Page, selectedBlockIds: string[]) {
  const selectedSet = new Set(selectedBlockIds);
  return page.blocks.filter((block) => selectedSet.has(block.id));
}

function normalizeOpName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalized = raw.replace(/[\s-]+/g, "_");

  if (normalized === "update_content" || normalized === "update" || normalized === "update_text" || normalized === "edit") {
    return "update_content";
  }
  if (normalized === "replace_block" || normalized === "replace") {
    return "replace_block";
  }
  if (normalized === "insert_after" || normalized === "insert" || normalized === "append_after") {
    return "insert_after";
  }
  if (normalized === "delete_block" || normalized === "delete" || normalized === "remove") {
    return "delete_block";
  }

  return raw;
}

function normalizePatchLike(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const source = parsed as { ops?: unknown };
  if (!Array.isArray(source.ops)) {
    return parsed;
  }

  const nextOps = source.ops.map((op) => {
    if (!op || typeof op !== "object") {
      return op;
    }

    const item = op as Record<string, unknown>;
    const normalizedOp = normalizeOpName(item.op);
    const next: Record<string, unknown> = { ...item, op: normalizedOp };
    const target = item.target && typeof item.target === "object" ? (item.target as Record<string, unknown>) : null;
    const block = item.block && typeof item.block === "object" ? (item.block as Record<string, unknown>) : null;

    const readString = (...candidates: Array<unknown>): string | undefined => {
      for (const value of candidates) {
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      return undefined;
    };

    if (normalizedOp === "update_content") {
      const id = readString(next.id, item.blockId, item.block_id, item.targetId, item.target_id, target?.id, target?.blockId, block?.id);
      const content = readString(next.content, item.text, item.value, item.newText, target?.text, target?.content);

      if (id) {
        next.id = id;
      }
      if (content) {
        next.content = content;
      }
    }

    if (normalizedOp === "replace_block") {
      const id = readString(next.id, item.blockId, item.block_id, item.targetId, item.target_id, target?.id, block?.id);
      if (id) {
        next.id = id;
      }
    }

    if (normalizedOp === "insert_after") {
      const afterId = readString(next.afterId, item.after_id, item.after, item.afterBlockId, item.anchorId, item.anchor_id, target?.afterId, target?.id);
      if (afterId) {
        next.afterId = afterId;
      }
    }

    if (normalizedOp === "delete_block") {
      const id = readString(next.id, item.blockId, item.block_id, item.targetId, item.target_id, target?.id, block?.id);
      if (id) {
        next.id = id;
      }
    }

    return next;
  });

  return {
    ...(parsed as Record<string, unknown>),
    ops: nextOps
  };
}

export function resolveModel(_baseUrl: string): string {
  return process.env.DEFAULT_MODEL || resolveDefaultModelByBaseUrl(_baseUrl);
}

export async function generatePatch(config: LlmConfig, input: GeneratePatchInput): Promise<Patch> {
  const selectedBlocks = getSelectedBlocks(input.page, input.selectedBlockIds);
  const model = config.model?.trim() || resolveModel(config.baseUrl);
  const provider = detectProvider(config.baseUrl);
  const endpoint = resolveEndpoint(config.baseUrl, provider, model, config.apiKey);
  const timeoutMs = resolveTimeoutMs();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = [
    "You are a patch generator for a Block JSON editor.",
    'You must output strict JSON only: {"ops":[...]} with no extra characters.',
    "Do not output markdown, code fences, comments, or prose.",
    "Allowed ops are exactly: update_content, replace_block, insert_after, delete_block.",
    "Every target id/afterId must come from selectedBlockIds only.",
    "update_content.content must be plain text unless user explicitly asks for markdown formatting.",
    "Never return full page HTML or full page JSON.",
    "If request cannot be fulfilled from provided content (for example transform table to chart without data),",
    "return one update_content op explaining the limitation instead of fabricating data."
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      selectedBlockIds: input.selectedBlockIds,
      selectedBlocks,
      instruction: input.instruction
    },
    null,
    2
  );

  try {
    const requestInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal
    };

    if (provider === "anthropic") {
      requestInit.headers = {
        ...requestInit.headers,
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      };
      requestInit.body = JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: `${systemPrompt}\n\n${userPrompt}`
          }
        ]
      });
    } else if (provider === "gemini" && !config.baseUrl.toLowerCase().includes("/openai")) {
      requestInit.body = JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      });
    } else {
      requestInit.headers = {
        ...requestInit.headers,
        Authorization: `Bearer ${config.apiKey}`
      };
      requestInit.body = JSON.stringify({
        model,
        temperature: 0.2,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      });
    }

    const response = await fetch(endpoint, requestInit);
    const payload = (await response.json()) as ChatCompletionResponse | ClaudeResponse | GeminiResponse;

    if (!response.ok) {
      const errorMessage =
        "error" in payload && payload.error?.message ? payload.error.message : `LLM request failed (${response.status})`;
      throw new Error(errorMessage);
    }

    let content = "";
    if (provider === "anthropic") {
      const anthropicPayload = payload as ClaudeResponse;
      content = anthropicPayload.content?.find((item) => item.type === "text")?.text ?? "";
    } else if (provider === "gemini" && !config.baseUrl.toLowerCase().includes("/openai")) {
      const geminiPayload = payload as GeminiResponse;
      content = geminiPayload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else {
      const openaiPayload = payload as ChatCompletionResponse;
      content = openaiPayload.choices?.[0]?.message?.content ?? "";
    }

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("LLM returned empty content");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    const normalizedPatch = normalizePatchLike(parsed);
    return patchSchema.parse(normalizedPatch);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
