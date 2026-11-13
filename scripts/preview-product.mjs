import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const functionPrefix = "/.netlify/functions/";
const previewMessage = "\u672c\u5730\u9a8c\u6536\u9884\u89c8\uff1a\u6a21\u62df\u6570\u636e\uff0c\u672a\u8fde\u63a5\u6570\u636e\u5e93\u6216 AI\uff0c\u4e0d\u4f1a\u6253\u5f00\u5916\u90e8\u5e94\u7528\u3002";
const blockedNavigation = "\u672c\u5730\u9884\u89c8\u5df2\u62e6\u622a\u5916\u90e8\u8df3\u8f6c\uff0c\u672a\u53d1\u5e03\u4efb\u4f55\u5185\u5bb9\u3002";
export const previewProfile = Object.freeze({
  id: "a90fd384-a296-4a95-98dd-b3e79fc36d93",
  name: "\u6df1\u5733\u6c47\u804c\u9a7e\u6821\uff08\u6a21\u62df\u6570\u636e\uff09",
  industry: "\u9a7e\u9a76\u57f9\u8bad",
  description: "\u672c\u5730\u9a8c\u6536\u4f7f\u7528\u7684\u6a21\u62df\u5546\u5bb6\u8d44\u6599\uff0c\u4e0d\u4ee3\u8868\u7ebf\u4e0a\u914d\u7f6e\u3002",
  sellingPoints: ["\u6559\u7ec3\u6307\u5bfc", "\u5b9e\u5730\u8bad\u7ec3", "\u7ec3\u8f66\u5b89\u6392"],
  serviceKeywords: ["\u79d1\u76ee\u4e8c", "\u79d1\u76ee\u4e09"],
  featureKeywords: ["\u6559\u7ec3\u6307\u5bfc", "\u7ec3\u8f66\u5b89\u6392"],
  lengthOptions: ["\u7b80\u77ed\u81ea\u7136", "\u8be6\u7ec6\u4e00\u70b9"],
  imageUrls: ["/mock-assets/huizhi-car-yard-01.jpg", "/mock-assets/huizhi-training-base-02.jpg"],
  meituanUrl: "", dianpingUrl: "", xiaohongshuUrl: "",
});
export const previewDraft = Object.freeze({
  title: "\u5b66\u8f66\u524d\u60f3\u4e86\u89e3\u7684\u51e0\u4ef6\u4e8b",
  body: "\u3010\u672c\u5730\u6a21\u677f\u9884\u89c8\uff0c\u975e\u771f\u5b9e AI \u751f\u6210\u3011\n\n\u6700\u8fd1\u5728\u6574\u7406\u6df1\u5733\u5b66\u8f66\u7684\u4fe1\u606f\uff0c\u6bd4\u8f83\u5173\u6ce8\u7ec3\u8f66\u5b89\u6392\u548c\u6559\u7ec3\u6307\u5bfc\u3002\u60f3\u8fdb\u4e00\u6b65\u4e86\u89e3\u5b9e\u9645\u670d\u52a1\uff0c\u5177\u4f53\u5b89\u6392\u4ee5\u5230\u5e97\u786e\u8ba4\u4e3a\u51c6\u3002",
  tags: ["\u6df1\u5733\u5b66\u8f66", "\u9a7e\u6821\u53c2\u8003"],
  materialType: "image", style: "real_experience", cta: "\u4e86\u89e3\u5b9e\u9645\u4fe1\u606f",
  generationSource: "template", generationNotice: previewMessage,
});

function response(status, body) { return { status, body }; }
function failure(status, message) { return response(status, { ok: false, preview: true, message }); }
function validObject(body) { return body && typeof body === "object" && !Array.isArray(body); }

