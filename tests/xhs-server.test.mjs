import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildXhsSignature, createXhsShareHandler } from "../netlify/functions/xhs-share.mjs";

const START = 1_789_430_400_000;
const DAY = 86_400_000;
const MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const APP_ORIGIN = "https://product.example.com";
const environment = {
  XHS_SHARE_ENABLED: "true",
  XHS_APP_KEY: "test-app-key",
  XHS_APP_SECRET: "private-app-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "private-service-role-key",
  URL: APP_ORIGIN,
};

function request({ origin = APP_ORIGIN, method = "GET", query = `merchantId=${MERCHANT_ID}`, target = APP_ORIGIN, headers = {} } = {}) {
  return new Request(`${target}/.netlify/functions/xhs-share?${query}`, {
    method,
    headers: { ...(origin !== null ? { origin } : {}), ...headers },
  });
}

function mockDatabase({ now, cached = null, merchantStatus = "active", missingMerchant = false, merchantError = null, rpcOverride } = {}) {
  const calls = [];
  const cache = cached ? { ...cached } : { token: null, expiresAt: 0, owner: null, leaseUntil: 0 };
  const client = {
    from(table) {
      assert.equal(table, "merchants");
      let merchantId;
      return {
        select(fields) { assert.equal(fields, "id,status"); return this; },
        eq(field, value) { assert.equal(field, "id"); merchantId = value; return this; },
        async maybeSingle() {
          calls.push({ operation: "merchant", merchantId });
          return {
            data: !missingMerchant && merchantId === MERCHANT_ID ? { id: merchantId, status: merchantStatus } : null,
            error: merchantError,
          };
        },
      };
    },
    async rpc(name, parameters) {
      calls.push({ operation: name, parameters });
      const override = rpcOverride?.(name, parameters, cache);
      if (override !== undefined) return override;
      assert.equal(parameters.p_app_key, environment.XHS_APP_KEY);
      if (name === "xhs_share_token_claim") {
        if (cache.token && cache.expiresAt > now() + 60_000) {
          return { data: { state: "ready", access_token: cache.token, expires_at_ms: cache.expiresAt }, error: null };
        }
        if (cache.leaseUntil > now()) return { data: { state: "busy" }, error: null };
        Object.assign(cache, { token: null, expiresAt: 0, owner: parameters.p_lease_owner, leaseUntil: now() + 60_000 });
        return { data: { state: "refresh" }, error: null };
      }
      if (name === "xhs_share_token_store") {
        if (cache.owner !== parameters.p_lease_owner || cache.leaseUntil <= now()) return { data: false, error: null };
        Object.assign(cache, { token: parameters.p_access_token, expiresAt: parameters.p_expires_at_ms, owner: null, leaseUntil: 0 });
        return { data: true, error: null };
      }
      if (name === "xhs_share_token_fail") {
        if (cache.owner === parameters.p_lease_owner) Object.assign(cache, { token: null, expiresAt: 0, owner: null });
        return { data: null, error: null };
      }
      assert.fail(`Unexpected RPC ${name}`);
    },
  };
  return { client, cache, calls };
}

function harness(options = {}) {
  const clock = { value: START };
  const now = () => clock.value;
  const db = mockDatabase({ now, ...options.database });
  const logs = [];
  const fetchCalls = [];
  let nonceCounter = 0;
  let ownerCounter = 0;
  let clientCalls = 0;
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    if (options.fetchImpl) return options.fetchImpl(url, init, clock, db);
    return new Response(JSON.stringify({ access_token: "private-access-token", expires_in: now() + DAY }), {
      headers: { "content-type": "application/json" },
    });
  };
  const createHandler = (overrides = {}) => createXhsShareHandler({
    env: { ...environment, ...options.env },
    getClient: () => { clientCalls += 1; return db.client; },
    now,
    fetchImpl,
    makeNonce: () => (++nonceCounter).toString(16).padStart(32, "0"),
    makeLeaseOwner: () => `00000000-0000-4000-8000-${(++ownerCounter).toString(16).padStart(12, "0")}`,
    tokenTimeoutMs: options.tokenTimeoutMs ?? 10_000,
    logger: { error: (...args) => logs.push(args) },
    ...overrides,
  });
  return { handler: createHandler(), createHandler, clock, db, logs, fetchCalls, clientCalls: () => clientCalls };
}

