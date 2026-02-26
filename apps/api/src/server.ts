import cors from "@fastify/cors";
import Fastify from "fastify";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { applyPatch, astToBlocks, demoPage, patchSchema, type Page } from "@packages/blocks";
import { generatePatch, resolveModel, type LlmConfig } from "@packages/llm";
import { defaultTheme, renderToHtml } from "@packages/renderer";
import { mockAiGeneratePatch } from "./ai/mockAi";
import { parseDocxToAst } from "./docx/parseDocx";
import { generateSlug, sanitizeSlug } from "./utils/slug";
const multipart = require("@fastify/multipart");

type ExportManifest = {
  siteSlug: string;
  pageId: string;
  version: string;
  generatedAt: string;
  title?: string;
  entry: "index.html";
  assets: string[];
  urlPath: string;
  hostname?: string;
  deployRootDir?: string;
};

type ReportListItem = {
  siteSlug: string;
  urlPath: string;
  title: string | null;
  generatedAt: string;
  version: string | number;
  outDir: string;
  hostname: string | null;
};

const app = Fastify({ logger: true });
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const EXPORTS_ROOT = path.join(REPO_ROOT, "exports");
const PAGES_ROOT = path.join(REPO_ROOT, "data", "pages");
const UPLOADS_ROOT = path.join(REPO_ROOT, "uploads");
const DEFAULT_LLM_BASE_URL = "https://api.openai.com";
const MAX_DOCX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_HISTORY = 20;
const MAX_REPORTS = 200;

const pageCache = new Map<string, Page>();
const historyStackByPage = new Map<string, Page[]>();

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function readLlmConfigFromHeaders(headers: Record<string, string | string[] | undefined>): LlmConfig {
  const baseUrl = readHeaderValue(headers["x-llm-base-url"]).trim() || DEFAULT_LLM_BASE_URL;
  const requestedModel = readHeaderValue(headers["x-llm-model"]).trim();
  const apiKey = readHeaderValue(headers["x-llm-api-key"]).trim();
  return {
    baseUrl,
    model: requestedModel || resolveModel(baseUrl),
    apiKey
  };
}

function isPatchInSelectedScope(patch: ReturnType<typeof patchSchema.parse>, selectedBlockIds: string[]): boolean {
  const selectedSet = new Set(selectedBlockIds);
  return patch.ops.every((op) => (op.op === "insert_after" ? selectedSet.has(op.afterId) : selectedSet.has(op.id)));
}

function sanitizeBasePath(input: string): string | null {
  const value = input.trim();
  if (value === "") {
    return "";
  }
  if (!value.startsWith("/") || value.includes("..")) {
    return null;
  }
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(value)) {
    return null;
  }
  return value === "/" ? "/" : value.replace(/\/+$/, "");
}

function buildCaddySnippet(hostname: string, rootDir: string): string {
  return `${hostname} {\n  root * ${rootDir}\n  file_server\n}`;
}

function sanitizeUrlPath(input: string): string | null {
  const value = input.trim();
  if (!value.startsWith("/") || !value.endsWith("/")) {
    return null;
  }
  if (value.includes("//") || value.includes("..") || value.includes("%") || value.includes("\\")) {
    return null;
  }
  if (!/^\/[a-z0-9\-_\/]+\/$/.test(value)) {
    return null;
  }
  return value;
}

function sanitizeAbsolutePosixPath(input: string): string | null {
  const value = input.trim();
  if (!value.startsWith("/")) {
    return null;
  }
  if (value.includes("..") || value.includes("~") || /[\x00-\x1f]/.test(value)) {
    return null;
  }
  if (!/^\/[a-zA-Z0-9._\-\/]*$/.test(value)) {
    return null;
  }
  return path.posix.normalize(value).replace(/\/+$/, "") || "/";
}

function isPathInsideBase(baseDir: string, targetDir: string): boolean {
  return targetDir === baseDir || targetDir.startsWith(`${baseDir}/`);
}

