import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const draft = {
  title: "Reference", body: "Shop information.", tags: ["Coffee"], materialType: "image",
  style: "real_experience", cta: "Learn more", generationSource: "template",
  generationNotice: "Template draft",
};
const params = {
  source: "scan", campaign: "campaign", platform: "redbook",
  profile: { id: "merchant-id", name: "Test Shop", promptProfile: "Not sent" },
  preferences: { services: ["Coffee"], features: [], length: "Short" },
};

function clientHarness({ fetchImpl, storageFails = false, immediateTimeout = false } = {}) {
  const source = readFileSync(new URL("../src/qwen.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const requests = [];
  const timers = new Set();
  const values = new Map();
  const context = vm.createContext({
    exports,
    require: (id) => {
      assert.equal(id, "./api");
      return { apiUrl: (path) => `https://product.test${path}` };
    },
    AbortController, DOMException, Error, TypeError,
    window: {
      localStorage: {
        getItem(key) { if (storageFails) throw new Error("blocked"); return values.get(key) ?? null; },
        setItem(key, value) { if (storageFails) throw new Error("blocked"); values.set(key, value); },
      },
      setTimeout(callback, delay) {
        const id = setTimeout(callback, immediateTimeout ? 5 : delay);
        timers.add(id);
        return id;
      },
      clearTimeout(id) { timers.delete(id); clearTimeout(id); },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : Response.json({ ok: true, draft });
    },
  });
  vm.runInContext(output, context, { filename: "qwen.ts" });
  return { generate: exports.generateShareDraft, requests, timers, source };
}

test("client never embeds a model credential or sends a free-form profile prompt", async () => {
  const h = clientHarness();
  const result = await h.generate(params);
  assert.equal(result.generationSource, "template");
  assert.equal(result.generationNotice, "Template draft");
  assert.equal(h.requests[0].url, "https://product.test/.netlify/functions/generate-draft");
  const body = JSON.parse(h.requests[0].options.body);
  assert.equal(body.merchantId, params.profile.id);
  assert.equal(body.profile, undefined);
  assert.equal(body.source, undefined);
  assert.equal(h.requests[0].options.headers.authorization, undefined);
  assert.ok(!h.source.includes("VITE_DASHSCOPE"));
  assert.equal(h.timers.size, 0);
});

test("blocked browser storage does not prevent generation", async () => {
  const h = clientHarness({ storageFails: true });
  assert.equal((await h.generate(params)).generationSource, "template");
  const variant = JSON.parse(h.requests[0].options.body).variant;
  assert.ok(Number.isInteger(variant) && variant >= 0 && variant < 1000);
});

test("template variants are scoped and advance without extra network calls", async () => {
  const h = clientHarness();
  await h.generate(params);
  await h.generate(params);
  await h.generate({ ...params, platform: "meituan" });
  assert.deepEqual(h.requests.map((request) => JSON.parse(request.options.body).variant), [0, 1, 0]);
  assert.equal(h.timers.size, 0);
});

test("HTTP errors, bad responses and network errors are not silently replaced with templates", async () => {
  for (const fetchImpl of [
    async () => Response.json({ ok: false, message: "Service failure" }, { status: 503 }),
    async () => new Response("Rate limited", { status: 429 }),
    async () => new Response("<html>not the function</html>", { headers: { "content-type": "text/html" } }),
    async () => Response.json({ ok: true, draft: { ...draft, generationSource: undefined } }),
    async () => Response.json({ ok: true, draft: { ...draft, body: "" } }),
    async () => Response.json(null),
    async () => { throw new TypeError("Failed to fetch"); },
  ]) {
    const h = clientHarness({ fetchImpl });
    await assert.rejects(h.generate(params));
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("client timeout aborts the network request and clears the timer", async () => {
  let aborted = false;
  const h = clientHarness({
    immediateTimeout: true,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }),
  });
  await assert.rejects(h.generate(params), /超时/);
  assert.equal(aborted, true);
  assert.equal(h.timers.size, 0);
});

test("caller cancellation remains AbortError and does not become a timeout", async () => {
  const controller = new AbortController();
  const h = clientHarness({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const pending = h.generate({ ...params, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.timers.size, 0);
  const before = h.requests.length;
  await assert.rejects(h.generate({ ...params, signal: controller.signal }), { name: "AbortError" });
  assert.equal(h.requests.length, before);
});
