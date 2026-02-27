import type { Block, Page, RichItem } from "@packages/blocks";

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

function buildTextStyleAttr(style: { color?: string; fontSize?: string; fontWeight?: string; textAlign?: "left" | "center" | "right" | "justify" } | undefined): string {
  if (!style) {
    return "";
  }

  const declarations: string[] = [];
  if (style.color) {
    declarations.push(`color:${style.color}`);
  }
  if (style.fontSize) {
    declarations.push(`font-size:${style.fontSize}`);
  }
  if (style.fontWeight) {
    declarations.push(`font-weight:${style.fontWeight}`);
  }
  if (style.textAlign) {
    declarations.push(`text-align:${style.textAlign}`);
  }

  if (declarations.length === 0) {
    return "";
  }

  return ` style="${escapeHtml(declarations.join(";"))}"`;
}

function renderChart(option: Record<string, unknown>, title?: string, height?: number): string {
  const finalHeight = typeof height === "number" ? Math.max(240, Math.min(1200, height)) : 360;
  const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
  const encodedOption = escapeHtml(JSON.stringify(option));
  return `<figure class="chart-block"><div class="chart-canvas" data-echarts-option="${encodedOption}" style="height:${finalHeight}px"></div>${caption}</figure>`;
}

function renderRichItem(item: RichItem): string {
  if (item.kind === "text") {
    return `<p>${escapeHtml(item.text)}</p>`;
  }
  if (item.kind === "image") {
    const alt = escapeHtml(item.alt ?? "");
    const caption = item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : "";
    const widthPercent = typeof item.widthPercent === "number" ? Math.max(10, Math.min(100, item.widthPercent)) : 100;
    return `<figure><img src="${escapeHtml(item.src)}" alt="${alt}" style="width:${widthPercent}%;" />${caption}</figure>`;
  }
  return renderChart(item.option, item.title, item.height);
}

function renderBlock(block: Block): string {
  if (block.type === "heading") {
    const level = Math.max(1, Math.min(3, block.level));
    return `<h${level}${buildTextStyleAttr(block.textStyle)}>${escapeHtml(block.text)}</h${level}>`;
  }

  if (block.type === "paragraph") {
    return `<p${buildTextStyleAttr(block.textStyle)}>${escapeHtml(block.text)}</p>`;
  }

  if (block.type === "divider") {
    return "<hr />";
  }

  if (block.type === "image") {
    const alt = escapeHtml(block.alt ?? "");
    const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
    const widthPercent = typeof block.widthPercent === "number" ? Math.max(10, Math.min(100, block.widthPercent)) : 100;
    return `<figure><img src="${escapeHtml(block.src)}" alt="${alt}" style="width:${widthPercent}%;" />${caption}</figure>`;
  }

  if (block.type === "chart") {
    return renderChart(block.option, block.title, block.height);
  }

  if (block.type === "rich") {
    return `<section class="rich-block">${block.items.map(renderRichItem).join("\n")}</section>`;
  }

  const gap = typeof block.gap === "number" ? Math.max(8, Math.min(80, block.gap)) : 16;
  const cols = block.columns.length || 1;
  const columnsHtml = block.columns
    .map((column) => `<div class="columns-col" data-col-id="${escapeHtml(column.id)}">${column.blocks.map(renderBlock).join("\n")}</div>`)
    .join("\n");
  return `<section class="columns-block" style="--columns-count:${cols};--columns-gap:${gap}px">${columnsHtml}</section>`;
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
}
.rich-block {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px;
  background: #ffffff;
  margin: 18px 0;
}
.chart-block {
  margin: 24px 0;
}
.chart-canvas {
  width: 100%;
  min-height: 240px;
}
.columns-block {
  display: grid;
  grid-template-columns: repeat(var(--columns-count), minmax(0, 1fr));
  gap: var(--columns-gap);
  margin: 20px 0;
}
.columns-col {
  min-width: 0;
}
@media (max-width: 960px) {
  .columns-block {
    grid-template-columns: 1fr;
  }
}`;
}

function buildCssHref(basePath?: string): string {
  if (!basePath) {
    return "./assets/style.css";
  }

  const normalized = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  return `${normalized}/assets/style.css`;
}

function buildChartScript(basePath?: string): string {
  const normalized = !basePath || basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const echartsSrc = `${normalized}/assets/echarts.min.js`;
  return `<script src="${echartsSrc}"></script>
  <script>
    (function () {
      function safeParse(value) {
        try {
          return JSON.parse(value);
        } catch (_err) {
          return null;
        }
      }
      function renderCharts() {
        if (!window.echarts) {
          window.setTimeout(renderCharts, 250);
          return;
        }
        var nodes = document.querySelectorAll('[data-echarts-option]');
        for (var i = 0; i < nodes.length; i += 1) {
          var node = nodes[i];
          if (!(node instanceof HTMLElement) || node.dataset.chartReady === '1') {
            continue;
          }
          var option = safeParse(node.getAttribute('data-echarts-option') || '');
          if (!option) {
            continue;
          }
          var chart = window.echarts.init(node);
          chart.setOption(option);
          node.dataset.chartReady = '1';
          window.addEventListener('resize', function () { chart.resize(); });
        }
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderCharts);
      } else {
        renderCharts();
      }
    })();
  </script>`;
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
  ${buildChartScript(options.basePath)}
</head>
<body>
  <main>
    ${blocksHtml}
  </main>
</body>
</html>`;

  return { html, css };
}