function assertNoSecrets(text) {
  for (const secret of ["private-app-secret", "private-service-role-key", "private-access-token", "cached-access-token", "secret-internal-detail"]) {
    assert.equal(text.includes(secret), false, `Leaked ${secret}`);
  }
}

test("signature matches an independently computed vector of the official Java algorithm", () => {
  // SHA256("appKey=app-demo&nonce=00112233445566778899aabbccddeeff&timeStamp=1692102691696secret-demo").
  // Expected bytes were checked separately with System.Security.Cryptography.SHA256.
  assert.equal(
    buildXhsSignature("app-demo", "00112233445566778899aabbccddeeff", "1692102691696", "secret-demo"),
    "6c14af6844b847c28d32f54845a408b98655b9a6ad5d2f252e5d64e69fdfedf2",
  );
  assert.equal(
    buildXhsSignature("app-demo", "00112233445566778899aabbccddeeff", 1692102691696, "secret-demo"),
    "6c14af6844b847c28d32f54845a408b98655b9a6ad5d2f252e5d64e69fdfedf2",
  );
});

test("disabled or incomplete configuration never creates a DB client or calls upstream", async () => {
  for (const env of [
    { XHS_SHARE_ENABLED: undefined },
    { XHS_SHARE_ENABLED: "false" },
    { XHS_SHARE_ENABLED: "TRUE" },
    { XHS_APP_KEY: "" },
    { XHS_APP_SECRET: " " },
    { SUPABASE_URL: undefined },
    { SUPABASE_SERVICE_ROLE_KEY: "" },
  ]) {
    const state = harness({ env });
    const result = await state.handler(request());
    assert.equal(result.status, 200);
    assert.equal((await result.json()).enabled, false);
    assert.equal(result.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(state.clientCalls(), 0);
    assert.equal(state.fetchCalls.length, 0);
  }
});

test("refresh uses the documented token request then returns only a short-lived SDK signature", async () => {
  const state = harness();
  const result = await state.handler(request());
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.enabled, true);
  assert.deepEqual(Object.keys(payload).sort(), ["enabled", "message", "validUntil", "verifyConfig"]);
  assert.deepEqual(Object.keys(payload.verifyConfig).sort(), ["appKey", "nonce", "signature", "timestamp"]);
  assert.equal(payload.verifyConfig.timestamp, String(START));
  assert.equal(payload.validUntil, START + 5 * 60_000);
  assert.match(payload.verifyConfig.nonce, /^[0-9a-f]{32}$/);
  assert.equal(payload.verifyConfig.signature, buildXhsSignature(environment.XHS_APP_KEY, payload.verifyConfig.nonce, START, "private-access-token"));
  assert.equal(result.headers.get("access-control-allow-origin"), APP_ORIGIN);
  assert.equal(result.headers.get("netlify-cdn-cache-control"), "no-store");
  assertNoSecrets(JSON.stringify(payload));
  assertNoSecrets(JSON.stringify(state.logs));

  assert.equal(state.fetchCalls.length, 1);
  const { url, init } = state.fetchCalls[0];
  assert.equal(url, "https://edith.xiaohongshu.com/api/sns/v1/ext/access/token");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers["content-type"], "application/json");
  assert.ok(init.signal instanceof AbortSignal);
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["app_key", "expires_in", "nonce", "signature", "timestamp"]);
  assert.equal(body.app_key, environment.XHS_APP_KEY);
  assert.equal(body.timestamp, START);
  assert.equal(body.expires_in, START + DAY);
  assert.ok(body.nonce.length <= 32);
  assert.equal(body.signature, buildXhsSignature(body.app_key, body.nonce, START, environment.XHS_APP_SECRET));
  assert.notEqual(body.nonce, payload.verifyConfig.nonce);
  assert.deepEqual(state.db.calls.map((call) => call.operation), ["merchant", "xhs_share_token_claim", "xhs_share_token_store"]);
});

