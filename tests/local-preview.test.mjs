import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, request } from "node:http";
import ts from "typescript";
import vm from "node:vm";
import { fixtureResponse, isolatePublisherNavigation, previewDraft, previewProfile, previewShim, requestAllowed, startPreview } from "../scripts/preview-product.mjs";

const base = "http://127.0.0.1:5193";
const endpoint = name => new URL(`/.netlify/functions/${name}`, base);

test("preview fixtures contain only simulated data and never enable official sharing", () => {
  const merchant = fixtureResponse(endpoint("merchant-config"), "GET");
  assert.equal(merchant.status, 200);
  assert.equal(merchant.body.preview, true);
  assert.ok(merchant.body.profile.imageUrls.every(url => url.startsWith("/mock-assets/")));
  assert.equal(merchant.body.profile.meituanUrl, "");
  assert.equal(merchant.body.profile.dianpingUrl, "");
  const draft = fixtureResponse(endpoint("generate-draft"), "POST", { merchantId: previewProfile.id, platform: "redbook" });
  assert.equal(draft.body.draft.generationSource, "template");
  assert.equal(draft.body.draft, previewDraft);
  const xhs = fixtureResponse(endpoint("xhs-share"), "GET");
  assert.equal(xhs.body.enabled, false);
  assert.equal(xhs.body.verifyConfig, undefined);
  const event = fixtureResponse(endpoint("events"), "POST", { merchantId: previewProfile.id, eventType: "page_view" });
  assert.equal(event.body.persisted, false);
  const handoff = fixtureResponse(endpoint("share-handoff"), "POST", {
    merchantId: previewProfile.id, title: "本地草稿", body: "仅用于验收", tags: ["本地"], imageUrl: "/mock-assets/huizhi-car-yard-01.jpg",
  });
  assert.equal(handoff.status, 201);
  assert.equal(handoff.body.preview, true);
  assert.match(handoff.body.launchUrl, /^xhsdiscover:\/\/miniapp\//);
});

test("unknown API paths, admin writes, invalid fixtures, and methods fail closed", () => {
  for (const name of ["merchants", "admin-stats", "supabase", "generate-draft/extra", "unknown"]) {
    assert.equal(fixtureResponse(endpoint(name), "POST", {}).status, 403);
  }
  for (const name of ["merchant-config", "events", "generate-draft", "share-handoff", "xhs-share"]) {
    for (const method of ["PUT", "DELETE", "PATCH", "OPTIONS"]) assert.equal(fixtureResponse(endpoint(name), method, {}).status, 405);
  }
  assert.equal(fixtureResponse(endpoint("events"), "POST", { merchantId: "actual-merchant", eventType: "page_view" }).status, 400);
  assert.equal(fixtureResponse(endpoint("events"), "POST", { merchantId: previewProfile.id, eventType: "create_merchant" }).status, 400);
  assert.equal(fixtureResponse(endpoint("generate-draft"), "POST", null).status, 400);
  assert.equal(fixtureResponse(endpoint("generate-draft"), "POST", { merchantId: previewProfile.id, platform: "unsupported" }).status, 400);
});

test("loopback Host, Origin, Referer and request-path guards reject cross-origin access", () => {
  const req = { url: "/", headers: { host: "127.0.0.1:5193" } };
  assert.equal(requestAllowed(req, base), true);
  for (const headers of [
    { host: "evil.test:5193" }, { origin: "https://evil.test" }, { referer: "https://evil.test/" },
    { referer: "invalid" }, { authorization: "Bearer must-not-use" }, { "sec-fetch-site": "cross-site" },
  ]) assert.equal(requestAllowed({ ...req, headers: { ...req.headers, ...headers } }, base), false);
  for (const url of ["//evil.test", "/%2f.env", "/%5c.env", "/\\evil", "/%00"]) {
    assert.equal(requestAllowed({ ...req, url }, base), false);
  }
});

test("both direct publisher navigations are replaced by explicit failures without changing production source", async () => {
  const source = await readFile(new URL("../src/publishers.ts", import.meta.url), "utf8");
  const transformed = isolatePublisherNavigation(source);
  assert.equal(/window\.location\.href\s*=/.test(transformed), false);
  assert.throws(() => isolatePublisherNavigation(source.replace("window.location.href = webUrl;", "")), /navigation changed/);
  const output = ts.transpileModule(transformed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let navigations = 0;
  const exports = {};
  const context = vm.createContext({
    exports, navigator: { userAgent: "Android 14" }, Error, URL,
    window: { location: { set href(value) { navigations++; } } },
  });
  vm.runInContext(output, context);
  await assert.rejects(new exports.DeeplinkPublisher("home").publish({}), /./);
  await assert.rejects(exports.openReviewAppFirst("meituan", "https://www.meituan.com/"), /./);
  assert.equal(navigations, 0);
  assert.equal(await readFile(new URL("../src/publishers.ts", import.meta.url), "utf8"), source);
});

test("preview browser shim cancels native sharing and prevents external network calls", async () => {
  let fetched = 0;
  let xhrOpened = 0;
  class Xhr { open() { xhrOpened++; } }
  const listeners = new Map();
  const context = vm.createContext({
    URL, Request, Error, TypeError, DOMException, Element: class {},
    location: { origin: base, href: `${base}/` },
    navigator: { clipboard: { writeText: async () => {} } },
    document: {
      createElement() { return { setAttribute() {}, style: {} }; },
      body: { prepend() {} }, addEventListener(name, callback) { listeners.set(name, callback); },
    },
    XMLHttpRequest: Xhr,
    fetch: async () => { fetched++; return "local"; },
  });
  context.window = context;
  vm.runInContext(previewShim(), context);
  await assert.rejects(context.navigator.share({ text: "preview" }), { name: "AbortError" });
  assert.equal(await context.fetch(`${base}/.netlify/functions/xhs-share`), "local");
  await assert.rejects(context.fetch("https://production.supabase.co/rest/v1/merchants"));
  await assert.rejects(context.fetch("https://fe-static.xhscdn.com/biz-static/goten/xhs-1.0.1.js"));
  assert.equal(fetched, 1);
  const xhr = new context.XMLHttpRequest();
  xhr.open("GET", `${base}/`);
  assert.throws(() => xhr.open("POST", "https://paid-model.test/generate"));
  assert.equal(xhrOpened, 1);
  assert.equal(context.navigator.sendBeacon("https://external.test", "secret"), false);
  assert.throws(() => new context.WebSocket("wss://external.test"));
  assert.equal(context.open("xhsdiscover://home"), null);
  assert.equal(typeof context.navigator.clipboard.writeText, "function");
});

async function unusedPort() {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function localRequest(origin, pathname, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(pathname, origin), { method, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("real preview server isolates environment, denies secrets paths and handles only local fixture contracts", async () => {
  const previous = process.env.VITE_SUPABASE_URL;
  const previousBase = process.env.VITE_API_BASE_URL;
  process.env.VITE_SUPABASE_URL = "https://MUST-NOT-REACH-PRODUCTION.supabase.co";
  process.env.VITE_API_BASE_URL = "https://MUST-NOT-REACH-BACKEND.test";
  const port = await unusedPort();
  let preview;
  try {
    preview = await startPreview({ port });
    const { httpServer, config, origin } = preview;
    assert.equal(config.envFile, false);
    assert.equal(config.configFile, false);
    assert.equal(config.build.write, false);
    assert.equal(config.build.sourcemap, false);
    assert.equal(httpServer.address().address, "127.0.0.1");
    const html = await localRequest(origin, "/?keyword=off");
    assert.equal(html.status, 200);
    assert.match(html.text, /__local-preview\.js/);
    assert.doesNotMatch(html.text, /src="\/@vite\/client"/);
    assert.match(html.headers["content-security-policy"], /connect-src 'self'/);
    for (const pathname of ["/.env", "/.env.local", "/@fs/C:/Users/23679/.codex/config.toml", "/.git/config", "/package.json", "/netlify/functions/events.mjs", "/src/api.ts", "/src/../.env", "/unknown"]) {
      assert.equal((await localRequest(origin, pathname)).status, 403, pathname);
    }
    const script = html.text.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(script?.startsWith("/assets/"));
    for (const pathname of [script]) {
      const module = await localRequest(origin, pathname);
      assert.equal(module.status, 200, pathname);
      assert.doesNotMatch(module.text, /MUST-NOT-REACH/);
      assert.match(module.text, /const supabaseUrl = ""/);
      assert.match(module.text, /const supabaseAnonKey = ""/);
    }
    const requestBody = JSON.stringify({ merchantId: previewProfile.id, platform: "redbook" });
    const generated = await localRequest(origin, "/.netlify/functions/generate-draft", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: requestBody,
    });
    assert.equal(generated.status, 200);
    assert.equal(JSON.parse(generated.text).draft.generationSource, "template");
    assert.equal((await localRequest(origin, "/.netlify/functions/generate-draft", { method: "POST", headers: { "content-type": "application/json" }, body: requestBody })).status, 403);
    assert.equal((await localRequest(origin, "/", { headers: { Host: `evil.test:${port}` } })).status, 403);
    assert.equal((await localRequest(origin, "/", { headers: { Origin: "https://evil.test" } })).status, 403);
    assert.equal((await localRequest(origin, "/.netlify/functions/merchant-config", { method: "PUT", headers: { origin } })).status, 405);
    await assert.rejects(startPreview({ port }), /EADDRINUSE/);
  } finally {
    await preview?.close();
    if (previous === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = previous;
    if (previousBase === undefined) delete process.env.VITE_API_BASE_URL; else process.env.VITE_API_BASE_URL = previousBase;
  }
});
