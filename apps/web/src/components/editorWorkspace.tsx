"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Block, Page } from "@packages/blocks";
import { useBlockSelection } from "@packages/editor";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.trim() ||
  (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");
const LLM_SETTINGS_KEY = "demo.llm.settings";
const DEFAULT_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_PROVIDER = "openai_compatible";
const GEMINI_FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];
const OPTIMIZE_LAYOUT_PROMPT =
  "请在不改变核心事实与结论的前提下，优化当前网页内容的排版布局和数据表达。要求：1) 建立清晰标题层级；2) 将冗长段落拆分为可读短段；3) 将可结构化的数据改写为列表或表格化表达（若无法用表格，则用条目化）；4) 保持专业、简洁、可读。仅返回可执行 patch。";

type ProviderType = "openai_compatible" | "gemini" | "anthropic";

type LlmSettings = {
  provider: ProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ExportManifest = {
  siteSlug: string;
  pageId: string;
  version: string;
  generatedAt: string;
  title?: string;
  entry: string;
  assets: string[];
  urlPath: string;
  hostname?: string;
  deployRootDir?: string;
};

type ExportResult = {
  outDir: string;
  urlPath: string;
  manifest: ExportManifest;
  caddySnippet: string | null;
};

type DeployResult = {
  remoteRootDir: string;
  remoteUrl: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ProviderVerifyResponse =
  | {
      ok: true;
      models: string[];
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

type SidebarModule = "upload" | "edit" | "ai" | "publish";
type ApiHealthStatus = "checking" | "ok" | "error";

type EchartsInstanceLike = {
  setOption: (option: Record<string, unknown>) => void;
  resize: () => void;
  dispose: () => void;
};

type EchartsLike = {
  init: (element: HTMLDivElement) => EchartsInstanceLike;
};

declare global {
  interface Window {
    echarts?: EchartsLike;
    __echartsLoadingPromise?: Promise<void>;
  }
}

function ensureEchartsLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.echarts) {
    return Promise.resolve();
  }
  if (window.__echartsLoadingPromise) {
    return window.__echartsLoadingPromise;
  }

  window.__echartsLoadingPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load echarts script"));
    document.head.appendChild(script);
  });

  return window.__echartsLoadingPromise;
}

function ChartCanvas({ option, height }: { option: Record<string, unknown>; height?: number }) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = chartRef.current;
    if (!node) {
      return;
    }

    let chart: EchartsInstanceLike | null = null;
    const onResize = () => {
      chart?.resize();
    };

    void ensureEchartsLoaded()
      .then(() => {
        if (!window.echarts || !chartRef.current) {
          return;
        }
        chart = window.echarts.init(chartRef.current);
        chart.setOption(option);
        window.addEventListener("resize", onResize);
      })
      .catch(() => {
        // Fallback keeps an empty chart area when CDN is unavailable.
      });

    return () => {
      window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
  }, [option]);

  const finalHeight = typeof height === "number" ? Math.max(240, Math.min(1200, height)) : 360;
  return <div ref={chartRef} className="preview-chart-canvas" style={{ height: `${finalHeight}px` }} />;
}