test("separate handler instances reuse a shared token instead of independently refreshing", async () => {
  const state = harness({ database: { cached: { token: "cached-access-token", expiresAt: START + DAY, owner: null, leaseUntil: 0 } } });
  const first = await state.handler(request());
  const second = await state.createHandler()(request());
  const firstPayload = await first.json();
  const secondPayload = await second.json();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(firstPayload.verifyConfig.nonce, secondPayload.verifyConfig.nonce);
  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.db.calls.filter((call) => call.operation === "xhs_share_token_claim").length, 2);
  assertNoSecrets(JSON.stringify([firstPayload, secondPayload]));
});

test("simultaneous cold requests permit only the lease owner to refresh", async () => {
  let finishRefresh;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const upstreamResponse = new Promise((resolve) => { finishRefresh = resolve; });
  const state = harness({
    fetchImpl() {
      signalStarted();
      return upstreamResponse;
    },
  });
  const first = state.handler(request());
  await started;
  const second = await state.createHandler()(request());
  assert.equal(second.status, 503);
  assert.equal(second.headers.get("retry-after"), "2");
  assert.equal(state.fetchCalls.length, 1);
  finishRefresh(new Response(JSON.stringify({ access_token: "private-access-token", expires_in: START + DAY })));
  assert.equal((await first).status, 200);
  assert.equal((await state.createHandler()(request())).status, 200);
  assert.equal(state.fetchCalls.length, 1);
});

test("near-expiry tokens remain usable only until the safety boundary before a coordinated refresh", async () => {
  const state = harness({ database: { cached: { token: "cached-access-token", expiresAt: START + 61_000, owner: null, leaseUntil: 0 } } });
  const first = await state.handler(request());
  const prepared = await first.json();
  assert.equal(first.status, 200);
  assert.equal(prepared.validUntil, START + 1000);
  assert.equal(state.fetchCalls.length, 0);
  state.clock.value += 1001;
  const next = await state.handler(request());
  assert.equal(next.status, 200);
  assert.ok(prepared.validUntil < state.clock.value);
  assert.equal(state.fetchCalls.length, 1);
});

test("an expired lease can be replaced but the stale owner cannot store over it", async () => {
  const state = harness({
    database: { cached: { token: null, expiresAt: 0, owner: "previous-owner", leaseUntil: START - 1 } },
    fetchImpl(_url, _init, clock, db) {
      clock.value += 61_000;
      db.cache.owner = "newer-owner";
      db.cache.leaseUntil = clock.value + 60_000;
      return new Response(JSON.stringify({ access_token: "private-access-token", expires_in: START + DAY }));
    },
  });
  const result = await state.handler(request());
  assert.equal(result.status, 503);
  assert.equal(state.db.cache.owner, "newer-owner");
  assert.equal(state.db.cache.token, null);
  assertNoSecrets(await result.text());
});

test("invalid and inactive merchants never reach the cache or token endpoint", async () => {
  for (const database of [
    { missingMerchant: true },
    { merchantStatus: "inactive" },
    { merchantStatus: "suspended" },
  ]) {
    const state = harness({ database });
    assert.equal((await state.handler(request())).status, 404);
    assert.deepEqual(state.db.calls.map((call) => call.operation), ["merchant"]);
    assert.equal(state.fetchCalls.length, 0);
  }
  const legacy = harness({ database: { merchantStatus: null } });
  assert.equal((await legacy.handler(request())).status, 200);
});

