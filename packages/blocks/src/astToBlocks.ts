import type { Block } from "./index";
import type { AstNode } from "./types/ast";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function astToBlocks(astNodes: AstNode[]): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  let lastWasEmptyParagraph = false;

  for (const node of astNodes) {
    if (node.type === "heading") {
      const text = normalizeText(node.text);
      if (!text) {
        continue;
      }
      blocks.push({
        id: `b-${cursor++}`,
        type: "heading",
        level: node.level,
        text
      });
      lastWasEmptyParagraph = false;
      continue;
    }

    if (node.type === "paragraph") {
      const text = normalizeText(node.text);
      if (!text) {
        if (!lastWasEmptyParagraph) {
          lastWasEmptyParagraph = true;
        }
        continue;
      }

      blocks.push({
        id: `b-${cursor++}`,
        type: "paragraph",
        text
      });
      lastWasEmptyParagraph = false;
      continue;
    }

    if (node.type === "list") {
      for (const item of node.items) {
        const text = normalizeText(item);
        if (!text) {
          continue;
        }
        blocks.push({
          id: `b-${cursor++}`,
          type: "paragraph",
          text: `- ${text}`
        });
      }
      lastWasEmptyParagraph = false;
      continue;
    }

    if (node.type === "table") {
      for (const row of node.rows) {
        const rowText = row.map((cell) => normalizeText(cell)).filter(Boolean).join(" | ");
        if (!rowText) {
          continue;
        }
        blocks.push({
          id: `b-${cursor++}`,
          type: "paragraph",
          text: rowText
        });
      }
      lastWasEmptyParagraph = false;
      continue;
    }

    const caption = normalizeText(node.placeholder ?? "");
    blocks.push({
      id: `b-${cursor++}`,
      type: "image",
      src: node.src ?? "",
      ...(caption ? { caption } : {})
    });
    lastWasEmptyParagraph = false;
  }

  return blocks;
}