function BlockView({
  block,
  selectedSet,
  currentEditingBlockId,
  isEditMode,
  editingText,
  editSaving,
  onStartEdit,
  onEditingTextChange,
  onSaveEdit,
  onCancelEdit
}: {
  block: Block;
  selectedSet: Set<string>;
  currentEditingBlockId: string | null;
  isEditMode: boolean;
  editingText: string;
  editSaving: boolean;
  onStartEdit: (block: Block) => void;
  onEditingTextChange: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const selected = selectedSet.has(block.id);
  const isEditing = currentEditingBlockId === block.id;
  const isTextBlock = block.type === "heading" || block.type === "paragraph";
  const canClickToEdit = isEditMode && isTextBlock;
  const textStyle =
    isTextBlock
      ? {
          color: block.textStyle?.color,
          fontSize: block.textStyle?.fontSize,
          fontWeight: block.textStyle?.fontWeight,
          textAlign: block.textStyle?.textAlign
        }
      : undefined;

  if (isEditing && isTextBlock) {
    return (
      <section data-block-id={block.id} className={`demo-block ${selected ? "demo-block-selected" : ""}`}>
        <div className="inline-edit-panel" onClick={(event) => event.stopPropagation()}>
          <textarea
            value={editingText}
            onChange={(event) => onEditingTextChange(event.target.value)}
            rows={block.type === "heading" ? 2 : 5}
            autoFocus
            disabled={editSaving}
          />
          <div className="module-actions">
            <button type="button" onClick={onSaveEdit} disabled={editSaving}>
              {editSaving ? "保存中..." : "保存文字"}
            </button>
            <button type="button" onClick={onCancelEdit} disabled={editSaving}>
              取消
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-block-id={block.id}
      className={`demo-block ${selected ? "demo-block-selected" : ""} ${isEditMode && isTextBlock ? "demo-block-editable" : ""}`}
      onClick={canClickToEdit ? () => onStartEdit(block) : undefined}
      title={canClickToEdit ? "点击编辑文字" : undefined}
    >
      {block.type === "heading" && block.level === 1 ? <h1 style={textStyle}>{block.text}</h1> : null}
      {block.type === "heading" && block.level === 2 ? <h2 style={textStyle}>{block.text}</h2> : null}
      {block.type === "heading" && block.level === 3 ? <h3 style={textStyle}>{block.text}</h3> : null}
      {block.type === "paragraph" ? <p style={textStyle}>{block.text}</p> : null}
      {block.type === "divider" ? <hr /> : null}
      {block.type === "image" ? (
        <figure>
          <img
            src={block.src}
            alt={block.alt ?? ""}
            style={{ width: `${typeof block.widthPercent === "number" ? Math.max(10, Math.min(100, block.widthPercent)) : 100}%` }}
          />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      ) : null}
      {block.type === "chart" ? (
        <figure className="preview-chart-block">
          <ChartCanvas option={block.option} height={block.height} />
          {block.title ? <figcaption>{block.title}</figcaption> : null}
        </figure>
      ) : null}
      {block.type === "rich" ? (
        <div className="preview-rich-block">
          {block.items.map((item, index) => (
            <div key={`${block.id}-item-${index}`}>
              {item.kind === "text" ? <p>{item.text}</p> : null}
              {item.kind === "image" ? (
                <figure>
                  <img
                    src={item.src}
                    alt={item.alt ?? ""}
                    style={{ width: `${typeof item.widthPercent === "number" ? Math.max(10, Math.min(100, item.widthPercent)) : 100}%` }}
                  />
                  {item.caption ? <figcaption>{item.caption}</figcaption> : null}
                </figure>
              ) : null}
              {item.kind === "chart" ? (
                <figure className="preview-chart-block">
                  <ChartCanvas option={item.option} height={item.height} />
                  {item.title ? <figcaption>{item.title}</figcaption> : null}
                </figure>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {block.type === "columns" ? (
        <div
          className="preview-columns-block"
          style={{
            gap: `${Math.max(8, Math.min(80, block.gap ?? 16))}px`,
            gridTemplateColumns: `repeat(${Math.max(1, block.columns.length)}, minmax(0, 1fr))`
          }}
        >
          {block.columns.map((column) => (
            <div key={column.id} className="preview-columns-col">
              {column.blocks.map((child) => (
                <BlockView
                  key={child.id}
                  block={child}
                  selectedSet={selectedSet}
                  currentEditingBlockId={currentEditingBlockId}
                  isEditMode={isEditMode}
                  editingText={editingText}
                  editSaving={editSaving}
                  onStartEdit={onStartEdit}
                  onEditingTextChange={onEditingTextChange}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function EditorWorkspace({ initialPageId }: { initialPageId: string }) {
  const router = useRouter();
  const [currentPageId, setCurrentPageId] = useState(initialPageId);
  const [page, setPage] = useState<Page | null>(null);
  const [hasImportedDoc, setHasImportedDoc] = useState(initialPageId !== "demo");

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [patching, setPatching] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [importing, setImporting] = useState(false);

  const [message, setMessage] = useState("");
  const [apiHealthStatus, setApiHealthStatus] = useState<ApiHealthStatus>("checking");
  const [apiHealthMessage, setApiHealthMessage] = useState("正在检查 API 服务...");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [customSlug, setCustomSlug] = useState("");
  const [exportHostname, setExportHostname] = useState("");
  const [deployBaseDir, setDeployBaseDir] = useState("/var/www/reports");
  const [deployRemoteRootOverride, setDeployRemoteRootOverride] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState("");
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [deployText, setDeployText] = useState("");
  const [activeModule, setActiveModule] = useState<SidebarModule>("upload");

  const [llmSettings, setLlmSettings] = useState<LlmSettings>({
    provider: DEFAULT_PROVIDER,
    baseUrl: DEFAULT_BASE_URL,
    model: "",
    apiKey: ""
  });

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [providerVerifying, setProviderVerifying] = useState(false);
  const [providerStatus, setProviderStatus] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { isSelectingMode, selectedIds, selectionRect, enterSelectingMode, exitSelectingMode, clearSelection } =
    useBlockSelection(containerRef);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const computedRemoteRootDir = useMemo(() => {
    if (!exportResult) {
      return "";
    }
    const base = (deployBaseDir.trim() || "/var/www/reports").replace(/\/+$/, "");
    const relative = exportResult.urlPath.replace(/^\/+/, "").replace(/\/+$/, "");
    return `${base}/${relative}`.replace(/\/+/g, "/");
  }, [deployBaseDir, exportResult]);

  const shouldShowPreview = Boolean(page) && (currentPageId !== "demo" || hasImportedDoc);

  const checkApiHealth = async () => {
    setApiHealthStatus("checking");
    setApiHealthMessage("正在检查 API 服务...");
    try {
      const response = await fetch(`${API_BASE}/api/health`, {
        method: "GET"
      });
      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }
      const result = (await response.json()) as { ok?: boolean };
      if (!result.ok) {
        throw new Error("Health check returned invalid payload");
      }
      setApiHealthStatus("ok");
      setApiHealthMessage(`API 已连接：${API_BASE}`);
    } catch {
      setApiHealthStatus("error");
      setApiHealthMessage(`API 不可达：${API_BASE}`);
    }
  };

  useEffect(() => {
    setCurrentPageId(initialPageId);
    setHasImportedDoc(initialPageId !== "demo");
  }, [initialPageId]);

  useEffect(() => {
    if (activeModule !== "edit") {
      setEditingBlockId(null);
      setEditingText("");
    }
  }, [activeModule]);

  useEffect(() => {
    if (activeModule === "edit" && isSelectingMode) {
      exitSelectingMode();
    }
  }, [activeModule, exitSelectingMode, isSelectingMode]);

  useEffect(() => {
    void checkApiHealth();
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE}/api/page/${currentPageId}`);
        if (!response.ok) {
          throw new Error(`Failed to load page (${response.status})`);
        }
        const data = (await response.json()) as Page;
        setPage(data);
        if (currentPageId !== "demo") {
          setHasImportedDoc(true);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [currentPageId]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(LLM_SETTINGS_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<LlmSettings>;
      setLlmSettings({
        provider:
          parsed.provider === "openai_compatible" || parsed.provider === "gemini" || parsed.provider === "anthropic"
            ? parsed.provider
            : DEFAULT_PROVIDER,
        baseUrl:
          parsed.provider === "gemini"
            ? GEMINI_BASE_URL
            : typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
              ? parsed.baseUrl
              : DEFAULT_BASE_URL,
        model: typeof parsed.model === "string" ? parsed.model : "",
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : ""
      });
    } catch {
      window.sessionStorage.removeItem(LLM_SETTINGS_KEY);
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(llmSettings));
  }, [llmSettings]);

  useEffect(() => {
    setProviderModels([]);
    setProviderStatus("");
  }, [llmSettings.provider, llmSettings.baseUrl, llmSettings.apiKey]);

  useEffect(() => {
    if (llmSettings.provider !== "gemini") {
      return;
    }
    if (llmSettings.baseUrl === GEMINI_BASE_URL) {
      return;
    }
    setLlmSettings((prev) => ({ ...prev, baseUrl: GEMINI_BASE_URL }));
  }, [llmSettings.baseUrl, llmSettings.provider]);

  const handleVerifyProvider = async () => {
    if (!llmSettings.apiKey.trim()) {
      setProviderStatus("请先填写 API Key。");
      return;
    }

    setProviderVerifying(true);
    setProviderStatus("");
    try {
      const response = await fetch(`${API_BASE}/api/provider/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmSettings.provider,
          baseUrl: llmSettings.baseUrl.trim() || undefined,
          apiKey: llmSettings.apiKey.trim()
        })
      });

      const result = (await response.json()) as ProviderVerifyResponse;
      if (!response.ok || !result.ok) {
        throw new Error(!result.ok ? result.error.message : `Verify failed (${response.status})`);
      }

      setProviderModels(result.models);
      if (!llmSettings.model.trim() || !result.models.includes(llmSettings.model.trim())) {
        setLlmSettings((prev) => ({ ...prev, model: result.models[0] ?? "" }));
      }
      setProviderStatus(`验证通过，已加载 ${result.models.length} 个模型。`);
    } catch (error) {
      if (llmSettings.provider === "gemini") {
        setProviderModels(GEMINI_FALLBACK_MODELS);
        if (!llmSettings.model.trim()) {
          setLlmSettings((prev) => ({ ...prev, model: GEMINI_FALLBACK_MODELS[0] }));
        }
        setProviderStatus("Gemini 模型接口超时，已加载默认模型，可直接继续使用。");
        return;
      }
      setProviderModels([]);
      setProviderStatus(error instanceof Error ? error.message : "验证失败");
    } finally {
      setProviderVerifying(false);
    }
  };

  const handleRefreshModels = async () => {
    if (!llmSettings.apiKey.trim()) {
      setProviderStatus("请先填写 API Key。");
      return;
    }

    setProviderVerifying(true);
    setProviderStatus("");
    try {
      const query = new URLSearchParams({ provider: llmSettings.provider });
      const trimmedBaseUrl = llmSettings.baseUrl.trim();
      if (trimmedBaseUrl) {
        query.set("baseUrl", trimmedBaseUrl);
      }
      const response = await fetch(
        `${API_BASE}/api/provider/models?${query.toString()}`,
        {
          method: "GET",
          headers: {
            "x-provider-api-key": llmSettings.apiKey.trim()
          }
        }
      );

      const result = (await response.json()) as ProviderVerifyResponse;
      if (!response.ok || !result.ok) {
        throw new Error(!result.ok ? result.error.message : `Refresh failed (${response.status})`);
      }

      setProviderModels(result.models);
      if (!llmSettings.model.trim() || !result.models.includes(llmSettings.model.trim())) {
        setLlmSettings((prev) => ({ ...prev, model: result.models[0] ?? "" }));
      }
      setProviderStatus(`模型列表已刷新（${result.models.length} 个）。`);
    } catch (error) {
      if (llmSettings.provider === "gemini") {
        setProviderModels(GEMINI_FALLBACK_MODELS);
        if (!llmSettings.model.trim()) {
          setLlmSettings((prev) => ({ ...prev, model: GEMINI_FALLBACK_MODELS[0] }));
        }
        setProviderStatus("Gemini 模型刷新超时，已切换为默认模型列表。");
        return;
      }
      setProviderStatus(error instanceof Error ? error.message : "刷新模型失败");
    } finally {
      setProviderVerifying(false);
    }
  };

  const handleImportDocx = async (file: File) => {
    setImporting(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_BASE}/api/import/docx`, {
        method: "POST",
        body: form
      });
      const result = (await response.json()) as { ok: boolean; pageId?: string; page?: Page; error?: string };
      if (!response.ok || !result.ok || !result.pageId || !result.page) {
        throw new Error(result.error ?? `Import failed (${response.status})`);
      }

      setHasImportedDoc(true);
      setCurrentPageId(result.pageId);
      setPage(result.page);
      setActiveModule("edit");
      router.push(`/page/${result.pageId}`);
      setMessage(`Imported page: ${result.pageId}`);
    } catch (error) {
      const errorMessage =
        error instanceof TypeError && error.message.includes("Failed to fetch")
          ? `Cannot reach API server at ${API_BASE}. Please start @apps/api on port 3001 and verify network/CORS settings.`
          : error instanceof Error
            ? error.message
            : "Unknown import error";
      window.alert(errorMessage);
      setMessage(errorMessage);
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handlePublish = async () => {
    if (!shouldShowPreview) {
      setMessage("Please import a .docx file before publishing.");
      return;
    }

    setExporting(true);
    setMessage("");
    setExportResult(null);
    setDeployResult(null);
    setDeployText("");

    try {
      const response = await fetch(`${API_BASE}/api/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: currentPageId,
          siteSlug: customSlug.trim() || undefined,
          hostname: exportHostname.trim() || undefined,
          serverRootDir: deployBaseDir.trim() || undefined
        })
      });
      if (!response.ok) {
        const errBody = (await response.json()) as { error?: string };
        throw new Error(errBody.error ?? `Export failed (${response.status})`);
      }

      const result = (await response.json()) as {
        ok: boolean;
        outDir: string;
        urlPath: string;
        manifest: ExportManifest;
        caddySnippet: string | null;
      };

      setExportResult({
        outDir: result.outDir,
        urlPath: result.urlPath,
        manifest: result.manifest,
        caddySnippet: result.caddySnippet
      });

      const localOutPath = result.outDir.replace(/^exports\//, "");
      const remoteTarget = `${deployBaseDir.trim() || "/var/www/reports"}/${localOutPath}`.replace(/\/+/g, "/");
      const steps = [
        `Export output: ${result.outDir}`,
        `URL path: ${result.urlPath}`,
        "",
        "Upload (Linux/macOS with rsync):",
        `rsync -avz ${result.outDir}/ user@<server-ip>:${remoteTarget}/`,
        "",
        "Upload (Windows with scp in PowerShell):",
        `scp -r ${result.outDir}/* user@<server-ip>:${remoteTarget}/`,
        "",
        "If scp/rsync unavailable on Windows, upload files via WinSCP or SFTP client.",
        "",
        result.caddySnippet ? `Caddyfile snippet:\n${result.caddySnippet}` : "No hostname provided, so caddy snippet was not generated."
      ].join("\n");

      setDeployText(steps);
      setMessage(`Publish complete: ${result.outDir}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown export error");
    } finally {
      setExporting(false);
    }
  };

  const handleApplyAiChat = async () => {
    if (selectedIds.length === 0 || !chatInput.trim()) {
      return;
    }
    if (!llmSettings.apiKey.trim()) {
      const errorMessage = "Missing API key. Please configure AI Settings first.";
      window.alert(errorMessage);
      setMessage(errorMessage);
      return;
    }

    const userText = chatInput.trim();
    setChatMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: "user", text: userText }]);
    setPatching(true);
    setMessage("");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-llm-base-url": llmSettings.baseUrl,
        "x-llm-provider": llmSettings.provider,
        "x-llm-api-key": llmSettings.apiKey
      };
      if (llmSettings.model.trim()) {
        headers["x-llm-model"] = llmSettings.model.trim();
      }

      const response = await fetch(`${API_BASE}/api/patch/demo`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pageId: currentPageId,
          selectedBlockIds: selectedIds,
          instruction: userText
        })
      });

      const result = (await response.json()) as { ok: boolean; page?: Page; error?: string };
      if (!response.ok || !result.ok || !result.page) {
        throw new Error(result.error ?? `Patch failed (${response.status})`);
      }

      setPage(result.page);
      setChatInput("");
      setChatMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-a`, role: "assistant", text: `Patch applied to ${selectedIds.length} block(s).` }
      ]);
      setMessage("AI patch applied");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown patch error";
      setChatMessages((prev) => [...prev, { id: `${Date.now()}-e`, role: "assistant", text: errorMessage }]);
      window.alert(errorMessage);
      setMessage(errorMessage);
    } finally {
      setPatching(false);
    }
  };

  const handleOptimizeLayout = async () => {
    if (!page || page.blocks.length === 0) {
      return;
    }
    if (!llmSettings.apiKey.trim()) {
      const errorMessage = "Missing API key. Please configure AI Settings first.";
      window.alert(errorMessage);
      setMessage(errorMessage);
      return;
    }

    setPatching(true);
    setMessage("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-llm-base-url": llmSettings.baseUrl,
        "x-llm-provider": llmSettings.provider,
        "x-llm-api-key": llmSettings.apiKey
      };
      if (llmSettings.model.trim()) {
        headers["x-llm-model"] = llmSettings.model.trim();
      }

      const response = await fetch(`${API_BASE}/api/patch/demo`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pageId: currentPageId,
          selectedBlockIds: page.blocks.map((block) => block.id),
          instruction: OPTIMIZE_LAYOUT_PROMPT
        })
      });

      const result = (await response.json()) as { ok: boolean; page?: Page; error?: string };
      if (!response.ok || !result.ok || !result.page) {
        throw new Error(result.error ?? `Optimize failed (${response.status})`);
      }

      setPage(result.page);
      setChatMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-a-opt`, role: "assistant", text: "已完成一次 AI 优化排版。" }
      ]);
      setMessage("AI optimize layout applied");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown optimize error";
      window.alert(errorMessage);
      setMessage(errorMessage);
    } finally {
      setPatching(false);
    }
  };

  const handleUndo = async () => {
    setUndoing(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/undo/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: currentPageId })
      });
      const result = (await response.json()) as { ok: boolean; page?: Page; error?: string };
      if (!result.ok || !result.page) {
        throw new Error(result.error ?? "Undo failed");
      }
      setPage(result.page);
      setMessage("Undo complete");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown undo error";
      window.alert(errorMessage);
      setMessage(errorMessage);
    } finally {
      setUndoing(false);
    }
  };

  const handleDeploy = async () => {
    if (!exportResult) {
      return;
    }
    if (!sshHost.trim() || !sshUser.trim()) {
      const errorMessage = "SSH host and user are required for deploy.";
      window.alert(errorMessage);
      setMessage(errorMessage);
      return;
    }

    setDeploying(true);
    setMessage("");
    try {
      const portNum = Number(sshPort);
      const response = await fetch(`${API_BASE}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteSlug: exportResult.manifest.siteSlug,
          localOutDir: exportResult.outDir,
          urlPath: exportResult.urlPath,
          hostname: exportHostname.trim() || undefined,
          remoteBaseDir: deployBaseDir.trim() || "/var/www/reports",
          remoteRootDir: deployRemoteRootOverride.trim() || undefined,
          server: {
            host: sshHost.trim(),
            user: sshUser.trim(),
            port: Number.isFinite(portNum) && portNum > 0 ? Math.floor(portNum) : 22,
            privateKeyPath: sshPrivateKeyPath.trim() || undefined
          }
        })
      });

      const result = (await response.json()) as {
        ok: boolean;
        remoteRootDir?: string;
        remoteUrl?: string | null;
        error?: string;
      };

      if (!response.ok || !result.ok || !result.remoteRootDir) {
        throw new Error(result.error ?? `Deploy failed (${response.status})`);
      }

      setDeployResult({
        remoteRootDir: result.remoteRootDir,
        remoteUrl: result.remoteUrl ?? null
      });
      setMessage("Deploy complete");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown deploy error";
      window.alert(errorMessage);
      setMessage(errorMessage);
    } finally {
      setDeploying(false);
    }
  };

  const startTextEdit = (block: Block) => {
    if (activeModule !== "edit") {
      return;
    }
    if (block.type !== "heading" && block.type !== "paragraph") {
      return;
    }
    setEditingBlockId(block.id);
    setEditingText(block.text);
  };

  const cancelTextEdit = () => {
    setEditingBlockId(null);
    setEditingText("");
  };

  const saveTextEdit = async () => {
    if (!editingBlockId) {
      return;
    }
    setEditSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/page/${encodeURIComponent(currentPageId)}/block/${encodeURIComponent(editingBlockId)}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingText })
      });
      const result = (await response.json()) as { ok: boolean; page?: Page; error?: string };
      if (!response.ok || !result.ok || !result.page) {
        throw new Error(result.error ?? `Save failed (${response.status})`);
      }
      setPage(result.page);
      setEditingBlockId(null);
      setEditingText("");
      setMessage("文字已更新");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown save error";
      window.alert(errorMessage);
      setMessage(errorMessage);
    } finally {
      setEditSaving(false);
    }
  };

  const toggleSelectingMode = () => {
    if (isSelectingMode) {
      clearSelection();
      exitSelectingMode();
      setChatInput("");
      return;
    }
    enterSelectingMode();
  };

  return (
    <main className="workspace-main">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleImportDocx(file);
          }
        }}
      />

      <div className="workspace-shell">
        <section className="preview-pane">
          <div className="pane-header">
            <h1>Web Preview</h1>
            <p>Page: {currentPageId}</p>
          </div>

          <div
            ref={containerRef}
            className={
              isSelectingMode
                ? "preview-canvas selecting-surface selecting-active"
                : activeModule === "edit"
                  ? "preview-canvas selecting-surface preview-canvas-edit-mode"
                  : "preview-canvas selecting-surface"
            }
          >
            {loading ? <p>Loading...</p> : null}
            {!loading && shouldShowPreview && page
              ? page.blocks.map((block) => (
                  <BlockView
                    key={block.id}
                    block={block}
                    selectedSet={selectedSet}
                    currentEditingBlockId={editingBlockId}
                    isEditMode={activeModule === "edit"}
                    editingText={editingText}
                    editSaving={editSaving}
                    onStartEdit={startTextEdit}
                    onEditingTextChange={setEditingText}
                    onSaveEdit={() => void saveTextEdit()}
                    onCancelEdit={cancelTextEdit}
                  />
                ))
              : null}
            {!loading && !shouldShowPreview ? (
              <div className="preview-empty">
                <h2>等待内容</h2>
                <p>左侧展示区默认空白，请在右侧上传模块导入 .docx 后预览内容。</p>
              </div>
            ) : null}
          </div>

          {selectionRect ? (
            <div className="selection-rect" style={{ left: selectionRect.x, top: selectionRect.y, width: selectionRect.w, height: selectionRect.h }} />
          ) : null}
        </section>

        <aside className="sidebar-pane">
          <section className={`module-card api-health-card ${apiHealthStatus === "error" ? "api-health-error" : apiHealthStatus === "ok" ? "api-health-ok" : ""}`}>
            <h2>启动自检</h2>
            <p className="module-note">{apiHealthMessage}</p>
            <div className="module-actions">
              <button type="button" onClick={() => void checkApiHealth()} disabled={apiHealthStatus === "checking"}>
                {apiHealthStatus === "checking" ? "检测中..." : "重试检测"}
              </button>
            </div>
          </section>

          <div className="module-tabs">
            <button type="button" className={activeModule === "upload" ? "tab-active" : ""} onClick={() => setActiveModule("upload")}>
              上传
            </button>
            <button type="button" className={activeModule === "edit" ? "tab-active" : ""} onClick={() => setActiveModule("edit")}>
              编辑
            </button>
            <button type="button" className={activeModule === "ai" ? "tab-active" : ""} onClick={() => setActiveModule("ai")}>
              AI
            </button>
            <button type="button" className={activeModule === "publish" ? "tab-active" : ""} onClick={() => setActiveModule("publish")}>
              发布
            </button>
          </div>

          <div className="sidebar-module-slot">
          {activeModule === "upload" ? (
            <section className="module-card module-card-scroll">
              <h2>上传文档</h2>
              <p>先导入 DOCX，左侧会自动生成网页化预览。</p>
              <button type="button" disabled={importing} onClick={() => fileInputRef.current?.click()}>
                {importing ? "Importing..." : "Import .docx"}
              </button>
              <p className="module-note">当前页面：{currentPageId}</p>
              <p className="module-note">
                <a href="/reports">查看 Reports</a>
              </p>
            </section>
          ) : null}

          {activeModule === "edit" ? (
            <section className="module-card module-card-scroll">
              <h2>编辑选择</h2>
              <p>当前为编辑模式：可直接点击虚线框 block 修改文字。</p>
              <div className="module-actions">
                <button type="button" onClick={handleUndo} disabled={undoing || patching}>
                  {undoing ? "Undoing..." : "Undo"}
                </button>
              </div>
              <p className="module-note">已选 block：{selectedIds.length}</p>
              <p className="module-note">离开编辑分区后，虚线框会自动隐藏。</p>
            </section>
          ) : null}

          {activeModule === "ai" ? (
            <section className="module-card module-card-scroll">
              <h2>AI 助手</h2>
              <div className="settings-grid">
                <label>
                  Provider
                  <select
                    value={llmSettings.provider}
                    onChange={(event) => {
                      const nextProvider = event.target.value as ProviderType;
                      setLlmSettings((prev) => ({
                        ...prev,
                        provider: nextProvider,
                        ...(nextProvider === "gemini" ? { baseUrl: GEMINI_BASE_URL } : {})
                      }));
                    }}
                  >
                    <option value="openai_compatible">OpenAI Compatible</option>
                    <option value="gemini">Gemini</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </label>
                {llmSettings.provider === "gemini" ? (
                  <p className="module-note">Gemini 使用官方接口，无需填写 Base URL。</p>
                ) : (
                  <label>
                    Base URL
                    <input value={llmSettings.baseUrl} onChange={(event) => setLlmSettings((prev) => ({ ...prev, baseUrl: event.target.value }))} />
                  </label>
                )}
                <label>
                  API Key
                  <input type="password" value={llmSettings.apiKey} onChange={(event) => setLlmSettings((prev) => ({ ...prev, apiKey: event.target.value }))} />
                </label>
                <label>
                  Model (optional)
                  {providerModels.length > 0 ? (
                    <select value={llmSettings.model} onChange={(event) => setLlmSettings((prev) => ({ ...prev, model: event.target.value }))}>
                      {providerModels.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={llmSettings.model}
                      placeholder={DEFAULT_MODEL}
                      onChange={(event) => setLlmSettings((prev) => ({ ...prev, model: event.target.value }))}
                    />
                  )}
                </label>
              </div>

              <div className="module-actions">
                <button type="button" onClick={() => void handleVerifyProvider()} disabled={providerVerifying}>
                  {providerVerifying ? "Verifying..." : "验证 Key 并加载模型"}
                </button>
                <button type="button" onClick={() => void handleRefreshModels()} disabled={providerVerifying}>
                  {providerVerifying ? "Refreshing..." : "刷新模型"}
                </button>
              </div>
              {providerStatus ? <p className="module-note">{providerStatus}</p> : null}

              <div className="module-actions">
                <button type="button" onClick={toggleSelectingMode} disabled={patching}>
                  {isSelectingMode ? "退出 AI 选择" : "AI 选择范围"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearSelection();
                    setChatInput("");
                  }}
                  disabled={!isSelectingMode && selectedIds.length === 0}
                >
                  清空选择
                </button>
                <button type="button" onClick={() => setActiveModule("edit")} disabled={patching}>
                  去编辑分区选择内容
                </button>
                <button type="button" onClick={() => void handleOptimizeLayout()} disabled={patching || !page || page.blocks.length === 0}>
                  {patching ? "Processing..." : "AI优化排版"}
                </button>
              </div>

              <p className="module-note">已选 block：{selectedIds.length}</p>
              <p className="module-note">选中 block 后可在下方对话框输入指令并应用。</p>

              <div className="ai-chat-embedded">
                <h3>AI 对话</h3>
                <div className="ai-chat-log">
                  {chatMessages.length === 0 ? <p className="module-note">先在编辑分区选择 block，再发送指令。</p> : null}
                  {chatMessages.map((item) => (
                    <div key={item.id} className={item.role === "user" ? "chat-item chat-user" : "chat-item chat-assistant"}>
                      <strong>{item.role === "user" ? "你" : "AI"}：</strong>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
                <textarea
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="例如：把这段改得更正式，并补充一个结论段"
                  disabled={patching}
                  rows={4}
                />
                <div className="module-actions">
                  <button type="button" onClick={() => void handleApplyAiChat()} disabled={patching || !chatInput.trim() || selectedIds.length === 0}>
                    {patching ? "Sending..." : "发送并应用"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeModule === "publish" ? (
            <section className="module-card module-card-scroll">
              <h2>Publish & Deploy</h2>
              <div className="settings-grid">
                <label>
                  Custom slug (optional)
                  <input value={customSlug} placeholder="my-report" onChange={(event) => setCustomSlug(event.target.value)} />
                </label>
                <label>
                  Hostname (optional)
                  <input value={exportHostname} placeholder="report.fuhua.team" onChange={(event) => setExportHostname(event.target.value)} />
                </label>
                <label>
                  Server base dir
                  <input value={deployBaseDir} onChange={(event) => setDeployBaseDir(event.target.value)} />
                </label>
                <label>
                  SSH host
                  <input value={sshHost} placeholder="your-server-ip" onChange={(event) => setSshHost(event.target.value)} />
                </label>
                <label>
                  SSH user
                  <input value={sshUser} placeholder="root" onChange={(event) => setSshUser(event.target.value)} />
                </label>
                <label>
                  SSH port
                  <input value={sshPort} placeholder="22" onChange={(event) => setSshPort(event.target.value)} />
                </label>
                <label>
                  SSH private key path (optional)
                  <input value={sshPrivateKeyPath} placeholder="~/.ssh/id_rsa" onChange={(event) => setSshPrivateKeyPath(event.target.value)} />
                </label>
                <label>
                  Computed remote root dir
                  <input value={computedRemoteRootDir} readOnly />
                </label>
                <label>
                  Override remote root dir (optional)
                  <input
                    value={deployRemoteRootOverride}
                    placeholder={computedRemoteRootDir || "/var/www/reports/r/xxxx"}
                    onChange={(event) => setDeployRemoteRootOverride(event.target.value)}
                  />
                </label>
              </div>

              <div className="module-actions">
                <button type="button" onClick={handlePublish} disabled={exporting || !shouldShowPreview}>
                  {exporting ? "Publishing..." : "Publish"}
                </button>
                <button type="button" onClick={handleDeploy} disabled={deploying || !exportResult}>
                  {deploying ? "Deploying..." : "Deploy to server"}
                </button>
              </div>

              {exportResult ? (
                <div className="export-result">
                  <p>outDir: {exportResult.outDir}</p>
                  <p>urlPath: {exportResult.urlPath}</p>
                  {exportHostname.trim() ? <p>fullUrl: {`https://${exportHostname.trim()}${exportResult.urlPath}`}</p> : null}
                  <p>
                    manifest: {exportResult.manifest.siteSlug} / {exportResult.manifest.version}
                  </p>
                  {deployResult ? <p>remoteRootDir: {deployResult.remoteRootDir}</p> : null}
                  {deployResult?.remoteUrl ? (
                    <p>
                      remoteUrl:{" "}
                      <a href={deployResult.remoteUrl} target="_blank" rel="noreferrer">
                        {deployResult.remoteUrl}
                      </a>
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(deployText);
                        setMessage("Deploy steps copied");
                      } catch {
                        window.alert("Copy failed. Please copy from the text area manually.");
                      }
                    }}
                    disabled={!deployText}
                  >
                    Copy deploy steps
                  </button>
                  <textarea readOnly value={deployText} rows={10} />
                </div>
              ) : null}
            </section>
          ) : null}
          </div>

          {message ? <div className="notice">{message}</div> : null}
        </aside>
      </div>

    </main>
  );
}


