"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Block, Page } from "@packages/blocks";
import { useBlockSelection } from "@packages/editor";

const API_BASE = "http://localhost:3001";
const LLM_SETTINGS_KEY = "demo.llm.settings";
const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "gpt-4o-mini";

type LlmSettings = {
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

function BlockView({ block, selected }: { block: Block; selected: boolean }) {
  return (
    <section data-block-id={block.id} className={`demo-block ${selected ? "demo-block-selected" : ""}`}>
      {block.type === "heading" && block.level === 1 ? <h1>{block.text}</h1> : null}
      {block.type === "heading" && block.level === 2 ? <h2>{block.text}</h2> : null}
      {block.type === "heading" && block.level === 3 ? <h3>{block.text}</h3> : null}
      {block.type === "paragraph" ? <p>{block.text}</p> : null}
      {block.type === "divider" ? <hr /> : null}
      {block.type === "image" ? (
        <figure>
          <img src={block.src} alt={block.alt ?? ""} />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      ) : null}
    </section>
  );
}

export function EditorWorkspace({ initialPageId }: { initialPageId: string }) {
  const router = useRouter();
  const [currentPageId, setCurrentPageId] = useState(initialPageId);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [patching, setPatching] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [instruction, setInstruction] = useState("");
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
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
  const [llmSettings, setLlmSettings] = useState<LlmSettings>({
    baseUrl: DEFAULT_BASE_URL,
    model: "",
    apiKey: ""
  });

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

  useEffect(() => {
    setCurrentPageId(initialPageId);
  }, [initialPageId]);

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
        baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl : DEFAULT_BASE_URL,
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
    if (!isSelectingMode || selectedIds.length === 0) {
      setPopoverPos(null);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const blockElements = Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]")).filter((element) => {
      const id = element.dataset.blockId;
      return typeof id === "string" && selectedSet.has(id);
    });

    if (blockElements.length === 0) {
      setPopoverPos(null);
      return;
    }

    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;

    for (const element of blockElements) {
      const rect = element.getBoundingClientRect();
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
    }

    setPopoverPos({
      x: Math.min(right + 12, window.innerWidth - 320),
      y: Math.max(12, top - 8)
    });
  }, [isSelectingMode, selectedIds, selectedSet]);

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

      setCurrentPageId(result.pageId);
      setPage(result.page);
      router.push(`/page/${result.pageId}`);
      setMessage(`Imported page: ${result.pageId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown import error";
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

  const handleApplySelectionPatch = async () => {
    if (selectedIds.length === 0 || !instruction.trim()) {
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
          instruction
        })
      });

      const result = (await response.json()) as { ok: boolean; page?: Page; error?: string };
      if (!response.ok || !result.ok || !result.page) {
        throw new Error(result.error ?? `Patch failed (${response.status})`);
      }

      setPage(result.page);
      setInstruction("");
      clearSelection();
      exitSelectingMode();
      setMessage("AI patch applied");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown patch error";
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

  const toggleSelectingMode = () => {
    if (isSelectingMode) {
      clearSelection();
      exitSelectingMode();
      setInstruction("");
      return;
    }
    enterSelectingMode();
  };

  return (
    <main>
      <div className="panel">
        <h1>Editor - {currentPageId}</h1>
        <div className="toolbar">
          <button type="button" onClick={toggleSelectingMode} disabled={patching}>
            {isSelectingMode ? "Exit AI Select" : "AI Select"}
          </button>
          {isSelectingMode ? (
            <button
              type="button"
              onClick={() => {
                clearSelection();
                setInstruction("");
              }}
            >
              Clear selection
            </button>
          ) : null}
          <button type="button" onClick={handleUndo} disabled={undoing || patching}>
            {undoing ? "Undoing..." : "Undo"}
          </button>
          <button type="button" onClick={handlePublish} disabled={exporting}>
            {exporting ? "Publishing..." : "Publish"}
          </button>
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
          <button type="button" disabled={importing} onClick={() => fileInputRef.current?.click()}>
            {importing ? "Importing..." : "Import .docx"}
          </button>
        </div>

        <details className="settings-panel">
          <summary>AI Settings</summary>
          <div className="settings-grid">
            <label>
              Base URL
              <input value={llmSettings.baseUrl} onChange={(event) => setLlmSettings((prev) => ({ ...prev, baseUrl: event.target.value }))} />
            </label>
            <label>
              API Key
              <input type="password" value={llmSettings.apiKey} onChange={(event) => setLlmSettings((prev) => ({ ...prev, apiKey: event.target.value }))} />
            </label>
            <details className="advanced-settings">
              <summary>Advanced</summary>
              <label>
                Model (optional)
                <input
                  value={llmSettings.model}
                  placeholder={DEFAULT_MODEL}
                  onChange={(event) => setLlmSettings((prev) => ({ ...prev, model: event.target.value }))}
                />
              </label>
            </details>
          </div>
        </details>

        <details className="settings-panel">
          <summary>Deploy Settings</summary>
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
            <details className="advanced-settings">
              <summary>Advanced</summary>
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
            </details>
          </div>
        </details>

        {loading ? <p>Loading...</p> : null}
        <div ref={containerRef} className={isSelectingMode ? "selecting-surface selecting-active" : "selecting-surface"}>
          {!loading && page ? page.blocks.map((block) => <BlockView key={block.id} block={block} selected={selectedSet.has(block.id)} />) : null}
        </div>

        {selectionRect ? (
          <div className="selection-rect" style={{ left: selectionRect.x, top: selectionRect.y, width: selectionRect.w, height: selectionRect.h }} />
        ) : null}

        {isSelectingMode && selectedIds.length > 0 && popoverPos ? (
          <div className="selection-popover" style={{ left: popoverPos.x, top: popoverPos.y }}>
            <div className="selection-count">Selected: {selectedIds.length}</div>
            <input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Enter AI instruction" disabled={patching} />
            <div className="selection-actions">
              <button type="button" onClick={handleApplySelectionPatch} disabled={patching || !instruction.trim() || selectedIds.length === 0}>
                {patching ? "Applying..." : "Apply"}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSelection();
                  exitSelectingMode();
                  setInstruction("");
                }}
                disabled={patching}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {message ? <div className="notice">{message}</div> : null}
        {exportResult ? (
          <div className="export-result">
            <p>outDir: {exportResult.outDir}</p>
            <p>urlPath: {exportResult.urlPath}</p>
            {exportHostname.trim() ? <p>fullUrl: {`https://${exportHostname.trim()}${exportResult.urlPath}`}</p> : null}
            <p>manifest: {exportResult.manifest.siteSlug} / {exportResult.manifest.version}</p>
            <button type="button" onClick={handleDeploy} disabled={deploying || exporting || patching}>
              {deploying ? "Deploying..." : "Deploy to server"}
            </button>
            {deployResult ? <p>remoteRootDir: {deployResult.remoteRootDir}</p> : null}
            {deployResult?.remoteUrl ? (
              <p>
                remoteUrl:{" "}
                <a href={deployResult.remoteUrl} target="_blank" rel="noreferrer">
                  {deployResult.remoteUrl}
                </a>
              </p>
            ) : null}
            {exportHostname.trim() ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`https://${exportHostname.trim()}${exportResult.urlPath}`);
                    setMessage("Link copied");
                  } catch {
                    window.alert("Copy failed. Please copy link manually.");
                  }
                }}
              >
                Copy link
              </button>
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
            <textarea readOnly value={deployText} rows={12} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