function resolveRemoteRootDir(params: {
  remoteBaseDir?: string;
  urlPath?: string;
  remoteRootDir?: string;
}): { remoteBaseDir: string; remoteRootDir: string } | { error: string } {
  const baseInput = params.remoteBaseDir ?? "";
  const sanitizedBase = sanitizeAbsolutePosixPath(baseInput);
  if (!sanitizedBase) {
    return { error: "Invalid remoteBaseDir. Must be an absolute path without .. or ~." };
  }

  if (params.remoteRootDir && params.remoteRootDir.trim()) {
    const sanitizedRoot = sanitizeAbsolutePosixPath(params.remoteRootDir);
    if (!sanitizedRoot) {
      return { error: "Invalid remoteRootDir. Must be an absolute path without .. or ~." };
    }
    return { remoteBaseDir: sanitizedBase, remoteRootDir: sanitizedRoot };
  }

  const safeUrlPath = sanitizeUrlPath(params.urlPath ?? "");
  if (!safeUrlPath) {
    return { error: "Invalid urlPath. Expected format like /r/abcd1234/." };
  }

  const relative = safeUrlPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const computed = path.posix.normalize(path.posix.join(sanitizedBase, relative));
  if (!isPathInsideBase(sanitizedBase, computed)) {
    return { error: "Computed remoteRootDir escapes remoteBaseDir." };
  }
  return { remoteBaseDir: sanitizedBase, remoteRootDir: computed };
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe", shell: false });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function resolveLocalOutDir(localOutDir: string | undefined, siteSlug: string | undefined): string | null {
  if (typeof localOutDir === "string" && localOutDir.trim()) {
    const normalized = localOutDir.replace(/\\/g, "/");
    if (!normalized.startsWith("exports/") || normalized.includes("..")) {
      return null;
    }
    return normalized;
  }

  if (typeof siteSlug === "string" && siteSlug.trim()) {
    const normalized = siteSlug.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.includes("..")) {
      return null;
    }
    return `exports/${normalized}`;
  }
  return null;
}

function isValidPageId(pageId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(pageId);
}

function pageFilePath(pageId: string): string {
  return path.join(PAGES_ROOT, `${pageId}.json`);
}

async function loadPage(pageId: string): Promise<Page | null> {
  if (pageCache.has(pageId)) {
    return pageCache.get(pageId) ?? null;
  }

  if (pageId === "demo") {
    const page = structuredClone(demoPage);
    pageCache.set(pageId, page);
    return page;
  }

  try {
    const raw = await readFile(pageFilePath(pageId), "utf8");
    const page = JSON.parse(raw) as Page;
    pageCache.set(pageId, page);
    return page;
  } catch {
    return null;
  }
}

async function savePage(pageId: string, page: Page): Promise<void> {
  pageCache.set(pageId, page);
  await mkdir(PAGES_ROOT, { recursive: true });
  await writeFile(pageFilePath(pageId), JSON.stringify(page, null, 2), "utf8");
}

function pushHistory(pageId: string, page: Page): void {
  const stack = historyStackByPage.get(pageId) ?? [];
  stack.push(structuredClone(page));
  if (stack.length > MAX_HISTORY) {
    stack.shift();
  }
  historyStackByPage.set(pageId, stack);
}

function extractTitleFromHtml(html: string): string | null {
  const match = html.match(/<title>(.*?)<\/title>/i);
  return match?.[1]?.trim() || null;
}

async function collectManifestPaths(dir: string, bucket: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectManifestPaths(fullPath, bucket);
      continue;
    }
    if (entry.isFile() && entry.name === "manifest.json") {
      bucket.push(fullPath);
    }
  }
  return bucket;
}

async function writeAssets(outDir: string, css: string): Promise<string[]> {
  const assetsDir = path.join(outDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(outDir, "assets", "style.css"), css, "utf8");
  return ["assets/style.css"];
}

app.get("/api/page/demo", async () => {
  const page = await loadPage("demo");
  return page ?? demoPage;
});

app.get("/api/page/:pageId", async (request, reply) => {
  const { pageId } = request.params as { pageId: string };
  if (!isValidPageId(pageId)) {
    reply.code(400);
    return { ok: false, error: "Invalid pageId" };
  }

  const page = await loadPage(pageId);
  if (!page) {
    reply.code(404);
    return { ok: false, error: "Page not found" };
  }

  return page;
});

