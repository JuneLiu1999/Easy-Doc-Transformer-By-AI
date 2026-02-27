import { patchSchema, type Page, type Patch } from "@packages/blocks";

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  provider?: ProviderKind;
};

export type PatchDebugInfo = {
  provider: "openai_compatible" | "bigmodel" | "anthropic" | "gemini";
  endpoint: string;
  model: string;
  promptChars: number;
  selectedBlockCount: number;
  rawContent: string;
  parsed: unknown;
  normalized: unknown;
  validated: Patch;
};

type GeneratePatchInput = {
  page: Page;
  selectedBlockIds: string[];
  instruction: string;
};

type IntentProfile = "text_edit" | "image_edit" | "table_or_chart_edit" | "layout_edit" | "general";

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

export type ProviderKind = "openai_compatible" | "bigmodel" | "anthropic" | "gemini";

const DEFAULT_LLM_TIMEOUT_MS = 90_000;
const DEFAULT_BASE_URL_BY_PROVIDER: Record<Exclude<ProviderKind, "bigmodel">, string> = {
  openai_compatible: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  anthropic: "https://api.anthropic.com"
};

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

function resolveDefaultModelByProvider(provider: ProviderKind): string {
  if (provider === "anthropic") {
    return "claude-3-5-sonnet-latest";
  }
  if (provider === "gemini") {
    return "gemini-2.0-flash";
  }
  if (provider === "bigmodel") {
    return "glm-4-flash";
  }
  return "gpt-4o-mini";
}

function normalizeProvider(value: unknown): ProviderKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "openai_compatible" || normalized === "openai") {
    return "openai_compatible";
  }
  if (normalized === "anthropic") {
    return "anthropic";
  }
  if (normalized === "gemini") {
    return "gemini";
  }
  if (normalized === "bigmodel" || normalized === "zhipu") {
    return "bigmodel";
  }
  return undefined;
}

function resolveEndpoint(baseUrl: string, provider: ProviderKind, model: string): string {
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
    return joinUrl(trimmed, `/v1beta/models/${encodedModel}:generateContent`);
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
  const result: Page["blocks"] = [];
  const seen = new Set<string>();

  const walk = (blocks: Page["blocks"]) => {
    for (const block of blocks) {
      if (selectedSet.has(block.id) && !seen.has(block.id)) {
        result.push(block);
        seen.add(block.id);
      }
      if (block.type === "columns") {
        for (const column of block.columns) {
          walk(column.blocks);
        }
      }
    }
  };

  walk(page.blocks);
  return result;
}

function classifyIntent(instruction: string): IntentProfile {
  const text = instruction.toLowerCase();
  const hasLayout = /(布局|排版|多栏|分栏|栅格|grid|column|columns|对齐|间距|重排|位置|结构)/i.test(text);
  if (hasLayout) {
    return "layout_edit";
  }
  if (/(图片|图像|照片|配图|image|img|缩小|放大|裁剪|边框|尺寸|大小)/i.test(text)) {
    return "image_edit";
  }
  if (/(表格|图表|echarts|数据可视化|series|坐标轴|x轴|y轴|柱状图|折线图|饼图|scatter|heatmap)/i.test(text)) {
    return "table_or_chart_edit";
  }
  if (/(文字|文本|文案|措辞|语气|改写|润色|拼写|语法|标题|段落|摘要)/i.test(text)) {
    return "text_edit";
  }
  return "general";
}

