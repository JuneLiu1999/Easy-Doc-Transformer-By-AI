import type { Block, Page } from "@packages/blocks";

export interface Theme {
  fontFamily: string;
  textColor: string;
  headingColor: string;
  paragraphSpacing: string;
  maxWidth: string;
  background: string;
}

export interface RenderOptions {
  basePath?: string;
}

export const defaultTheme: Theme = {
  fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  textColor: "#1f2937",
  headingColor: "#111827",
  paragraphSpacing: "14px",
  maxWidth: "760px",
  background: "#f8fafc"
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBlock(block: Block): string {
  if (block.type === "heading") {
    const level = Math.max(1, Math.min(3, block.level));
    return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
  }

  if (block.type === "paragraph") {
    return `<p>${escapeHtml(block.text)}</p>`;
  }

  if (block.type === "divider") {
    return "<hr />";
  }

  if (block.type === "image") {
    const alt = escapeHtml(block.alt ?? "");
    const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
    return `<figure><img src="${escapeHtml(block.src)}" alt="${alt}" />${caption}</figure>`;
  }

  return "";
}

function buildCss(theme: Theme): string {
  return `:root {
  --font-family: ${theme.fontFamily};
  --text-color: ${theme.textColor};
  --heading-color: ${theme.headingColor};
  --paragraph-spacing: ${theme.paragraphSpacing};
  --content-width: ${theme.maxWidth};
  --page-bg: ${theme.background};
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-family);
  color: var(--text-color);
  background: var(--page-bg);
}
main {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 40px 20px;
  line-height: 1.65;
}
h1,h2,h3 {
  color: var(--heading-color);
  margin: 0 0 16px;
}
p {
  margin: 0 0 var(--paragraph-spacing);
}
hr {
  border: none;
  border-top: 1px solid #d1d5db;
  margin: 20px 0;
}
figure {
  margin: 20px 0;
}
img {
  max-width: 100%;
}
figcaption {
  color: #6b7280;
  font-size: 14px;
}`;
}

function buildCssHref(basePath?: string): string {
  if (!basePath) {
    return "./assets/style.css";
  }

  const normalized = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  return `${normalized}/assets/style.css`;
}

export function renderToHtml(page: Page, theme: Theme = defaultTheme, options: RenderOptions = {}): { html: string; css: string } {
  const css = buildCss(theme);
  const blocksHtml = page.blocks.map(renderBlock).join("\n");
  const cssHref = buildCssHref(options.basePath);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <link rel="stylesheet" href="${cssHref}" />
</head>
<body>
  <main>
    ${blocksHtml}
  </main>
</body>
</html>`;

  return { html, css };
}