app.get("/api/reports", async (request) => {
  const query = request.query as { prefix?: string };
  const prefix = typeof query?.prefix === "string" ? query.prefix.trim() : "";
  const reports: ReportListItem[] = [];

  try {
    await access(EXPORTS_ROOT);
  } catch {
    return reports;
  }

  let manifestPaths: string[] = [];
  try {
    manifestPaths = await collectManifestPaths(EXPORTS_ROOT);
  } catch (error) {
    app.log.error(error);
    return reports;
  }

  for (const manifestPath of manifestPaths) {
    try {
      const raw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw) as ExportManifest;
      if (!manifest.siteSlug || !manifest.urlPath || !manifest.generatedAt) {
        continue;
      }
      if (prefix && !manifest.urlPath.startsWith(prefix)) {
        continue;
      }

      let title = typeof manifest.title === "string" && manifest.title.trim() ? manifest.title.trim() : null;
      if (!title) {
        try {
          const html = await readFile(path.join(path.dirname(manifestPath), "index.html"), "utf8");
          title = extractTitleFromHtml(html);
        } catch {
          title = null;
        }
      }

      const outDir = path.relative(REPO_ROOT, path.dirname(manifestPath)).replace(/\\/g, "/");
      reports.push({
        siteSlug: manifest.siteSlug,
        urlPath: manifest.urlPath,
        title,
        generatedAt: manifest.generatedAt,
        version: manifest.version,
        outDir,
        hostname: typeof manifest.hostname === "string" && manifest.hostname.trim() ? manifest.hostname : null
      });
    } catch (error) {
      app.log.warn({ manifestPath, error }, "Skipping invalid manifest");
    }
  }

  reports.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  return reports.slice(0, MAX_REPORTS);
});

app.post("/api/import/docx", async (request, reply) => {
  const filePart = await (request as unknown as { file: () => Promise<any> }).file();
  if (!filePart) {
    reply.code(400);
    return { ok: false, error: "file is required" };
  }

  const originalName = filePart.filename || "upload.docx";
  const isDocx = originalName.toLowerCase().endsWith(".docx");
  if (!isDocx) {
    reply.code(400);
    return { ok: false, error: "Only .docx is supported" };
  }

  const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const uploadPath = path.join(UPLOADS_ROOT, `${Date.now()}_${safeName}`);

  try {
    await mkdir(UPLOADS_ROOT, { recursive: true });
    await pipeline(filePart.file, createWriteStream(uploadPath));

    const ast = await parseDocxToAst(uploadPath);
    const blocks = astToBlocks(ast);
    if (blocks.length === 0) {
      reply.code(400);
      return { ok: false, error: "No content extracted from docx" };
    }

    const firstHeading = ast.find((node) => node.type === "heading" && node.level === 1);
    const fallbackTitle = path.basename(originalName, path.extname(originalName));
    const title = firstHeading && firstHeading.type === "heading" ? firstHeading.text.trim() : fallbackTitle || "Imported Document";
    const pageId = `p_${Date.now()}_${generateSlug(6)}`;

    const page: Page = {
      id: pageId,
      title,
      blocks
    };

    await savePage(pageId, page);
    historyStackByPage.set(pageId, []);

    return { ok: true, pageId, page };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      reply.code(413);
      return { ok: false, error: `File too large. Max size is ${Math.floor(MAX_DOCX_UPLOAD_BYTES / (1024 * 1024))}MB` };
    }
    reply.code(500);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Import failed"
    };
  }
});

app.post("/api/patch/demo", async (request, reply) => {
  const body = request.body;
  if (typeof body !== "object" || body === null) {
    reply.code(400);
    return { ok: false, error: "Invalid request body" };
  }

  const { pageId, selectedBlockIds, instruction } = body as {
    pageId?: unknown;
    selectedBlockIds?: unknown;
    instruction?: unknown;
  };

  const targetPageId = typeof pageId === "string" && pageId.trim() ? pageId : "demo";
  if (!isValidPageId(targetPageId)) {
    reply.code(400);
    return { ok: false, error: "Invalid pageId" };
  }

  if (!Array.isArray(selectedBlockIds) || selectedBlockIds.length === 0 || !selectedBlockIds.every((id) => typeof id === "string")) {
    reply.code(400);
    return { ok: false, error: "selectedBlockIds must be a non-empty string array" };
  }
  if (typeof instruction !== "string") {
    reply.code(400);
    return { ok: false, error: "instruction must be a string" };
  }

  const page = await loadPage(targetPageId);
  if (!page) {
    reply.code(404);
    return { ok: false, error: "Page not found" };
  }

  try {
    const useMockAi = process.env.USE_MOCK_AI === "true";
    const llmConfig = readLlmConfigFromHeaders(request.headers as Record<string, string | string[] | undefined>);
    if (!useMockAi && !llmConfig.apiKey) {
      reply.code(400);
      return { ok: false, error: "Missing API key. Please set AI Settings first." };
    }

    const rawPatch = useMockAi
      ? mockAiGeneratePatch(page, selectedBlockIds, instruction)
      : await generatePatch(llmConfig, { page, selectedBlockIds, instruction });
    const patch = patchSchema.parse(rawPatch);

    if (!isPatchInSelectedScope(patch, selectedBlockIds)) {
      reply.code(400);
      return { ok: false, error: "Patch target out of selected scope" };
    }

    const newPage = applyPatch(page, patch);
    pushHistory(targetPageId, page);
    await savePage(targetPageId, newPage);

    return { ok: true, patch, page: newPage };
  } catch (error) {
    reply.code(400);
    return { ok: false, error: error instanceof Error ? error.message : "Failed to apply patch" };
  }
});