test("client parameters cannot select keys, timestamps, nonces or token deadlines", async () => {
  for (const query of [
    "",
    "merchantId=unknown",
    `merchantId=${MERCHANT_ID}&merchantId=${MERCHANT_ID}`,
    ...["appKey=attacker", "app_key=attacker", "nonce=fixed", "timestamp=1", "expires_in=1", "model=paid"]
      .map((parameter) => `merchantId=${MERCHANT_ID}&${parameter}`),
  ]) {
    const state = harness();
    assert.equal((await state.handler(request({ query }))).status, 400, query);
    assert.equal(state.clientCalls(), 0);
    assert.equal(state.fetchCalls.length, 0);
  }
});

test("untrusted origins and forwarded-host spoofing fail without DB or upstream calls", async () => {
  for (const details of [
    { origin: "https://attacker.example.com" },
    { origin: "null" },
    { origin: `${APP_ORIGIN}/` },
    { origin: "https://product.example.com.attacker.test" },
    { origin: null, headers: { "sec-fetch-site": "cross-site" } },
    { origin: null, headers: { referer: "https://attacker.test/page" } },
    { origin: null, target: "https://attacker.test", headers: { "x-forwarded-host": "product.example.com" } },
  ]) {
    const state = harness();
    const result = await state.handler(request(details));
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
    assert.equal(state.clientCalls(), 0);
    assert.equal(state.fetchCalls.length, 0);
  }
});

