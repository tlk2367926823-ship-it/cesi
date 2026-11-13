import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const HANDOFF_ID = "11111111-1111-4111-8111-111111111111";
const MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const LAUNCH_URL = `xhsdiscover://miniapp/6a4c8abbdb457600012f5b25/pages/index/index?handoffId=${HANDOFF_ID}`;
const payload = {
  title: "深圳练车体验",
  body: "今天来汇职驾校练车。",
  tags: ["深圳学车"],
  assets: ["https://product.example.test/photo.jpg"],
};

function response(overrides = {}, status = 201) {
  return new Response(JSON.stringify({
    handoffId: HANDOFF_ID,
    launchUrl: LAUNCH_URL,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    ...overrides,
  }), { status, headers: { "content-type": "application/json" } });
}

function loadModule({ fetch, hostname = "product.example.test", timers } = {}) {
  const source = readFileSync(new URL("../src/xhsMiniapp.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  let href = `https://${hostname}/campaign`;
  const navigations = [];
  const location = {
    hostname,
    get href() { return href; },
    set href(value) { href = value; navigations.push(value); },
  };
  const window = {
    location,
    setTimeout: timers?.setTimeout || setTimeout,
    clearTimeout: timers?.clearTimeout || clearTimeout,
  };
  vm.runInNewContext(output, {
    exports,
    require(specifier) {
      if (specifier === "./api") return { apiUrl: value => value };
      throw new Error(`Unexpected import: ${specifier}`);
    },
    window, fetch, URL, AbortController, DOMException, Response, Error, Date,
  }, { filename: "xhsMiniapp.ts" });
  return { module: exports, navigations };
}

test("miniapp handoff sends only the required draft and accepts the configured Xiaohongshu route", async () => {
  let request;
  const { module } = loadModule({
    fetch: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return response();
    },
  });
  const result = await module.createXhsMiniappHandoff({ merchantId: MERCHANT_ID, source: "nfc", payload });
  assert.equal(result.handoffId, HANDOFF_ID);
  assert.equal(request.url, "/.netlify/functions/share-handoff");
  assert.equal(request.options.credentials, "same-origin");
  assert.deepEqual(Object.keys(request.body).sort(), ["body", "imageUrl", "merchantId", "source", "tags", "title"]);
  assert.equal(request.body.imageUrl, payload.assets[0]);
});

test("miniapp handoff rejects hostile destinations, malformed ids, expired drafts and missing media", async () => {
  const cases = [
    { launchUrl: "https://evil.example.test/continue" },
    { launchUrl: "xhsdiscover://post/", handoffId: HANDOFF_ID },
    { handoffId: "not-a-uuid" },
    { expiresAt: new Date(Date.now() - 1000).toISOString() },
  ];
  for (const body of cases) {
    const { module } = loadModule({ fetch: async () => response(body) });
    await assert.rejects(module.createXhsMiniappHandoff({ merchantId: MERCHANT_ID, source: "qr", payload }), /连接失败/);
  }
  const { module } = loadModule({ fetch: async () => assert.fail("missing media must fail before fetch") });
  await assert.rejects(module.createXhsMiniappHandoff({ merchantId: MERCHANT_ID, source: "qr", payload: { ...payload, assets: [] } }), /分享图片/);

  const offline = loadModule({ fetch: async () => { throw new TypeError("Network disconnected"); } });
  await assert.rejects(offline.module.createXhsMiniappHandoff({ merchantId: MERCHANT_ID, source: "qr", payload }), /暂时无法连接小红书/);
});

test("miniapp handoff timeout aborts the pending request and reports a retryable error", async () => {
  const scheduled = [], cleared = [];
  let requestSignal;
  const { module } = loadModule({
    timers: {
      setTimeout(callback, delay) { scheduled.push({ callback, delay }); return 1; },
      clearTimeout(id) { cleared.push(id); },
    },
    fetch: (_url, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    },
  });
  const pending = module.createXhsMiniappHandoff({ merchantId: MERCHANT_ID, source: "nfc", payload, timeoutMs: 1000 });
  assert.equal(scheduled[0].delay, 1000);
  scheduled[0].callback();
  await assert.rejects(pending, /连接小红书超时/);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(cleared, [1]);
});

test("caller cancellation stops a pending handoff without converting it into a timeout", async () => {
  const controller = new AbortController();
  const { module } = loadModule({
    fetch: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const pending = module.createXhsMiniappHandoff({ merchantId: MERCHANT_ID, source: "qr", payload, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("opening the miniapp is blocked locally and navigates only to a validated Xiaohongshu route in production", () => {
  const local = loadModule({ hostname: "127.0.0.1", fetch: async () => response() });
  assert.throws(() => local.module.openXhsMiniapp(LAUNCH_URL), /本地预览/);
  assert.deepEqual(local.navigations, []);

  const production = loadModule({ fetch: async () => response() });
  production.module.openXhsMiniapp(LAUNCH_URL);
  assert.deepEqual(production.navigations, [LAUNCH_URL]);
  assert.throws(() => production.module.openXhsMiniapp("https://evil.example.test/continue"), /地址无效/);
});