app.post("/api/undo/demo", async (request) => {
  const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as { pageId?: string };
  const targetPageId = body.pageId && body.pageId.trim() ? body.pageId : "demo";
  const stack = historyStackByPage.get(targetPageId) ?? [];
  const previousPage = stack.pop();
  historyStackByPage.set(targetPageId, stack);

  if (!previousPage) {
    return { ok: false, error: "Nothing to undo" };
  }

  await savePage(targetPageId, previousPage);
  return { ok: true, page: previousPage };
});

app.post("/api/export", async (request, reply) => {
  const body = request.body;
  if (typeof body !== "object" || body === null) {
    reply.code(400);
    return { ok: false, error: "Invalid request body" };
  }

  const { pageId, siteSlug, basePath, hostname, serverRootDir } = body as {
    pageId?: unknown;
    siteSlug?: unknown;
    basePath?: unknown;
    hostname?: unknown;
    serverRootDir?: unknown;
  };

  if (typeof pageId !== "string" || !pageId.trim() || !isValidPageId(pageId)) {
    reply.code(400);
    return { ok: false, error: "pageId is required" };
  }

  const page = await loadPage(pageId);
  if (!page) {
    reply.code(404);
    return { ok: false, error: `Page not found: ${pageId}` };
  }

  const hasCustomSiteSlug = typeof siteSlug === "string" && siteSlug.trim() !== "";
  const normalizedSlug = hasCustomSiteSlug ? sanitizeSlug(siteSlug as string) : generateSlug(8);
  if (!normalizedSlug) {
    reply.code(400);
    return { ok: false, error: "Invalid siteSlug. Only [a-z0-9-_] is allowed." };
  }

  const urlPath = hasCustomSiteSlug ? `/${normalizedSlug}/` : `/r/${normalizedSlug}/`;
  const slugPath = hasCustomSiteSlug ? normalizedSlug : path.join("r", normalizedSlug);
  const requestedBasePath = typeof basePath === "string" ? basePath : "";
  const basePathInput = requestedBasePath.trim() ? requestedBasePath : urlPath.slice(0, -1);
  const safeBasePath = sanitizeBasePath(basePathInput);
  if (safeBasePath === null) {
    reply.code(400);
    return { ok: false, error: "Invalid basePath. Use empty string or path like /docs." };
  }

  const safeHostname = typeof hostname === "string" ? hostname.trim() : "";
  const rootDir = typeof serverRootDir === "string" && serverRootDir.trim() ? serverRootDir.trim() : "/var/www";

  try {
    const outDirAbs = path.join(EXPORTS_ROOT, slugPath);
    const outDirRel = path.join("exports", slugPath).replace(/\\/g, "/");
    const { html, css } = renderToHtml(page, defaultTheme, { basePath: safeBasePath });

    await mkdir(outDirAbs, { recursive: true });
    await writeFile(path.join(outDirAbs, "index.html"), html, "utf8");
    const assets = await writeAssets(outDirAbs, css);

    const manifest: ExportManifest = {
      siteSlug: hasCustomSiteSlug ? normalizedSlug : `r/${normalizedSlug}`,
      pageId,
      version: String(Date.now()),
      generatedAt: new Date().toISOString(),
      title: page.title,
      entry: "index.html",
      assets,
      urlPath,
      ...(safeHostname ? { hostname: safeHostname } : {}),
      ...(rootDir ? { deployRootDir: rootDir } : {})
    };

    await writeFile(path.join(outDirAbs, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    return {
      ok: true,
      outDir: outDirRel,
      urlPath,
      manifest,
      caddySnippet: safeHostname ? buildCaddySnippet(safeHostname, rootDir) : null
    };
  } catch (error) {
    reply.code(500);
    return { ok: false, error: error instanceof Error ? error.message : "Export failed" };
  }
});

app.post("/api/deploy", async (request, reply) => {
  const body = request.body;
  if (typeof body !== "object" || body === null) {
    reply.code(400);
    return { ok: false, error: "Invalid request body" };
  }

  const { siteSlug, urlPath, localOutDir, remoteBaseDir, remoteRootDir, hostname, server } = body as {
    siteSlug?: unknown;
    urlPath?: unknown;
    localOutDir?: unknown;
    remoteBaseDir?: unknown;
    remoteRootDir?: unknown;
    hostname?: unknown;
    server?: unknown;
  };

  if (typeof server !== "object" || server === null) {
    reply.code(400);
    return { ok: false, error: "server is required" };
  }

  const { host, user, port, privateKeyPath } = server as {
    host?: unknown;
    user?: unknown;
    port?: unknown;
    privateKeyPath?: unknown;
  };

  if (typeof host !== "string" || !host.trim() || typeof user !== "string" || !user.trim()) {
    reply.code(400);
    return { ok: false, error: "server.host and server.user are required" };
  }

  const localOutDirRel = resolveLocalOutDir(
    typeof localOutDir === "string" ? localOutDir : undefined,
    typeof siteSlug === "string" ? siteSlug : undefined
  );
  if (!localOutDirRel) {
    reply.code(400);
    return { ok: false, error: "Invalid localOutDir/siteSlug. Must resolve under exports/." };
  }

  const localOutDirAbs = path.resolve(REPO_ROOT, localOutDirRel);
  const normalizedExportsRoot = EXPORTS_ROOT.replace(/\\/g, "/");
  const normalizedLocalOutDir = localOutDirAbs.replace(/\\/g, "/");
  if (!normalizedLocalOutDir.startsWith(normalizedExportsRoot)) {
    reply.code(400);
    return { ok: false, error: "localOutDir must stay within exports/." };
  }

  try {
    await access(localOutDirAbs);
  } catch {
    reply.code(400);
    return { ok: false, error: `Local output directory not found: ${localOutDirRel}` };
  }

  const resolved = resolveRemoteRootDir({
    remoteBaseDir: typeof remoteBaseDir === "string" ? remoteBaseDir : "/var/www/reports",
    urlPath: typeof urlPath === "string" ? urlPath : undefined,
    remoteRootDir: typeof remoteRootDir === "string" ? remoteRootDir : undefined
  });

  if ("error" in resolved) {
    reply.code(400);
    return { ok: false, error: resolved.error };
  }

  const sshTarget = `${user.trim()}@${host.trim()}`;
  const sshPort = typeof port === "number" && Number.isInteger(port) ? String(port) : "22";
  const sshArgs = ["-p", sshPort];
  const scpArgs = ["-P", sshPort];

  if (typeof privateKeyPath === "string" && privateKeyPath.trim()) {
    sshArgs.push("-i", privateKeyPath.trim());
    scpArgs.push("-i", privateKeyPath.trim());
  }

  try {
    await runCommand("ssh", [...sshArgs, sshTarget, `mkdir -p ${resolved.remoteRootDir}`]);
    await runCommand("scp", [...scpArgs, "-r", `${localOutDirAbs}/.`, `${sshTarget}:${resolved.remoteRootDir}/`]);

    const safeUrlPath = sanitizeUrlPath(typeof urlPath === "string" ? urlPath : "") ?? "/";
    const remoteUrl = typeof hostname === "string" && hostname.trim() ? `https://${hostname.trim()}${safeUrlPath}` : null;

    return {
      ok: true,
      remoteRootDir: resolved.remoteRootDir,
      remoteUrl
    };
  } catch (error) {
    reply.code(500);
    return { ok: false, error: error instanceof Error ? error.message : "Deploy failed" };
  }
});

const start = async (): Promise<void> => {
  try {
    await app.register(cors, {
      origin: ["http://localhost:3000"],
      allowedHeaders: ["Content-Type", "x-llm-base-url", "x-llm-model", "x-llm-api-key"]
    });
    await app.register(multipart, {
      limits: {
        fileSize: MAX_DOCX_UPLOAD_BYTES
      },
      throwFileSizeLimit: true
    });

    await app.listen({ port: 3001, host: "0.0.0.0" });
    app.log.info("API server listening on http://localhost:3001");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
