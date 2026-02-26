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

function joinBaseUrl(baseUrl: string, pathName: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}${pathName}`;
}

function getSelectedBlocks(page: Page, selectedBlockIds: string[]) {
  const selectedSet = new Set(selectedBlockIds);
  return page.blocks.filter((block) => selectedSet.has(block.id));
}

export function resolveModel(_baseUrl: string): string {
  return process.env.DEFAULT_MODEL || "gpt-4o-mini";
}

export async function generatePatch(config: LlmConfig, input: GeneratePatchInput): Promise<Patch> {
  const endpoint = joinBaseUrl(config.baseUrl, "/v1/chat/completions");
  const selectedBlocks = getSelectedBlocks(input.page, input.selectedBlockIds);
  const model = config.model?.trim() || resolveModel(config.baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
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
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as ChatCompletionResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `LLM request failed (${response.status})`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("LLM returned empty content");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    return patchSchema.parse(parsed);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("LLM request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
