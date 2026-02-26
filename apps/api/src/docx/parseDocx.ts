import type { AstNode } from "@packages/blocks";
const mammoth = require("mammoth") as {
  convertToHtml(input: { path: string }): Promise<{ value: string }>;
};

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = trRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const text = stripTags(cellMatch[2]);
      cells.push(text);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

function parseListItems(listHtml: string): string[] {
  const items: string[] = [];
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = liRegex.exec(listHtml)) !== null) {
    const text = stripTags(match[1]);
    if (text) {
      items.push(text);
    }
  }

  return items;
}

export async function parseDocxToAst(filePath: string): Promise<AstNode[]> {
  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const astNodes: AstNode[] = [];
  const blockRegex = /<(h1|h2|h3|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1];
    const blockHtml = match[0];

    if (!tag) {
      const srcMatch = blockHtml.match(/\bsrc="([^"]*)"/i);
      astNodes.push({
        type: "image",
        src: srcMatch?.[1],
        placeholder: "Imported image"
      });
      continue;
    }

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const text = stripTags(match[2] ?? "");
      if (!text) {
        continue;
      }
      astNodes.push({
        type: "heading",
        level: Number(tag[1]) as 1 | 2 | 3,
        text
      });
      continue;
    }

    if (tag === "p") {
      astNodes.push({
        type: "paragraph",
        text: stripTags(match[2] ?? "")
      });
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      astNodes.push({
        type: "list",
        items: parseListItems(match[2] ?? "")
      });
      continue;
    }

    if (tag === "table") {
      astNodes.push({
        type: "table",
        rows: parseRows(match[2] ?? "")
      });
    }
  }

  return astNodes;
}