test("same-origin GET without Origin works and localhost needs an explicit allowlist", async () => {
  const sameOrigin = harness();
  assert.equal((await sameOrigin.handler(request({ origin: null, headers: { "sec-fetch-site": "same-origin" } }))).status, 200);
  const denied = harness();
  assert.equal((await denied.handler(request({ origin: "http://localhost:5173" }))).status, 403);
  const local = harness({ env: { XHS_ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:8888" } });
  assert.equal((await local.handler(request({ origin: "http://localhost:5173" }))).status, 200);
  const insecure = harness({ env: { XHS_ALLOWED_ORIGINS: "http://public.example.com *" } });
  assert.equal((await insecure.handler(request({ origin: "http://public.example.com" }))).status, 403);
});

test("Netlify preview origin and explicit HTTPS origins are supported exactly", async () => {
  const state = harness({ env: { DEPLOY_PRIME_URL: "https://preview.example.com", XHS_ALLOWED_ORIGINS: "https://custom.example.com" } });
  for (const origin of ["https://preview.example.com", "https://custom.example.com"]) {
    const result = await state.handler(request({ origin }));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("access-control-allow-origin"), origin);
  }
});

test("preflight and unsupported methods never refresh tokens", async () => {
  const state = harness();
  assert.equal((await state.handler(request({ method: "OPTIONS" }))).status, 204);
  assert.equal((await state.handler(request({ method: "OPTIONS", origin: "https://attacker.test" }))).status, 403);
  assert.equal((await state.handler(request({ method: "POST" }))).status, 405);
  assert.equal(state.clientCalls(), 0);
  assert.equal(state.fetchCalls.length, 0);
});

test("token failures retain a lease cooldown instead of refreshing again on every request", async () => {
  const state = harness({
    fetchImpl: async () => new Response(JSON.stringify({ message: "secret-internal-detail" }), { status: 500 }),
  });
  const first = await state.handler(request());
  assert.equal(first.status, 503);
  assertNoSecrets(await first.text());
  assert.equal(state.db.cache.leaseUntil, START + 60_000);
  const retry = await state.createHandler()(request());
  assert.equal(retry.status, 503);
  assert.equal(state.fetchCalls.length, 1);
  assertNoSecrets(JSON.stringify(state.logs));
});

test("the token timeout aborts HTTP and returns a redacted failure", async () => {
  let upstreamSignal;
  const state = harness({
    tokenTimeoutMs: 5,
    fetchImpl: (_url, init) => {
      upstreamSignal = init.signal;
      return new Promise(() => {});
    },
  });
  const result = await state.handler(request());
  assert.equal(result.status, 503);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(state.db.cache.token, null);
  assertNoSecrets(await result.text());
  assertNoSecrets(JSON.stringify(state.logs));
});

test("unknown envelopes, explicit failures and invalid absolute expiry values fail closed", async () => {
  for (const tokenResponse of [
    { data: { access_token: "private-access-token", expires_in: START + DAY }, success: true, code: 0 },
    { access_token: "private-access-token", expires_in: START + DAY, success: false },
    { access_token: "private-access-token", expires_in: START + DAY, code: 1 },
    { access_token: "private-access-token", expires_in: 86400 },
    { access_token: "private-access-token", expires_in: START + 60_000 },
    { access_token: "private-access-token", expires_in: START + DAY + 1 },
    { access_token: "private-access-token", expires_in: String(START + DAY) },
    { access_token: "", expires_in: START + DAY },
    { access_token: { token: "private-access-token" }, expires_in: START + DAY },
    null,
    [],
  ]) {
    const state = harness({ fetchImpl: async () => new Response(JSON.stringify(tokenResponse)) });
    const result = await state.handler(request());
    assert.equal(result.status, 503, JSON.stringify(tokenResponse));
    assert.equal(state.db.cache.token, null);
    assert.equal(state.db.calls.some((call) => call.operation === "xhs_share_token_store"), false);
    assertNoSecrets(await result.text());
  }
});

test("malformed and oversized upstream payloads cannot reach the cache", async () => {
  for (const body of ["not JSON", "x".repeat(33 * 1024)]) {
    const state = harness({ fetchImpl: async () => new Response(body) });
    const result = await state.handler(request());
    assert.equal(result.status, 503);
    assert.equal(state.db.cache.token, null);
    assertNoSecrets(await result.text());
  }
});

test("cache and merchant failures are redacted and never fall back to a local token cache", async () => {
  for (const database of [
    { merchantError: { message: "secret-internal-detail" } },
    { rpcOverride: () => ({ data: null, error: { message: "secret-internal-detail" } }) },
    { rpcOverride: () => ({ data: { state: "ready", access_token: "cached-access-token", expires_at_ms: START - 1 }, error: null }) },
    { rpcOverride: () => ({ data: { state: "unexpected" }, error: null }) },
  ]) {
    const state = harness({ database });
    const result = await state.handler(request());
    assert.equal(result.status, 503);
    assert.equal(state.fetchCalls.length, 0);
    assertNoSecrets(await result.text());
    assertNoSecrets(JSON.stringify(state.logs));
  }
});

test("a token is never exposed through a signature response if durable cache storage fails", async () => {
  const state = harness({
    database: {
      rpcOverride: (name) => name === "xhs_share_token_store"
        ? { data: null, error: { message: "secret-internal-detail" } }
        : undefined,
    },
  });
  const result = await state.handler(request());
  assert.equal(result.status, 503);
  const text = await result.text();
  assertNoSecrets(text);
  assert.equal(text.includes("verifyConfig"), false);
  assert.equal(state.db.cache.token, null);
});

test("SQL uses row locks, a fenced lease and service-role-only access", async () => {
  const sql = await readFile(new URL("../SUPABASE_XHS_SHARE_TOKEN_CACHE.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.xhs_share_token_cache from public, anon, authenticated/i);
  assert.equal((sql.match(/for update;/gi) || []).length, 2);
  assert.match(sql, /cached\.lease_owner is distinct from p_lease_owner/);
  assert.match(sql, /cached\.expires_at_ms > now_ms \+ 60000/);
  assert.match(sql, /lease_until_ms = now_ms \+ 60000/);
  assert.equal((sql.match(/set search_path = ''/g) || []).length, 3);
  assert.equal((sql.match(/revoke all on function .* from public, anon, authenticated;/g) || []).length, 3);
  assert.equal((sql.match(/grant execute on function .* to service_role;/g) || []).length, 3);
  assert.doesNotMatch(sql, /grant (?:all|execute|select).*to (?:public|anon|authenticated)/i);
});
