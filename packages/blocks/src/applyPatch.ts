import type { Block, Page, RichItem } from "./index";
import type { Patch } from "./types/patch";

function findBlockLocation(blocks: Block[], id: string): { arr: Block[]; index: number } | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.id === id) {
      return { arr: blocks, index: i };
    }
    if (block.type === "columns") {
      for (const column of block.columns) {
        const nested = findBlockLocation(column.blocks, id);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return null;
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function parseStyleDeclaration(styleValue: string): {
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
} {
  const style: {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    textAlign?: "left" | "center" | "right" | "justify";
  } = {};
  const declarations = styleValue.split(";");

  for (const declaration of declarations) {
    const [rawKey, rawValue] = declaration.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();
    if (!key || !value) {
      continue;
    }

    if (key === "color") {
      style.color = value;
      continue;
    }
    if (key === "font-size") {
      style.fontSize = value;
      continue;
    }
    if (key === "font-weight") {
      style.fontWeight = value;
      continue;
    }
    if (key === "text-align" && (value === "left" || value === "center" || value === "right" || value === "justify")) {
      style.textAlign = value;
    }
  }

  return style;
}

function extractTextAndStyle(content: string): {
  text: string;
  textStyle?: {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    textAlign?: "left" | "center" | "right" | "justify";
  };
} {
  const spanStyleMatch = content.match(/<span\b[^>]*\bstyle=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/i);
  if (!spanStyleMatch) {
    return { text: content };
  }

  const text = stripHtmlTags(spanStyleMatch[2] ?? "");
  const textStyle = parseStyleDeclaration(spanStyleMatch[1] ?? "");
  if (!text) {
    return { text: stripHtmlTags(content) };
  }
  if (Object.keys(textStyle).length === 0) {
    return { text };
  }

  return { text, textStyle };
}

function mergeStyle(
  current: {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    textAlign?: "left" | "center" | "right" | "justify";
  } | undefined,
  incoming:
    | {
        color?: string;
        fontSize?: string;
        fontWeight?: string;
        textAlign?: "left" | "center" | "right" | "justify";
      }
    | undefined
): {
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
} | undefined {
  if (!current && !incoming) {
    return undefined;
  }

  const merged = { ...(current ?? {}), ...(incoming ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function updateFirstRichTextItem(items: RichItem[], text: string): RichItem[] {
  const idx = items.findIndex((item) => item.kind === "text");
  if (idx < 0) {
    return [...items, { kind: "text", text }];
  }
  const next = [...items];
  next[idx] = { kind: "text", text };
  return next;
}

function updateBlockContent(
  block: Block,
  content: string,
  explicitStyle?:
    | {
        color?: string;
        fontSize?: string;
        fontWeight?: string;
        textAlign?: "left" | "center" | "right" | "justify";
      }
    | undefined
): Block {
  const parsed = extractTextAndStyle(content);
  const nextStyle = mergeStyle(parsed.textStyle, explicitStyle);

  if (block.type === "heading" || block.type === "paragraph") {
    return {
      ...block,
      text: parsed.text,
      ...(nextStyle ? { textStyle: nextStyle } : {})
    };
  }

  if (block.type === "image") {
    return { ...block, caption: parsed.text };
  }

  if (block.type === "rich") {
    return {
      ...block,
      items: updateFirstRichTextItem(block.items, parsed.text)
    };
  }

  throw new Error(`Block "${block.id}" does not support content updates`);
}

export function applyPatch(page: Page, patch: Patch): Page {
  const blocks = structuredClone(page.blocks) as Block[];

  for (const op of patch.ops) {
    if (op.op === "update_content") {
      const loc = findBlockLocation(blocks, op.id);
      if (!loc) {
        throw new Error(`Block id not found: ${op.id}`);
      }
      loc.arr[loc.index] = updateBlockContent(loc.arr[loc.index], op.content, op.textStyle);
      continue;
    }

    if (op.op === "replace_block") {
      const loc = findBlockLocation(blocks, op.id);
      if (!loc) {
        throw new Error(`Block id not found: ${op.id}`);
      }
      loc.arr[loc.index] = op.block;
      continue;
    }

    if (op.op === "insert_after") {
      const loc = findBlockLocation(blocks, op.afterId);
      if (!loc) {
        throw new Error(`Block id not found: ${op.afterId}`);
      }
      loc.arr.splice(loc.index + 1, 0, op.block);
      continue;
    }

    const loc = findBlockLocation(blocks, op.id);
    if (!loc) {
      throw new Error(`Block id not found: ${op.id}`);
    }
    loc.arr.splice(loc.index, 1);
  }

  return {
    ...page,
    blocks
  };
}
