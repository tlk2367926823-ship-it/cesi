import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const realDate = Date;

function loadModule(name, globals = {}, dependencies = {}) {
  const source = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const context = vm.createContext({
    exports,
    require: (id) => id in dependencies ? dependencies[id] : id === "./api" ? { apiUrl: (path) => path } : require(id),
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Error,
    ...globals,
  });
  vm.runInContext(output, context, { filename: name });
  return exports;
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function analyticsHarness() {
  let current = new realDate("2026-09-14T15:59:00Z").getTime();
  class Clock extends realDate {
    constructor(...args) { super(...(args.length ? args : [current])); }
    static now() { return current; }
    getFullYear() { return new realDate(this.getTime() + 8 * 3600000).getUTCFullYear(); }
    getMonth() { return new realDate(this.getTime() + 8 * 3600000).getUTCMonth(); }
    getDate() { return new realDate(this.getTime() + 8 * 3600000).getUTCDate(); }
  }
  const window = {
    localStorage: storage(),
    sessionStorage: storage(),
    location: { search: "", pathname: "/", href: "https://example.test/" },
  };
  const sent = [];
  const module = loadModule("analytics.ts", {
    window, Date: Clock, navigator: { userAgent: "test" },
    fetch: async (_url, options) => {
      sent.push(options);
      return { ok: true };
    },
  });
  return { module, window, sent, setTime: (time) => { current = new realDate(time).getTime(); } };
}

test("profile failures never resolve to editable defaults", async () => {
  for (const status of [404, 500]) {
    const module = loadModule("merchantProfile.ts", {
      fetch: async () => ({ ok: false, status }),
    });
    await assert.rejects(module.fetchMerchantProfile({ merchantId: "real-merchant" }), (error) =>
      error.name === "MerchantProfileError" && error.code === (status === 404 ? "not-found" : "unavailable"));
  }
  const module = loadModule("merchantProfile.ts", { fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(module.fetchMerchantProfile({ merchantId: "real-merchant" }), { code: "unavailable" });
  assert.equal(module.defaultMerchantProfile.name, "\u672c\u5730\u5546\u5bb6");
});

test("profile identity must match the requested merchant", async () => {
  const module = loadModule("merchantProfile.ts", {
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, profile: { id: "other", name: "Other" } }) }),
  });
  await assert.rejects(module.fetchMerchantProfile({ merchantId: "requested" }), { code: "invalid-response" });
});

test("successful profile reads retain configured values", async () => {
  const module = loadModule("merchantProfile.ts", {
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, profile: { id: "a", name: "Store A", imageUrls: ["https://example.test/a.jpg"] } }) }),
  });
  const profile = await module.fetchMerchantProfile({ merchantId: "a" });
  assert.equal(profile.name, "Store A");
  assert.deepEqual(Array.from(profile.imageUrls), ["https://example.test/a.jpg"]);
});

test("editable profile reads send authorization and preserve intentionally empty private fields", async () => {
  let requestOptions;
  const module = loadModule("merchantProfile.ts", {
    fetch: async (_url, options) => {
      requestOptions = options;
      return { ok: true, json: async () => ({
        ok: true, visibility: "private",
        profile: {
          id: "a", name: "Store A", contactName: "", contactPhone: "", promptProfile: "",
          description: "", sellingPoints: [], serviceKeywords: [], featureKeywords: [], lengthOptions: [],
        },
      }) };
    },
  });
  const value = await module.fetchMerchantProfile({ merchantId: "a", accessToken: "test-token" });
  assert.equal(requestOptions.headers.authorization, "Bearer test-token");
  assert.equal(value.promptProfile, "");
  assert.equal(value.description, "");
  assert.deepEqual(Array.from(value.sellingPoints), []);
  assert.deepEqual(Array.from(value.lengthOptions), []);
});

test("editable profile reads reject public responses and permission failures without anonymous retry", async () => {
  for (const scenario of [
    { ok: true, json: async () => ({ ok: true, visibility: "public", profile: { id: "a" } }) },
    { ok: true, json: async () => ({ ok: true, visibility: "private", profile: { id: "a" } }) },
    { ok: false, status: 401 },
    { ok: false, status: 403 },
  ]) {
    let requests = 0;
    const module = loadModule("merchantProfile.ts", { fetch: async () => { requests += 1; return scenario; } });
    await assert.rejects(module.fetchMerchantProfile({ merchantId: "a", accessToken: "test-token" }));
    assert.equal(requests, 1);
  }
});

test("profile reads accept caller cancellation", async () => {
  const controller = new AbortController();
  const module = loadModule("merchantProfile.ts", {
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }),
  });
  const request = module.fetchMerchantProfile({ merchantId: "a", signal: controller.signal });
  controller.abort();
  await assert.rejects(request, /cancelled/);
});