export function fixtureResponse(url, method, body) {
  const endpoint = url.pathname.slice(functionPrefix.length);
  if (!url.pathname.startsWith(functionPrefix)) return failure(404, "Local preview endpoint not found");
  const methods = { "merchant-config": "GET", events: "POST", "generate-draft": "POST", "share-handoff": "POST", "xhs-share": "GET" };
  if (!Object.hasOwn(methods, endpoint)) return failure(403, "Backend and admin operations are disabled in this local preview");
  if (method !== methods[endpoint]) return failure(405, "Method disabled in local preview");
  if (method === "GET") {
    const merchantId = url.searchParams.get("merchantId");
    if (merchantId && merchantId !== previewProfile.id) return failure(404, "Only the simulated merchant is available");
    if (endpoint === "merchant-config") return response(200, { ok: true, preview: true, visibility: "public", profile: previewProfile });
    return response(200, { enabled: false, preview: true, message: "\u672c\u5730\u9884\u89c8\uff1a\u5b98\u65b9\u5206\u4eab\u5173\u95ed\uff0c\u7533\u8bf7\u5c1a\u5728\u5ba1\u6838\u3002" });
  }
  if (!validObject(body) || body.merchantId !== previewProfile.id) return failure(400, "Invalid simulated merchant request");
  if (endpoint === "events") {
    if (!["page_view", "share_click", "nfc_scan", "qr_scan"].includes(body.eventType)) return failure(400, "Unsupported local event");
    return response(200, { ok: true, preview: true, persisted: false });
  }
  if (endpoint === "share-handoff") {
    if (typeof body.title !== "string" || typeof body.body !== "string" || !Array.isArray(body.tags) || typeof body.imageUrl !== "string") {
      return failure(400, "Invalid simulated handoff");
    }
    return response(201, {
      ok: true,
      preview: true,
      handoffId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      launchUrl: "xhsdiscover://miniapp/6a4c8abbdb457600012f5b25/pages/index/index?handoffId=11111111-1111-4111-8111-111111111111",
    });
  }
  if (!["redbook", "meituan", "dianping"].includes(body.platform)) return failure(400, "Invalid preview platform");
  return response(200, { ok: true, preview: true, draft: previewDraft });
}

export function requestAllowed(req, origin) {
  const expected = new URL(origin);
  if (req.headers.host !== expected.host) return false;
  if (req.headers.origin && req.headers.origin !== origin) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  if (req.headers.authorization) return false;
  if (req.headers.referer) {
    try { if (new URL(req.headers.referer).origin !== origin) return false; } catch { return false; }
  }
  if (!req.url?.startsWith("/") || req.url.startsWith("//") || /\\|%2f|%5c|%00/i.test(req.url)) return false;
  return true;
}

