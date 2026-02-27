import test from "node:test";
import assert from "node:assert/strict";
import { verifyProviderApiKey } from "./verify";

test("verifyProviderApiKey: returns model list on 200 /v1/models", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    assert.equal(url, "https://api.example.com/v1/models");
    return new Response(
      JSON.stringify({
        object: "list",
        data: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1" }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await verifyProviderApiKey({
      baseUrl: "https://api.example.com",
      apiKey: "sk-test"
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.models, ["gpt-4o-mini", "gpt-4.1"]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyProviderApiKey: returns invalid_api_key on 401", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;

  try {
    const result = await verifyProviderApiKey({
      baseUrl: "https://api.example.com",
      apiKey: "sk-bad"
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "invalid_api_key");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyProviderApiKey: falls back to /models after 404", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith("/v1/models")) {
      return new Response("not found", { status: 404 });
    }
    assert.ok(url.endsWith("/models"));
    return new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await verifyProviderApiKey({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test"
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.models, ["deepseek-chat"]);
    }
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyProviderApiKey: returns timeout error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_: URL | RequestInfo, init?: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }
    });
  }) as typeof fetch;

  try {
    const result = await verifyProviderApiKey({
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
      timeoutMs: 8_000
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "timeout");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