test("save responses must identify the merchant that was saved", async () => {
  const module = loadModule("merchantProfile.ts", {
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, profile: { id: "other" } }) }),
  });
  await assert.rejects(module.saveMerchantProfile({ id: "requested" }, "test-token"));
});

test("cloud stats failures do not silently return local demonstration counts", async () => {
  for (const status of [401, 403, 500]) {
    const module = loadModule("analytics.ts", { fetch: async () => ({ ok: false, status }) });
    await assert.rejects(module.fetchAdminStats("2026-09-15", "test-token"));
  }
});

test("invalid cloud statistics are rejected", async () => {
  const module = loadModule("analytics.ts", {
    fetch: async () => ({ ok: true, json: async () => ({ merchants: [], generatedAt: "bad" }) }),
  });
  await assert.rejects(module.fetchAdminStats("2026-09-15", "test-token"));
});

test("local dates and daily counts roll over at local midnight, preserving totals", async () => {
  const { module, setTime, sent } = analyticsHarness();
  module.trackProductEntry("merchant", "Store");
  module.trackProductEntry("merchant", "Store");
  module.trackShareClick("merchant", "Store", "redbook");
  let snapshot = module.getAdminStats();
  let row = snapshot.merchants.find((item) => item.merchantId === "merchant");
  assert.equal(snapshot.source, "local");
  assert.equal(snapshot.date, "2026-09-14");
  assert.equal(row.todayEntries, 1);
  assert.equal(row.redbookShares, 1);
  setTime("2026-09-14T16:01:00Z");
  snapshot = module.getAdminStats();
  row = snapshot.merchants.find((item) => item.merchantId === "merchant");
  assert.equal(snapshot.date, "2026-09-15");
  assert.equal(row.todayEntries, 0);
  assert.equal(row.redbookShares, 0);
  assert.equal(row.totalEntries, 1);
  module.trackProductEntry("merchant", "Store");
  row = module.getAdminStats().merchants.find((item) => item.merchantId === "merchant");
  assert.equal(row.todayEntries, 1);
  assert.equal(row.totalEntries, 2);
  assert.equal(JSON.parse(sent.at(-1).body).metadata.date, "2026-09-15");
});

test("legacy local statistics migrate without carrying yesterday into today", () => {
  const { module, window, setTime } = analyticsHarness();
  window.localStorage.setItem("huizhi_admin_stats_v1", JSON.stringify([{
    merchantId: "old", merchantName: "Store", todayEntries: 9, totalEntries: 40,
    redbookShares: 3, meituanShares: 2, dianpingShares: 1, updatedAt: "2026-09-13T15:00:00Z",
  }]));
  setTime("2026-09-14T16:01:00Z");
  const row = module.getAdminStats().merchants[0];
  assert.equal(row.todayEntries, 0);
  assert.equal(row.totalEntries, 40);
  assert.equal(row.redbookShares, 0);
  assert.equal(JSON.parse(window.localStorage.getItem("huizhi_admin_stats_v1")).date, "2026-09-15");
});