export function isolatePublisherNavigation(code) {
  const tree = ts.createSourceFile("publishers.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const replacements = [];
  function visit(node) {
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) &&
        node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.expression.left.getText(tree) === "window.location.href") {
      replacements.push({ start: node.getStart(tree), end: node.end });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (replacements.length !== 2) throw new Error("Publisher navigation changed; inspect the local preview guards before starting");
  for (const item of replacements.reverse()) code = code.slice(0, item.start) + `throw new Error(${JSON.stringify(blockedNavigation)});` + code.slice(item.end);
  return code;
}

export function previewShim() {
  return `(() => {
    "use strict";
    const message = ${JSON.stringify(previewMessage)};
    const origin = window.location.origin;
    const allowed = value => { try { const u = new URL(value, location.href); return u.origin === origin && ["http:", "blob:"].includes(u.protocol); } catch { return false; } };
    const deny = () => { throw new Error("Local preview blocks external operations"); };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!allowed(url)) return Promise.reject(new TypeError("Local preview blocks external requests"));
      return originalFetch(input, init);
    };
    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) { if (!allowed(url)) deny(); return xhrOpen.call(this, method, url, ...rest); };
    window.open = () => null;
    for (const name of ["WebSocket", "EventSource", "Worker", "SharedWorker"]) Object.defineProperty(window, name, { configurable: false, writable: false, value: class { constructor() { deny(); } } });
    Object.defineProperty(navigator, "sendBeacon", { configurable: false, value: () => false });
    Object.defineProperty(navigator, "canShare", { configurable: false, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: false, value: async () => { throw new DOMException("Cancelled in local preview", "AbortError"); } });
    document.addEventListener("click", event => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link && !allowed(link.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    const notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.setAttribute("data-local-preview", "");
    notice.textContent = message;
    notice.style.cssText = "position:relative;z-index:1000;background:#ecfdf5;color:#115e59;border-bottom:1px solid #99f6e4;padding:10px 16px;font:13px/1.5 system-ui,sans-serif;letter-spacing:0;overflow-wrap:anywhere";
    document.body.prepend(notice);
    document.title = "\\u6ed4\\u7530 AI | \\u672c\\u5730\\u9a8c\\u6536 | \\u6a21\\u62df\\u6570\\u636e";
  })();`;
}

function json(res, result) {
  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.body));
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new Error("JSON required");
  if (Number(req.headers["content-length"]) > 32768) throw new Error("Body too large");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startPreview({ port = 5193 } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Use an integer port between 1024 and 65535");
  const origin = `http://127.0.0.1:${port}`;
  const publishersFile = path.join(root, "src/publishers.ts");
  const publisherSource = await readFile(publishersFile, "utf8");
  isolatePublisherNavigation(publisherSource);
  const appSource = await readFile(path.join(root, "src/App.tsx"), "utf8");
  if (/location\.(?:href\s*=|assign\s*\(|replace\s*\()|window\.open\s*\(/.test(appSource)) throw new Error("App navigation changed; inspect preview isolation");
  const previewPlugin = {
    name: "local-acceptance-only",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0].replaceAll("\\", "/") === publishersFile.replaceAll("\\", "/")) return isolatePublisherNavigation(code);
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/<script type="module" src="\/@vite\/client"><\/script>/g, "")
          .replace('<div id="root"></div>', '<script src="/__local-preview.js"></script><div id="root"></div>');
      },
    },
  };
  let resources;
  const httpServer = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
        res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), web-share=()");
        if (!requestAllowed(req, origin)) return json(res, failure(403, "Only same-origin loopback preview requests are allowed"));
        const url = new URL(req.url, origin);
        if (url.pathname.startsWith(functionPrefix)) {
          if (!["GET", "POST"].includes(req.method)) return json(res, failure(405, "Method disabled in local preview"));
          if (req.method === "POST" && req.headers.origin !== origin) return json(res, failure(403, "Same-origin request required"));
          try {
            const body = req.method === "POST" ? await readJson(req) : undefined;
            return json(res, fixtureResponse(url, req.method, body));
          } catch {
            return json(res, failure(400, "Invalid local preview JSON request"));
          }
        }
        if (req.method !== "GET") return json(res, failure(403, "Resource disabled in local preview"));
        if (!resources) return json(res, failure(503, "Local preview is building"));
        const pathname = ["/", "/admin", "/admin/"].includes(url.pathname) ? "/index.html" : url.pathname;
        const resource = resources.get(pathname);
        if (!resource) return json(res, failure(403, "Resource disabled in local preview"));
        res.setHeader("Content-Type", resource.type);
        res.end(resource.body);
  });
  httpServer.requestTimeout = 15000;
  httpServer.headersTimeout = 10000;
  const close = () => new Promise((resolve, reject) => {
    httpServer.close(error => error ? reject(error) : resolve());
    httpServer.closeIdleConnections();
  });
  // Reserve the exact port before building; an occupied port never falls back to another host or port.
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => { httpServer.removeListener("error", reject); resolve(); });
  });
  const config = {
    root, configFile: false, envFile: false, publicDir: false, mode: "local-acceptance", envPrefix: "__TAOTIAN_LOCAL_PREVIEW_UNUSED_",
    clearScreen: false, logLevel: "error", plugins: [previewPlugin, react()],
    define: {
      "import.meta.env.VITE_API_BASE_URL": '""',
      "import.meta.env.VITE_SUPABASE_URL": '""',
      "import.meta.env.VITE_SUPABASE_ANON_KEY": '""',
      "import.meta.env.VITE_DASHSCOPE_API_KEY": '""',
      "import.meta.env.VITE_DASHSCOPE_MODEL": '""',
    },
    build: { write: false, sourcemap: false, minify: false, emptyOutDir: false },
  };
  try {
    const result = await build(config);
    const bundles = Array.isArray(result) ? result : [result];
    resources = new Map();
    for (const bundle of bundles) {
      for (const item of bundle.output) {
        const type = item.fileName.endsWith(".html") ? "text/html; charset=utf-8" :
          item.fileName.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
        resources.set(`/${item.fileName}`, { type, body: item.type === "chunk" ? item.code : item.source });
      }
    }
    resources.set("/__local-preview.js", { type: "application/javascript; charset=utf-8", body: previewShim() });
    for (const asset of previewProfile.imageUrls) {
      resources.set(asset, { type: "image/jpeg", body: await readFile(path.join(root, "public", asset)) });
    }
    if (!resources.has("/index.html")) throw new Error("Local preview build has no entry page");
    const address = httpServer.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1" || address.port !== port) throw new Error("Preview did not bind the requested loopback address");
  } catch (error) {
    await close();
    throw error;
  }
  return { httpServer, close, config, origin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: node scripts/preview-product.mjs [port]");
  const { close, origin } = await startPreview({ port: args[0] ? Number(args[0]) : 5193 });
  console.log(`LOCAL SIMULATION ONLY: ${origin}/?keyword=off`);
  console.log("No production database, model, auth, SDK or external-app operations. Ctrl+C stops the preview.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void close().then(() => process.exit(0)); });
}
