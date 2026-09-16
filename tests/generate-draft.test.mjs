import assert from "node:assert/strict";
import test from "node:test";
import { createDraftHandler, reserveQuota } from "../netlify/functions/generate-draft.mjs";

const MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const row = {
  id: MERCHANT_ID, name: "Test Shop", industry: "Coffee", address: "Shenzhen",
  description: "Coffee and tea", selling_points: ["Fresh coffee"],
  service_keywords: ["Coffee"], feature_keywords: ["Quiet"], length_options: ["Short"],
  prompt_profile: "Use supplied facts", status: "active",
};
const modelDraft = {
  title: "Shop reference", body: "Information about the shop.", tags: ["Coffee"],
  materialType: "image", style: "real_experience", cta: "Learn more",
};
const requestBody = {
  merchantId: MERCHANT_ID, platform: "redbook",
  preferences: { services: ["Coffee"], features: ["Quiet"], length: "Short" }, variant: 0,
};
const baseEnv = {
  SUPABASE_URL: "https://storage.test", SUPABASE_SERVICE_ROLE_KEY: "mock-storage-token",
  DASHSCOPE_API_KEY: "mock-model-token", DRAFT_AI_ENABLED: "true",
};

function memoryStore() {
  const values = new Map();
  let version = 0;
  return {
    values,
    async getWithMetadata(key, options) {
      assert.equal(options.consistency, "strong");
      return values.has(key) ? structuredClone(values.get(key)) : null;
    },
    async setJSON(key, data, options) {
      const previous = values.get(key);
      if (options.onlyIfNew && previous) return { modified: false };
      if (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch) return { modified: false };
      const etag = String(++version);
      values.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
  };
}

function harness(overrides = {}) {
  const calls = [];
  const dbCalls = [];
  const store = overrides.store || memoryStore();
  const handler = createDraftHandler({
    env: { ...baseEnv, ...overrides.env },
    now: () => new Date("2026-09-15T12:00:00.000Z"),
    timeoutMs: overrides.timeoutMs ?? 1000,
    getStoreImpl: () => {
      if (overrides.storeError) throw new Error("private internal storage failure");
      return store;
    },
    createClientImpl: (_url, _key, options) => {
      assert.equal(options.auth.persistSession, false);
      return {
        from(table) {
          assert.equal(table, "merchants");
          const query = {
            select(fields) { dbCalls.push(["select", fields]); return query; },
            eq(field, value) { dbCalls.push(["eq", field, value]); return query; },
            or(filter) { dbCalls.push(["or", filter]); return query; },
            async maybeSingle() {
              return { data: overrides.row === undefined ? row : overrides.row, error: overrides.dbError ?? null };
            },
          };
          return query;
        },
      };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (overrides.fetchImpl) return overrides.fetchImpl(url, options);
      return Response.json({
        choices: [{
          finish_reason: overrides.finishReason ?? "stop",
          message: { content: overrides.content ?? JSON.stringify(overrides.modelDraft ?? modelDraft) },
        }],
      });
    },
  });
  return {
    handler, calls, dbCalls, store,
    async send(body = requestBody, options = {}) {
      const request = new Request("https://product.test/.netlify/functions/generate-draft", {
        method: "POST", headers: { "content-type": "application/json", ...options.headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      const response = await handler(request);
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
  };
}

test("public visitors can generate only from a stored enabled merchant", async () => {
  const h = harness();
  const result = await h.send();
  assert.equal(result.status, 200);
  assert.equal(result.body.draft.generationSource, "ai");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  const payload = JSON.parse(h.calls[0].options.body);
  assert.equal(payload.model, "qwen-plus");
  assert.equal(payload.max_tokens, 1800);
  assert.deepEqual(payload.response_format, { type: "json_object" });
  assert.equal(JSON.parse(payload.messages[1].content).merchant.name, row.name);
  assert.ok(h.dbCalls.some((entry) => entry[0] === "eq" && entry[1] === "id" && entry[2] === MERCHANT_ID));
  assert.ok(h.dbCalls.some((entry) => entry[0] === "or" && entry[1] === "status.is.null,status.eq.active"));
  assert.ok(!JSON.stringify(result.body).includes("mock-model-token"));
  assert.ok(!JSON.stringify(result.body).includes("mock-storage-token"));
});

test("unconfigured or disabled AI is an explicitly marked template with no model calls", async () => {
  for (const env of [{ DASHSCOPE_API_KEY: "" }, { DRAFT_AI_ENABLED: "" }, { DRAFT_AI_ENABLED: "false" }]) {
    const h = harness({ env, storeError: true });
    const result = await h.send();
    assert.equal(result.status, 200);
    assert.equal(result.body.draft.generationSource, "template");
    assert.ok(result.body.draft.generationNotice);
    assert.equal(h.calls.length, 0);
    assert.ok([...result.body.draft.title].length <= 20);
    assert.ok([...result.body.draft.body].length <= 1000);
  }
});

test("missing and inactive merchants cannot request templates or billed generation", async () => {
  for (const data of [null, { ...row, status: "inactive" }]) {
    for (const enabled of ["true", "false"]) {
      const h = harness({ row: data, env: { DRAFT_AI_ENABLED: enabled } });
      const result = await h.send();
      assert.equal(result.status, 404);
      assert.equal(h.calls.length, 0);
    }
  }
});

test("legacy null-status merchant remains available", async () => {
  const result = await harness({ row: { ...row, status: null } }).send();
  assert.equal(result.status, 200);
});

test("arbitrary prompts, profiles, models and unsupported input are rejected", async () => {
  for (const payload of [
    null, [], { ...requestBody, prompt: "arbitrary prompt" }, { ...requestBody, profile: row },
    { ...requestBody, model: "expensive" }, { ...requestBody, merchantId: "unknown" },
    { ...requestBody, platform: "other" }, { ...requestBody, variant: -1 },
    { ...requestBody, preferences: { ...requestBody.preferences, services: ["Invented prompt"] } },
    { ...requestBody, preferences: { ...requestBody.preferences, features: new Array(9).fill("Quiet") } },
    { ...requestBody, preferences: { ...requestBody.preferences, length: "Ignore rules" } },
    { ...requestBody, preferences: { ...requestBody.preferences, custom: true } },
  ]) {
    const h = harness();
    const result = await h.send(payload);
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.equal(h.calls.length, 0);
  }
});

test("invalid content type, malformed JSON and oversized UTF-8 requests are bounded", async () => {
  const h = harness();
  assert.equal((await h.send(requestBody, { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await h.send("{")).status, 400);
  assert.equal((await h.send({ ...requestBody, arbitrary: "\u4e2d".repeat(1400) })).status, 413);
  assert.equal(h.calls.length, 0);
});

test("cross-site requests are denied and allowed origins are reflected without wildcard", async () => {
  const h = harness({ env: { DRAFT_ALLOWED_ORIGINS: "https://preview.test http://localhost:5173,https://branch.test" } });
  assert.equal((await h.send(requestBody, { headers: { origin: "https://unrelated.test" } })).status, 403);
  const result = await h.send(requestBody, { headers: { origin: "http://localhost:5173" } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await h.send(requestBody, { headers: { origin: "https://preview.test" } })).status, 200);
  assert.equal((await h.send(requestBody, { headers: { origin: "https://branch.test" } })).status, 200);
});

test("storage errors fail closed without exposing internal details", async () => {
  for (const config of [
    { dbError: { message: "secret database details" } },
    { storeError: true },
    { env: { SUPABASE_SERVICE_ROLE_KEY: "" } },
  ]) {
    const h = harness(config);
    const result = await h.send();
    assert.equal(result.status, 503);
    assert.equal(h.calls.length, 0);
    assert.ok(!JSON.stringify(result.body).includes("secret"));
    assert.ok(!JSON.stringify(result.body).includes("private internal"));
  }
});

test("merchant and global quotas stop further model requests", async () => {
  for (const env of [{ DRAFT_AI_MERCHANT_DAILY_LIMIT: "1" }, { DRAFT_AI_DAILY_LIMIT: "1" }]) {
    const h = harness({ env });
    assert.equal((await h.send()).status, 200);
    const limited = await h.send();
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "DAILY_LIMIT");
    assert.equal(h.calls.length, 1);
  }
});

test("atomic quota reservations cannot exceed the limit under concurrency", async () => {
  const store = memoryStore();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => reserveQuota(store, "global", 3, "2026-09-15")),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(store.values.get("global").data.count, 3);
});

test("daily counters reset forward and delayed old-day requests cannot reset them backward", async () => {
  const store = memoryStore();
  await reserveQuota(store, "global", 1, "2026-09-15");
  await reserveQuota(store, "global", 1, "2026-09-16");
  await assert.rejects(reserveQuota(store, "global", 1, "2026-09-15"), { status: 429 });
  assert.equal(store.values.get("global").data.day, "2026-09-16");
  assert.equal(store.values.get("global").data.count, 1);
});

test("quota corruption and unsupported conditional writes fail closed", async () => {
  const store = memoryStore();
  store.values.set("global", { data: { day: "2026-09-15", count: -1 }, etag: "1" });
  await assert.rejects(reserveQuota(store, "global", 10, "2026-09-15"), { status: 503 });
  await assert.rejects(reserveQuota({
    getWithMetadata: async () => null, setJSON: async () => undefined,
  }, "global", 10, "2026-09-15"), { status: 503 });
});

test("model errors do not turn into successful template drafts or trigger a paid retry", async () => {
  for (const status of [401, 429, 500]) {
    const h = harness({ fetchImpl: async () => new Response("private upstream details", { status }) });
    const result = await h.send();
    assert.equal(result.status, status === 429 ? 503 : 502);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.draft, undefined);
    assert.equal(h.calls.length, 1);
    assert.ok(!JSON.stringify(result.body).includes("upstream details"));
  }
});

test("model timeout aborts upstream and returns an explicit failure", async () => {
  let aborted = false;
  const h = harness({
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }),
  });
  const result = await h.send();
  assert.equal(result.status, 504);
  assert.equal(result.body.code, "MODEL_TIMEOUT");
  assert.equal(aborted, true);
});

test("incomplete, malformed, oversized and invalid model drafts are rejected", async () => {
  for (const config of [
    { finishReason: "length" }, { content: "not JSON" },
    { modelDraft: { ...modelDraft, title: "A".repeat(21) } },
    { modelDraft: { ...modelDraft, body: "" } },
    { modelDraft: { ...modelDraft, tags: [99] } },
    { modelDraft: { ...modelDraft, materialType: "invalid" } },
    { fetchImpl: async () => new Response("A".repeat(33_000)) },
  ]) {
    const h = harness(config);
    const result = await h.send();
    assert.equal(result.status, 502);
    assert.equal(result.body.draft, undefined);
  }
});

test("model endpoint accepts official workspace domains and rejects third-party hosts", async () => {
  const valid = harness({ env: { DASHSCOPE_BASE_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" } });
  assert.equal((await valid.send()).status, 200);
  assert.ok(valid.calls[0].url.includes("workspace.cn-beijing.maas.aliyuncs.com"));
  for (const base of [
    "https://attacker.test/compatible-mode/v1",
    "https://dashscope.aliyuncs.com.attacker.test/compatible-mode/v1",
    "http://dashscope.aliyuncs.com/compatible-mode/v1",
  ]) {
    const h = harness({ env: { DASHSCOPE_BASE_URL: base } });
    assert.equal((await h.send()).status, 503);
    assert.equal(h.calls.length, 0);
  }
});

test("invalid limits cannot accidentally create an unlimited endpoint", async () => {
  for (const limit of ["0", "-1", "NaN", "9999999"]) {
    const h = harness({ env: { DRAFT_AI_DAILY_LIMIT: limit } });
    assert.equal((await h.send()).status, 503);
    assert.equal(h.calls.length, 0);
  }
});