test("blocked browser storage does not break entry or share workflows", () => {
  const { module, window } = analyticsHarness();
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  window.localStorage = blocked;
  window.sessionStorage = blocked;
  module.trackProductEntry("merchant", "Store");
  module.trackProductEntry("merchant", "Store");
  module.trackShareClick("merchant", "Store", "meituan");
  const row = module.getAdminStats().merchants.find((item) => item.merchantId === "merchant");
  assert.equal(row.todayEntries, 1);
  assert.equal(row.meituanShares, 1);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function hookHarness() {
  const slots = [];
  let cursor = 0, effects = [], dirty = false, tree, component;
  const changed = (left, right) => !left || left.length !== right.length || left.some((value, index) => !Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next) => {
        const value = typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(value) {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) {
        const prior = slots[index];
        slots[index] = { deps };
        effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  return {
    react, jsx,
    mount(value) { component = value; dirty = true; },
    async flush() {
      for (let turn = 0; turn < 20; turn += 1) {
        if (dirty) {
          dirty = false; cursor = 0; tree = component();
          const pending = effects; effects = [];
          pending.forEach((run) => run());
        }
        await new Promise((resolve) => setImmediate(resolve));
        if (!dirty && !effects.length) return tree;
      }
      throw new Error("Hook harness did not settle");
    },
    nodes(predicate) {
      const result = [];
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (predicate(node)) result.push(node);
        visit(node.props?.children);
      };
      visit(tree);
      return result;
    },
  };
}

function merchantStats(id) {
  return { merchantId: id, merchantName: `Store ${id}`, todayEntries: 1, totalEntries: 2, redbookShares: 0, meituanShares: 0, dianpingShares: 0, updatedAt: "2026-09-15T01:00:00Z" };
}

function profile(id) {
  return { id, name: `Store ${id}`, industry: "Test", sellingPoints: [], imageUrls: [], serviceKeywords: [], featureKeywords: [], lengthOptions: [] };
}

async function dashboardHarness({ failStats = false, deferStats = false, crypto } = {}) {
  const hooks = hookHarness();
  const profiles = [], saves = [], stats = [], uploads = [];
  const cloud = { source: "cloud", date: "2026-09-15", generatedAt: "2026-09-15T01:00:00Z", merchants: [merchantStats("A"), merchantStats("B")], viewer: { role: "admin", merchantId: null } };
  const deps = {
    react: hooks.react,
    "react/jsx-runtime": { jsx: hooks.jsx, jsxs: hooks.jsx, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_target, key) => key }),
    "./AdminLogin": { AdminLogin: "AdminLogin" },
    "./analytics": {
      localDateKey: () => "2026-09-15",
      getAdminStats: () => ({ ...cloud, source: "local", viewer: undefined }),
      resetAdminStats: () => undefined,
      fetchAdminStats: async (date) => {
        if (failStats) throw new Error("Cloud unavailable");
        if (deferStats) {
          const task = deferred(); stats.push({ ...task, date }); return task.promise;
        }
        return cloud;
      },
    },
    "./merchantProfile": {
      fetchMerchantProfile: (params) => {
        const task = deferred(); profiles.push({ ...task, params }); return task.promise;
      },
      saveMerchantProfile: (value) => {
        const task = deferred(); saves.push({ ...task, value }); return task.promise;
      },
    },
    "./supabaseClient": {
      isSupabaseAuthConfigured: true,
      supabase: { auth: {
        getSession: async () => ({ data: { session: { access_token: "test-token", user: { id: "user", email: "test@example.test" } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      }, storage: { from: () => ({
        upload: (path) => { const task = deferred(); uploads.push({ ...task, path }); return task.promise; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://example.test/${path}` } }),
      }) } },
    },
  };
  const module = loadModule("AdminDashboard.tsx", { window: { location: { origin: "https://example.test" } }, crypto }, deps);
  hooks.mount(module.AdminDashboard);
  await hooks.flush();
  return { hooks, profiles, saves, stats, cloud, uploads };
}

test("a late merchant response cannot replace the currently selected merchant", async () => {
  const { hooks, profiles } = await dashboardHarness();
  assert.equal(profiles[0].params.merchantId, "A");
  assert.equal(profiles[0].params.accessToken, "test-token");
  hooks.nodes((node) => node.type === "select")[0].props.onChange({ target: { value: "B" } });
  await hooks.flush();
  assert.equal(profiles[1].params.accessToken, "test-token");
  assert.equal(profiles[0].params.signal.aborted, true);
  profiles[1].resolve(profile("B"));
  await hooks.flush();
  profiles[0].resolve(profile("A"));
  await hooks.flush();
  const inputs = hooks.nodes((node) => node.type === "input" && node.props.value === "Store B");
  assert.equal(inputs.length, 1);
  assert.equal(hooks.nodes((node) => node.type === "input" && node.props.value === "Store A").length, 0);
});

test("failed profile loads hide editable defaults and expose retry", async () => {
  const { hooks, profiles, saves } = await dashboardHarness();
  profiles[0].reject(new Error("Profile unavailable"));
  await hooks.flush();
  assert.equal(hooks.nodes((node) => node.type === "button" && node.props.className === "admin-save-profile").length, 0);
  const form = hooks.nodes((node) => node.type === "form" && node.props.className === "admin-profile-form")[0];
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(saves.length, 0);
  const retry = hooks.nodes((node) => node.type === "button" && node.props.children?.[1] === "\u91cd\u65b0\u8bfb\u53d6\u8d44\u6599")[0];
  assert.ok(retry);
  retry.props.onClick();
  await hooks.flush();
  profiles[1].resolve(profile("A"));
  await hooks.flush();
  assert.equal(hooks.nodes((node) => node.type === "button" && node.props.className === "admin-save-profile")[0].props.disabled, false);
});

test("save requests are single flight and stale save responses do not overwrite another merchant", async () => {
  const { hooks, profiles, saves } = await dashboardHarness();
  profiles[0].resolve(profile("A"));
  await hooks.flush();
  const form = hooks.nodes((node) => node.type === "form" && node.props.className === "admin-profile-form")[0];
  const first = form.props.onSubmit({ preventDefault() {} });
  const second = form.props.onSubmit({ preventDefault() {} });
  assert.equal(saves.length, 1);
  hooks.nodes((node) => node.type === "select")[0].props.onChange({ target: { value: "B" } });
  await hooks.flush();
  profiles[1].resolve(profile("B"));
  await hooks.flush();
  saves[0].resolve({ ...profile("A"), name: "Saved A" });
  await Promise.all([first, second]);
  await hooks.flush();
  assert.equal(hooks.nodes((node) => node.type === "input" && node.props.value === "Store B").length, 1);
  assert.equal(hooks.nodes((node) => node.type === "input" && node.props.value === "Saved A").length, 0);
});

test("initial cloud failure does not load or show an editable demo merchant", async () => {
  const { hooks, profiles } = await dashboardHarness({ failStats: true });
  assert.equal(profiles.length, 0);
  assert.equal(hooks.nodes((node) => node.type === "section" && node.props.role === "alert").length, 1);
  assert.equal(hooks.nodes((node) => node.type === "form").length, 0);
  const demo = hooks.nodes((node) => node.type === "button" && node.props.children === "\u67e5\u770b\u672c\u5730\u6f14\u793a")[0];
  demo.props.onClick();
  await hooks.flush();
  assert.equal(profiles.length, 0);
  assert.equal(hooks.nodes((node) => node.type === "button" && node.props.className === "admin-save-profile").length, 0);
});

test("late date requests cannot overwrite statistics for the newer selection", async () => {
  const { hooks, stats, cloud } = await dashboardHarness({ deferStats: true });
  stats[0].resolve(cloud);
  await hooks.flush();
  hooks.nodes((node) => node.type === "input" && node.props.type === "date")[0].props.onChange({ target: { value: "2026-09-13" } });
  await hooks.flush();
  hooks.nodes((node) => node.type === "input" && node.props.type === "date")[0].props.onChange({ target: { value: "2026-09-14" } });
  await hooks.flush();
  stats[2].resolve({ ...cloud, date: "2026-09-14" });
  await hooks.flush();
  stats[1].resolve({ ...cloud, date: "2026-09-13" });
  await hooks.flush();
  const updated = hooks.nodes((node) => node.props.className === "admin-updated")[0];
  assert.ok(JSON.stringify(updated).includes("2026-09-14"));
  assert.ok(!JSON.stringify(updated).includes("2026-09-13"));
});

test("a late image upload cannot attach the old merchant image to the new merchant", async () => {
  const { hooks, profiles, uploads } = await dashboardHarness();
  profiles[0].resolve(profile("A"));
  await hooks.flush();
  const input = hooks.nodes((node) => node.type === "input" && node.props.type === "file")[0];
  const pendingUpload = input.props.onChange({ target: { files: [{ type: "image/jpeg", name: "store.jpg" }], value: "" } });
  assert.ok(uploads[0].path.startsWith("A/"));
  hooks.nodes((node) => node.type === "select")[0].props.onChange({ target: { value: "B" } });
  await hooks.flush();
  profiles[1].resolve(profile("B"));
  await hooks.flush();
  uploads[0].resolve({ error: null });
  await pendingUpload;
  await hooks.flush();
  assert.equal(hooks.nodes((node) => node.type === "textarea" && String(node.props.value).includes("store.jpg")).length, 0);
  assert.equal(hooks.nodes((node) => node.type === "input" && node.props.value === "Store B").length, 1);
});

test("generated merchant passwords use sixteen cryptographic bytes and a mixed-category prefix", async () => {
  let randomBytes = 0;
  const { hooks } = await dashboardHarness({
    crypto: { getRandomValues: (bytes) => {
      randomBytes += bytes.length;
      bytes.forEach((_value, index) => { bytes[index] = index; });
      return bytes;
    } },
  });
  const password = hooks.nodes((node) => node.type === "input" && node.props.placeholder === "\u81f3\u5c11 6 \u4f4d")[0];
  assert.equal(randomBytes, 16);
  assert.match(password.props.value, /^Tt9![a-f0-9]{32}$/);
});

test("unavailable cryptographic randomness leaves the password empty for manual entry", async () => {
  const { hooks } = await dashboardHarness();
  const password = hooks.nodes((node) => node.type === "input" && node.props.placeholder === "\u81f3\u5c11 6 \u4f4d")[0];
  assert.equal(password.props.value, "");
  const generate = hooks.nodes((node) => node.type === "button" && node.props.children === "\u751f\u6210\u5bc6\u7801")[0];
  generate.props.onClick();
  await hooks.flush();
  assert.equal(hooks.nodes((node) => node.props.className === "admin-create-message").length, 1);
});
