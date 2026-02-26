"use client";

import { useEffect, useState } from "react";

const API_BASE = "http://localhost:3001";

type ReportItem = {
  siteSlug: string;
  urlPath: string;
  title: string | null;
  generatedAt: string;
  version: string | number;
  outDir: string;
  hostname: string | null;
};

export default function ReportsPage() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadReports = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/reports`);
      if (!response.ok) {
        throw new Error(`Failed to fetch reports (${response.status})`);
      }
      const data = (await response.json()) as ReportItem[];
      setItems(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, []);

  return (
    <main>
      <div className="panel">
        <div className="toolbar">
          <h1>Reports Index</h1>
          <button type="button" onClick={() => void loadReports()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p>
          <a href="/demo">Go to /demo</a>
        </p>
        {message ? <div className="notice">{message}</div> : null}
        {!loading && items.length === 0 ? <p>No reports found.</p> : null}
        <div className="reports-grid">
          {items.map((item) => {
            const fullUrl = item.hostname ? `https://${item.hostname}${item.urlPath}` : null;
            return (
              <article className="report-card" key={`${item.siteSlug}-${item.version}`}>
                <h3>{item.title || item.siteSlug}</h3>
                <p>generatedAt: {new Date(item.generatedAt).toLocaleString()}</p>
                <p>urlPath: {item.urlPath}</p>
                <p>outDir: {item.outDir}</p>
                {fullUrl ? <p>fullUrl: {fullUrl}</p> : null}
                <div className="toolbar">
                  <a href={fullUrl ?? item.urlPath} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(fullUrl ?? item.urlPath);
                      } catch {
                        window.alert("Copy failed.");
                      }
                    }}
                  >
                    Copy link
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