function truncateText(value: string, maxLen: number): string {
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen)}...(truncated)`;
}

function summarizeChartOption(option: unknown): Record<string, unknown> {
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    return { kind: "invalid_option" };
  }
  const obj = option as Record<string, unknown>;
  const xAxis = Array.isArray(obj.xAxis) ? obj.xAxis[0] : obj.xAxis;
  const yAxis = Array.isArray(obj.yAxis) ? obj.yAxis[0] : obj.yAxis;
  const seriesRaw = Array.isArray(obj.series) ? obj.series : [];
  const series = seriesRaw.slice(0, 6).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { type: "unknown", dataPoints: 0 };
    }
    const s = item as Record<string, unknown>;
    return {
      name: typeof s.name === "string" ? truncateText(s.name, 80) : undefined,
      type: typeof s.type === "string" ? s.type : "unknown",
      dataPoints: Array.isArray(s.data) ? s.data.length : 0
    };
  });
  return {
    title: typeof obj.title === "object" && obj.title && "text" in (obj.title as Record<string, unknown>) ? (obj.title as Record<string, unknown>).text : undefined,
    xAxisType: xAxis && typeof xAxis === "object" && !Array.isArray(xAxis) ? (xAxis as Record<string, unknown>).type : undefined,
    yAxisType: yAxis && typeof yAxis === "object" && !Array.isArray(yAxis) ? (yAxis as Record<string, unknown>).type : undefined,
    series
  };
}

function compactBlockForPrompt(block: Page["blocks"][number], intent: IntentProfile, depth = 0): Record<string, unknown> {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      id: block.id,
      type: block.type,
      ...(block.type === "heading" ? { level: block.level } : {}),
      text: truncateText(block.text, intent === "text_edit" ? 1200 : 400)
    };
  }
  if (block.type === "image") {
    return {
      id: block.id,
      type: "image",
      src: truncateText(block.src, 240),
      alt: typeof block.alt === "string" ? truncateText(block.alt, 200) : undefined,
      caption: typeof block.caption === "string" ? truncateText(block.caption, 400) : undefined
    };
  }
  if (block.type === "chart") {
    return {
      id: block.id,
      type: "chart",
      title: block.title,
      height: block.height,
      option:
        intent === "table_or_chart_edit" || intent === "layout_edit"
          ? summarizeChartOption(block.option)
          : { summary: summarizeChartOption(block.option) }
    };
  }
  if (block.type === "rich") {
    const maxItems = intent === "layout_edit" ? 8 : 5;
    return {
      id: block.id,
      type: "rich",
      items: block.items.slice(0, maxItems).map((item) => {
        if (item.kind === "text") {
          return { kind: "text", text: truncateText(item.text, intent === "text_edit" ? 1200 : 400) };
        }
        if (item.kind === "image") {
          return {
            kind: "image",
            src: truncateText(item.src, 240),
            alt: typeof item.alt === "string" ? truncateText(item.alt, 200) : undefined,
            caption: typeof item.caption === "string" ? truncateText(item.caption, 300) : undefined
          };
        }
        return {
          kind: "chart",
          title: item.title,
          height: item.height,
          option: summarizeChartOption(item.option)
        };
      })
    };
  }
  if (block.type === "columns") {
    if (depth >= 2 && intent !== "layout_edit") {
      return {
        id: block.id,
        type: "columns",
        gap: block.gap,
        columns: block.columns.map((col) => ({ id: col.id, blockCount: col.blocks.length }))
      };
    }
    return {
      id: block.id,
      type: "columns",
      gap: block.gap,
      columns: block.columns.map((col) => ({
        id: col.id,
        blocks: col.blocks.slice(0, 8).map((child) => compactBlockForPrompt(child, intent, depth + 1))
      }))
    };
  }
  return { id: block.id, type: block.type };
}

function buildPromptPayload(input: GeneratePatchInput, selectedBlocks: Page["blocks"]): Record<string, unknown> {
  const intent = classifyIntent(input.instruction);
  const maxByIntent =
    intent === "image_edit" ? 6 : intent === "text_edit" ? 20 : intent === "table_or_chart_edit" ? 12 : intent === "layout_edit" ? 20 : 16;
  const limitedBlocks = selectedBlocks.slice(0, maxByIntent);
  const compactBlocks = limitedBlocks.map((block) => compactBlockForPrompt(block, intent));
  const payload: Record<string, unknown> = {
    intent,
    selectedBlockIds: input.selectedBlockIds,
    selectedBlocks: compactBlocks,
    instruction: input.instruction
  };

  let json = JSON.stringify(payload);
  const hardCap = intent === "image_edit" ? 12_000 : intent === "text_edit" ? 24_000 : 32_000;
  if (json.length > hardCap) {
    payload.selectedBlocks = compactBlocks.slice(0, Math.max(1, Math.floor(compactBlocks.length / 2)));
    payload.truncated = true;
    json = JSON.stringify(payload);
    if (json.length > hardCap) {
      payload.selectedBlocks = (payload.selectedBlocks as unknown[]).map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }
        const next = { ...(item as Record<string, unknown>) };
        if (typeof next.text === "string") {
          next.text = truncateText(next.text, intent === "text_edit" ? 320 : 160);
        }
        if (intent === "image_edit") {
          return {
            id: typeof next.id === "string" ? next.id : undefined,
            type: typeof next.type === "string" ? next.type : undefined,
            src: typeof next.src === "string" ? truncateText(next.src, 120) : undefined,
            caption: typeof next.caption === "string" ? truncateText(next.caption, 120) : undefined
          };
        }
        return next;
      });
      json = JSON.stringify(payload);
      if (json.length > hardCap) {
        payload.selectedBlocks = (payload.selectedBlocks as unknown[]).map((item) => {
          if (!item || typeof item !== "object") {
            return item;
          }
          const obj = item as Record<string, unknown>;
          return {
            id: typeof obj.id === "string" ? obj.id : undefined,
            type: typeof obj.type === "string" ? obj.type : undefined
          };
        });
      }
    }
  }

  return payload;
}

function normalizeOpName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }

  // Accept snake_case, kebab-case, spaced text, and camelCase op names.
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (
    normalized === "update_content" ||
    normalized === "update" ||
    normalized === "update_text" ||
    normalized === "updatecontent" ||
    normalized === "edit"
  ) {
    return "update_content";
  }
  if (normalized === "replace_block" || normalized === "replace" || normalized === "replaceblock") {
    return "replace_block";
  }
  if (
    normalized === "insert_after" ||
    normalized === "insert" ||
    normalized === "append_after" ||
    normalized === "insertafter"
  ) {
    return "insert_after";
  }
  if (normalized === "delete_block" || normalized === "delete" || normalized === "remove" || normalized === "deleteblock") {
    return "delete_block";
  }

  return normalized;
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
    const normalizedOp = normalizeOpName(item.op ?? item.type ?? item.action ?? item.operation);
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
    const readNumber = (...candidates: Array<unknown>): number | undefined => {
      for (const value of candidates) {
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
      }
      return undefined;
    };
    const readPercent = (...candidates: Array<unknown>): number | undefined => {
      for (const value of candidates) {
        if (typeof value === "number" && Number.isFinite(value)) {
          return Math.max(10, Math.min(100, Math.round(value)));
        }
        if (typeof value === "string") {
          const m = value.match(/(\d+(?:\.\d+)?)/);
          if (m) {
            const n = Number(m[1]);
            if (Number.isFinite(n)) {
              return Math.max(10, Math.min(100, Math.round(n)));
            }
          }
        }
      }
      return undefined;
    };
    const readObject = (...candidates: Array<unknown>): Record<string, unknown> | undefined => {
      for (const value of candidates) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      }
      return undefined;
    };

    const rawStyle =
      (item.textStyle && typeof item.textStyle === "object" ? (item.textStyle as Record<string, unknown>) : null) ??
      (item.style && typeof item.style === "object" ? (item.style as Record<string, unknown>) : null);
    if (rawStyle) {
      const textStyle: Record<string, unknown> = {};
      const color = readString(rawStyle.color, rawStyle.textColor);
      const fontSize = readString(rawStyle.fontSize, rawStyle["font-size"], rawStyle.size);
      const fontWeight = readString(rawStyle.fontWeight, rawStyle["font-weight"], rawStyle.weight);
      const textAlign = readString(rawStyle.textAlign, rawStyle["text-align"], rawStyle.align);
      if (color) {
        textStyle.color = color;
      }
      if (fontSize) {
        textStyle.fontSize = fontSize;
      }
      if (fontWeight) {
        textStyle.fontWeight = fontWeight;
      }
      if (textAlign && ["left", "center", "right", "justify"].includes(textAlign)) {
        textStyle.textAlign = textAlign;
      }
      if (Object.keys(textStyle).length > 0) {
        next.textStyle = textStyle;
      }
    }

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

    if ((normalizedOp === "replace_block" || normalizedOp === "insert_after") && !next.block) {
      const nestedBlock = readObject(
        item.block,
        item.newBlock,
        item.new_block,
        item.payload,
        item.data,
        item.value
      );
      if (
        nestedBlock &&
        typeof nestedBlock.type === "string" &&
        typeof nestedBlock.id === "string"
      ) {
        next.block = nestedBlock;
      }
    }

    if ((normalizedOp === "replace_block" || normalizedOp === "insert_after") && !next.block) {
      const inlineType = readString(
        item.blockType,
        item.block_type,
        item.newType,
        item.new_type,
        item.type,
        block?.type
      );
      let inlineId = readString(
        block?.id,
        item.newId,
        item.new_id,
        item.insertId,
        item.insert_id,
        item.blockId,
        item.block_id,
        normalizedOp === "replace_block" ? next.id : undefined
      );

      if (!inlineId && inlineType === "chart") {
        inlineId = `chart_${Date.now()}`;
      }

      if (inlineType === "chart") {
        const option = readObject(
          item.option,
          item.chartOption,
          item.chart_option,
          item.echartsOption,
          item.echarts_option,
          item.chart,
          block?.option
        );
        if (inlineId && option) {
          const title = readString(item.title, block?.title);
          const height = readNumber(item.height, block?.height);
          next.block = {
            id: inlineId,
            type: "chart",
            ...(title ? { title } : {}),
            ...(height ? { height } : {}),
            option
          };
        }
      } else if (inlineType === "heading") {
        const text = readString(item.text, item.content, block?.text);
        const level = readNumber(item.level, block?.level);
        if (inlineId && text) {
          next.block = {
            id: inlineId,
            type: "heading",
            level: level === 2 || level === 3 ? level : 1,
            text
          };
        }
      } else if (inlineType === "paragraph") {
        const text = readString(item.text, item.content, block?.text);
        if (inlineId && text) {
          next.block = {
            id: inlineId,
            type: "paragraph",
            text
          };
        }
      } else if (inlineType === "divider") {
        if (inlineId) {
          next.block = {
            id: inlineId,
            type: "divider"
          };
        }
      } else if (inlineType === "image") {
        const src = readString(item.src, block?.src);
        if (inlineId && src) {
          const alt = readString(item.alt, block?.alt);
          const caption = readString(item.caption, block?.caption);
          const widthPercent = readPercent(item.widthPercent, item.width, item.size, block?.widthPercent);
          next.block = {
            id: inlineId,
            type: "image",
            src,
            ...(alt ? { alt } : {}),
            ...(caption ? { caption } : {}),
            ...(typeof widthPercent === "number" ? { widthPercent } : {})
          };
        }
      }
    }

    if ((normalizedOp === "replace_block" || normalizedOp === "insert_after") && !next.block) {
      const fallbackId = readString(next.id, next.afterId, item.id, item.afterId, target?.id);
      if (fallbackId) {
        next.op = "update_content";
        next.id = fallbackId;
        next.content = readString(item.content, item.text, "AI returned invalid block payload; fallback as text update.") ?? "AI returned invalid block payload.";
        delete next.afterId;
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

export function resolveModel(_baseUrl: string, provider?: ProviderKind): string {
  return process.env.DEFAULT_MODEL || (provider ? resolveDefaultModelByProvider(provider) : resolveDefaultModelByBaseUrl(_baseUrl));
}

export async function generatePatchWithDebug(
  config: LlmConfig,
  input: GeneratePatchInput
): Promise<{ patch: Patch; debug: PatchDebugInfo }> {
  const selectedBlocks = getSelectedBlocks(input.page, input.selectedBlockIds);
  const explicitProvider = normalizeProvider(config.provider);
  const fallbackBaseUrl =
    explicitProvider && explicitProvider !== "bigmodel"
      ? DEFAULT_BASE_URL_BY_PROVIDER[explicitProvider]
      : DEFAULT_BASE_URL_BY_PROVIDER.openai_compatible;
  const resolvedBaseUrl = config.baseUrl?.trim() || fallbackBaseUrl;
  const provider = explicitProvider ?? detectProvider(resolvedBaseUrl);
  const model = config.model?.trim() || resolveModel(resolvedBaseUrl, provider);
  const endpoint = resolveEndpoint(resolvedBaseUrl, provider, model);
  const timeoutMs = resolveTimeoutMs();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = [
    "You are a patch generator for a Block JSON editor.",
    'You must output strict JSON only: {"ops":[...]} with no extra characters.',
    "Do not output markdown, code fences, comments, or prose.",
    "Allowed ops are exactly: update_content, replace_block, insert_after, delete_block.",
    "Every target id/afterId must come from selectedBlockIds only.",
    'For image resize, use replace_block on image with widthPercent (10-100), e.g. {"type":"image","id":"...","src":"...","widthPercent":60}.',
    'You may create chart blocks only in insert_after/replace_block: {"type":"chart","id":"...","title":"...","height":360,"option":{...}}.',
    'You may create columns layout blocks: {"type":"columns","id":"...","gap":16,"columns":[{"id":"c1","blocks":[...]},{"id":"c2","blocks":[...]}]}',
    'You may create rich mixed-content blocks: {"type":"rich","id":"...","items":[{"kind":"text","text":"..."},{"kind":"image","src":"..."},{"kind":"chart","option":{...}}]}',
    "chart.option must be valid ECharts option JSON and must not contain functions.",
    "When user asks to visualize selected data, extract numeric values from selectedBlocks and build one chart block.",
    "For style edits (color/font-size/font-weight/alignment), use update_content.textStyle JSON object instead of HTML tags.",
    "update_content.content must be plain text unless user explicitly asks for markdown formatting.",
    "Never return full page HTML or full page JSON.",
    "If request cannot be fulfilled from provided content (for example transform table to chart without data),",
    "return one update_content op explaining the limitation instead of fabricating data."
  ].join("\n");

  const userPrompt = JSON.stringify(buildPromptPayload(input, selectedBlocks), null, 2);

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
    } else if (provider === "gemini" && !resolvedBaseUrl.toLowerCase().includes("/openai")) {
      requestInit.headers = {
        ...requestInit.headers,
        "x-goog-api-key": config.apiKey
      };
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
    } else if (provider === "gemini" && !resolvedBaseUrl.toLowerCase().includes("/openai")) {
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
    const patch = patchSchema.parse(normalizedPatch);
    return {
      patch,
      debug: {
        provider,
        endpoint,
        model,
        promptChars: userPrompt.length,
        selectedBlockCount: selectedBlocks.length,
        rawContent: content,
        parsed,
        normalized: normalizedPatch,
        validated: patch
      }
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generatePatch(config: LlmConfig, input: GeneratePatchInput): Promise<Patch> {
  const result = await generatePatchWithDebug(config, input);
  return result.patch;
}
