import type { AstNode } from "@packages/blocks";
const mammoth = require("mammoth") as {
  convertToHtml(
    input: { path: string },
    options?: {
      styleMap?: string[];
    }
  ): Promise<{ value: string }>;
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

function extractImageSrc(imgTag: string): string | undefined {
  const quotedMatch = imgTag.match(/\bsrc\s*=\s*(['"])([\s\S]*?)\1/i);
  if (quotedMatch?.[2]) {
    return decodeEntities(quotedMatch[2].trim());
  }

  const unquotedMatch = imgTag.match(/\bsrc\s*=\s*([^\s>]+)/i);
  if (unquotedMatch?.[1]) {
    return decodeEntities(unquotedMatch[1].trim());
  }

  return undefined;
}

function extractImages(inputHtml: string): AstNode[] {
  const result: AstNode[] = [];
  const imgRegex = /<img\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(inputHtml)) !== null) {
    const src = extractImageSrc(match[0]);
    result.push({
      type: "image",
      src,
      placeholder: "Imported image"
    });
  }

  return result;
}

function detectParagraphHeadingLevel(paragraphHtml: string): 1 | 2 | 3 | null {
  const classMatch = paragraphHtml.match(/\bclass\s*=\s*(['"])([\s\S]*?)\1/i);
  const classValue = classMatch?.[2] ?? "";
  const levelMatch = classValue.match(/(?:heading|title|标题)\s*([1-6])/i);

  if (levelMatch?.[1]) {
    const level = Number(levelMatch[1]);
    if (Number.isFinite(level)) {
      return Math.max(1, Math.min(3, level)) as 1 | 2 | 3;
    }
  }

  return null;
}

function detectHeadingLevelByText(text: string): 1 | 2 | 3 | null {
  const normalized = text.trim();
  if (!normalized || normalized.length > 80) {
    return null;
  }

  if (/^[一二三四五六七八九十]+[、.．]/.test(normalized)) {
    return 1;
  }
  if (/^\d+\.\d+\.\d+/.test(normalized)) {
    return 3;
  }
  if (/^\d+\.\d+/.test(normalized)) {
    return 2;
  }
  if (/^\d+[、.．)]/.test(normalized)) {
    return 1;
  }

  return null;
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
  const { value: html } = await mammoth.convertToHtml(
    { path: filePath },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='标题 1'] => h1:fresh",
        "p[style-name='标题 2'] => h2:fresh",
        "p[style-name='标题 3'] => h3:fresh"
      ]
    }
  );
  const astNodes: AstNode[] = [];
  const blockRegex = /<(h1|h2|h3|h4|h5|h6|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*\/?>/gi;
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

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      const text = stripTags(match[2] ?? "");
      if (!text) {
        continue;
      }
      const rawLevel = Number(tag[1]);
      astNodes.push({
        type: "heading",
        level: Math.max(1, Math.min(3, rawLevel)) as 1 | 2 | 3,
        text
      });
      continue;
    }

    if (tag === "p") {
      const contentHtml = match[2] ?? "";
      astNodes.push(...extractImages(contentHtml));
      const text = stripTags(contentHtml.replace(/<img\b[^>]*\/?>/gi, " "));
      const inferredHeadingLevel = detectParagraphHeadingLevel(blockHtml) ?? detectHeadingLevelByText(text);
      if (inferredHeadingLevel && text) {
        astNodes.push({
          type: "heading",
          level: inferredHeadingLevel,
          text
        });
        continue;
      }

      astNodes.push({
        type: "paragraph",
        text
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
