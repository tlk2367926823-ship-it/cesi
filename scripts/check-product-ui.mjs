import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const output = new URL("../test-results/ui/", import.meta.url);
await mkdir(output, { recursive: true });
const port = Number(process.env.UI_TEST_PORT || 5187);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, env: { ...process.env, VITE_API_BASE_URL: "" }, stdio: "pipe", windowsHide: true,
});
let logs = "";
server.stdout.on("data", chunk => { logs += chunk; });
server.stderr.on("data", chunk => { logs += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
const profile = {
  id: "a90fd384-a296-4a95-98dd-b3e79fc36d93", name: "深圳汇职驾校", industry: "驾驶培训",
  description: "深圳本地驾校，提供科目二与科目三驾驶培训。", sellingPoints: ["教练指导", "实地训练", "练车安排"],
  serviceKeywords: ["科目二", "科目三"], featureKeywords: ["教练指导", "练车安排"], lengthOptions: ["简短自然", "详细一点"],
  imageUrls: ["/mock-assets/huizhi-car-yard-01.jpg", "/mock-assets/huizhi-training-base-02.jpg"],
  meituanUrl: "https://www.meituan.com/", dianpingUrl: "https://www.dianping.com/",
};
const draft = {
  title: "学车前想了解的几件事", body: "最近在整理深圳学车的信息，把汇职驾校加入了备选。\n\n比较关注练车安排和教练指导，想进一步了解实际服务。具体安排以到店确认为准。",
  tags: ["深圳学车", "驾校参考"], materialType: "image", style: "real_experience", cta: "了解实际信息",
  generationSource: "template", generationNotice: "测试模板，未调用真实 AI",
};
const pages = [];
let assertions = 0;
async function fixture({ viewport = { width: 390, height: 844 }, official = false, sdkFailure = false, profileFailure = false, generationDelay = 0 } = {}) {
  const context = await browser.newContext({ viewport, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36" });
  const page = await context.newPage();
  const state = { events: [], generateCalls: 0, handoffCalls: 0, profileFailure, generationFailure: false };
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => {
    window.__shareCalls = 0;
    window.__sdkCalls = 0;
    window.__shareMode = "cancel";
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => undefined }, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: () => {
      window.__shareCalls++;
      return new Promise((resolve, reject) => setTimeout(() => window.__shareMode === "cancel" ? reject(new DOMException("Cancelled", "AbortError")) : resolve(), 350));
    }, configurable: true });
  });
  await page.route("https://fe-static.xhscdn.com/biz-static/goten/xhs-1.0.1.js", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.xhs={share:function(o){window.__sdkCalls++;window.__lastSdk=o;${sdkFailure ? "o.fail({message:'fixture failure'});" : ""}}}`,
  }));
  await page.route("https://media.example.test/**", route => route.fulfill({
    path: fileURLToPath(new URL("../public/mock-assets/huizhi-car-yard-01.jpg", import.meta.url)),
    contentType: "image/jpeg", headers: { "access-control-allow-origin": origin },
  }));
  await page.route("**/.netlify/functions/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    let status = 200;
    if (path.endsWith("/merchant-config")) {
      status = state.profileFailure ? 503 : 200;
      body = state.profileFailure ? { ok: false } : { ok: true, profile: official
        ? { ...profile, imageUrls: ["https://media.example.test/store.jpg"] } : profile };
    } else if (path.endsWith("/events")) {
      state.events.push(route.request().postDataJSON());
      body = { ok: true };
    } else if (path.endsWith("/generate-draft")) {
      state.generateCalls++;
      await delay(generationDelay);
      status = state.generationFailure ? 503 : 200;
      body = state.generationFailure ? { ok: false, message: "测试网络故障" } : { ok: true, draft };
    } else if (path.endsWith("/xhs-share")) {
      body = official ? {
        enabled: true, message: "官方分享已准备",
        verifyConfig: { appKey: "test-app", nonce: "fixture", timestamp: String(Date.now()), signature: "a".repeat(64) },
        validUntil: Date.now() + 300000,
      } : { enabled: false, message: "尚未开通" };
    } else if (path.endsWith("/share-handoff")) {
      state.handoffCalls++;
      status = 201;
      body = {
        ok: true,
        handoffId: "11111111-1111-4111-8111-111111111111",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        launchUrl: "xhsdiscover://miniapp/6a4c8abbdb457600012f5b25/pages/index/index?handoffId=11111111-1111-4111-8111-111111111111",
      };
    } else {
      throw new Error(`Unexpected function request: ${path}`);
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  // Any accidental account or production request fails rather than touching live data.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ["fe-static.xhscdn.com", "media.example.test"].includes(url.hostname)) return route.fallback();
    throw new Error(`Unexpected external request: ${url.origin}`);
  });
  await page.goto(`${origin}/?keyword=off`);
  pages.push({ context, page, errors });
  return { context, page, state, errors };
}
async function generate(page) {
  await page.getByRole("button", { name: "生成分享草稿", exact: true }).click();
  await page.getByRole("heading", { name: draft.title }).waitFor();
  await page.locator(".asset-actions button").first().waitFor();
}
async function openFallbacks(page) {
  const panel = page.locator(".fallback-panel");
  if (!(await panel.evaluate(element => element.open))) await panel.locator("summary").click();
}
async function checkLayout(page, name) {
  await page.waitForFunction(() => [...document.images].filter(image => image.getClientRects().length).every(image => image.complete));
  await page.evaluate(() => window.scrollTo(0, 0));
  const issues = await page.evaluate(() => {
    const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    const buttons = [...document.querySelectorAll("button")].filter(visible);
    return {
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      overflows: buttons.filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.textContent),
      brokenImages: [...document.images].filter(visible).filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src),
      tinyButtons: buttons.filter(element => element.getBoundingClientRect().height < 36).map(element => element.textContent),
      imageCovered: [...document.querySelectorAll(".preview-card")].some(element => {
        const image = element.querySelector("img")?.getBoundingClientRect();
        const caption = element.querySelector(".asset-caption")?.getBoundingClientRect();
        return image && caption && image.bottom > caption.top + 1;
      }),
    };
  });
  assert.equal(issues.pageOverflow, false, `${name}: page overflow`);
  assert.deepEqual(issues.overflows, [], `${name}: button overflow`);
  assert.deepEqual(issues.brokenImages, [], `${name}: broken images`);
  assert.deepEqual(issues.tinyButtons, [], `${name}: small targets`);
  assert.equal(issues.imageCovered, false, `${name}: image obscured by toolbar`);
  assertions += 5;
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)), fullPage: true });
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite failed: ${logs}`);
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (attempt === 99) throw new Error(`Vite did not start: ${logs}`);
    await delay(100);
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const viewport of [{ width: 320, height: 680 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
    const { page } = await fixture({ viewport });
    await page.getByRole("heading", { name: profile.name, exact: true }).waitFor();
    await page.locator(".merchant-gallery img").first().evaluate(image => image.decode());
    await checkLayout(page, `intro-${viewport.width}`);
    await generate(page);
    await page.locator(".preview-card img").evaluate(image => image.decode());
    await checkLayout(page, `draft-${viewport.width}`);
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    await openFallbacks(page);
    await page.getByRole("button", { name: "打开系统分享", exact: true }).waitFor();
    await checkLayout(page, `publish-${viewport.width}`);
  }
  {
    const { page, state } = await fixture();
    await generate(page);
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    await openFallbacks(page);
    const share = page.getByRole("button", { name: "打开系统分享", exact: true });
    await share.waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "打开系统分享")?.disabled);
    await share.evaluate(button => { button.click(); button.click(); });
    await page.getByText("已取消分享，草稿已保留", { exact: true }).waitFor();
    await delay(2800);
    assert.equal(await page.evaluate(() => window.__shareCalls), 1);
    assert.equal(page.url(), `${origin}/?keyword=off`);
    assert.equal(state.events.filter(event => event.eventType === "share_click").length, 0);
    await page.reload();
    await page.getByRole("heading", { name: draft.title }).waitFor();
    assert.equal(state.generateCalls, 1);
    assertions += 4;
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    await openFallbacks(page);
    await page.evaluate(() => { window.__shareMode = "success"; });
    await page.getByRole("button", { name: "打开系统分享", exact: true }).click();
    await page.getByText("已交给系统分享，最终发布状态请在目标平台确认", { exact: true }).waitFor();
    assertions++;
  }
  {
    const { page, state } = await fixture();
    await generate(page);
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    const openMiniapp = page.getByRole("button", { name: "打开小红书小程序", exact: true });
    await openMiniapp.evaluate(button => { button.click(); button.click(); });
    await page.getByText("本地预览已完成草稿交接，但不会打开小红书；部署后可进行真机测试", { exact: true }).waitFor();
    assert.equal(state.handoffCalls, 1);
    assert.equal(state.events.filter(event => event.eventType === "share_click").length, 0);
    await delay(1200);
    assert.equal(await openMiniapp.isDisabled(), false);
    assertions += 3;
  }
  {
    const { page, state } = await fixture({ profileFailure: true });
    await page.getByRole("heading", { name: "商家资料暂不可用" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "生成分享草稿", exact: true }).isVisible(), false);
    state.profileFailure = false;
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await page.getByRole("heading", { name: profile.name, exact: true }).waitFor();
    state.generationFailure = true;
    await page.getByRole("button", { name: "生成分享草稿", exact: true }).click();
    await page.getByText("测试网络故障", { exact: true }).waitFor();
    state.generationFailure = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByRole("heading", { name: draft.title }).waitFor();
    assertions += 2;
  }
  {
    const { page, state } = await fixture({ generationDelay: 700 });
    await page.getByRole("button", { name: "生成分享草稿", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await delay(1100);
    assert.equal(await page.getByRole("heading", { name: profile.name, exact: true }).isVisible(), true);
    assert.ok(state.generateCalls <= 1);
    assertions += 2;
  }
  {
    const { page } = await fixture({ official: true, sdkFailure: true });
    await generate(page);
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    await openFallbacks(page);
    await page.getByRole("button", { name: "复制完整文案", exact: true }).click();
    await page.getByRole("button", { name: "网页官方分享", exact: true }).click();
    await page.getByText("小红书官方分享未完成，可重试或主动选择备用方式。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__sdkCalls), 1);
    assert.equal(await page.evaluate(() => window.__shareCalls), 0);
    const info = await page.evaluate(() => window.__lastSdk.shareInfo);
    assert.equal(info.type, "normal");
    assert.equal("title" in info, false);
    assert.equal("content" in info, false);
    assertions += 5;
  }
  {
    const { page } = await fixture({ official: true });
    await generate(page);
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    await openFallbacks(page);
    const share = page.getByRole("button", { name: "网页官方分享", exact: true });
    await share.waitFor();
    assert.equal(await share.isDisabled(), true, "Official sharing requires an explicit copy first");
    await page.getByRole("button", { name: "复制完整文案", exact: true }).click();
    await share.click();
    await delay(1200);
    await share.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.__sdkCalls), 1);
    assert.equal(await share.isDisabled(), true, "Official launch remains locked while awaiting a result");
    assertions += 3;
  }
  {
    const { page } = await fixture({ viewport: { width: 320, height: 680 } });
    await page.goto(`${origin}/?keyword=on`);
    await page.getByRole("button", { name: "选择分享重点", exact: true }).click();
    await page.getByRole("dialog", { name: "分享重点" }).waitFor();
    await page.getByRole("checkbox").first().check();
    await checkLayout(page, "keywords-320");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), false);
    assertions++;
    await page.goto(`${origin}/admin`);
    await page.getByRole("heading", { name: "滔田 AI 商家后台", exact: true }).waitFor();
    await checkLayout(page, "admin-login-320");
  }
  {
    const { page } = await fixture();
    await generate(page);
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => new Promise(resolve => { window.__resolveCopy = resolve; });
    });
    await page.getByRole("button", { name: "复制文案", exact: true }).click();
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
    await page.getByRole("heading", { name: draft.title }).waitFor();
    await page.evaluate(() => window.__resolveCopy());
    await delay(50);
    assert.equal(await page.getByRole("button", { name: "已复制文案", exact: true }).isVisible(), false);
    assertions++;
  }
  {
    const { page } = await fixture({ official: true });
    await generate(page);
    await page.getByRole("button", { name: "准备分享到小红书" }).click();
    await openFallbacks(page);
    await page.getByRole("button", { name: "复制完整文案", exact: true }).click();
    await page.getByRole("button", { name: "网页官方分享", exact: true }).waitFor();
    await page.evaluate(() => { const previousNow = Date.now; Date.now = () => previousNow() + 400000; });
    await page.getByRole("button", { name: "网页官方分享", exact: true }).click();
    await page.getByText("正在更新官方通道，请准备完成后再次点击分享", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__sdkCalls), 0);
    assertions++;
  }
  for (const { errors } of pages) assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(`UI checks passed: ${assertions} assertions, 14 screenshots, isolated Microsoft Edge. No live accounts, uploads or AI calls.`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once("exit", resolve));
}
