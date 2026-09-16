import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantConfigHandler } from "../netlify/functions/merchant-config.mjs";

const MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const OTHER_ID = "b90fd384-a296-4a95-98dd-b3e79fc36d93";
const UNKNOWN_ID = "c90fd384-a296-4a95-98dd-b3e79fc36d93";
const ENDPOINT = "https://product.example.test/.netlify/functions/merchant-config";

function merchantRow(id = MERCHANT_ID) {
  return {
    id, name: "Example Store", industry: "Local service", status: "active",
    contact_name: "Private Owner", contact_phone: "15500000000",
    address: "Public store address", description: "Public store description",
    selling_points: ["Friendly service"], image_urls: ["https://images.example.test/store.jpg"],
    xiaohongshu_url: "https://www.xiaohongshu.com/user/profile/store",
    meituan_url: "http://dpurl.cn/existing-meituan",
    dianping_url: "https://www.dianping.com/shop/existing",
    service_keywords: ["Store service"], feature_keywords: ["Local"], length_options: ["Short"],
    prompt_profile: "PRIVATE_PROMPT_MARKER",
  };
}

function mockDatabase({ failure, status = "active" } = {}) {
  const tables = {
    merchants: [{ ...merchantRow(), status }, { ...merchantRow(OTHER_ID), name: "Other Store" }],
    profiles: [
      { id: "admin-user", role: "admin", merchant_id: null },
      { id: "owner-user", role: "merchant", merchant_id: MERCHANT_ID },
      { id: "other-user", role: "merchant", merchant_id: OTHER_ID },
    ],
  };
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = "select"; }
    select(columns) { this.columns = columns; return this; }
    eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
    or(expression) {
      assert.equal(expression, "status.is.null,status.eq.active");
      this.filters.push((row) => row.status === "active" || row.status == null);
      return this;
    }
    limit(count) { this.count = count; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    async maybeSingle() {
      calls.push({ table: this.table, operation: this.operation, columns: this.columns, payload: this.payload });
      const error = failure?.(this);
      if (error) return { data: null, error };
      const row = tables[this.table].find((value) => this.filters.every((filter) => filter(value)));
      if (!row) return { data: null, error: null };
      if (this.operation === "update") Object.assign(row, this.payload);
      const data = this.columns === "*"
        ? structuredClone(row)
        : Object.fromEntries(this.columns.split(",").map((value) => value.trim()).map((column) => [column, row[column]]));
      return { data, error: null };
    }
  }
  const users = { "admin-token": "admin-user", "owner-token": "owner-user", "other-token": "other-user" };
  const client = {
    from: (table) => new Query(table),
    auth: { getUser: async (token) => {
      calls.push({ operation: "getUser", token });
      return { data: { user: users[token] ? { id: users[token] } : null }, error: null };
    } },
  };
  const logs = [];
  const handler = createMerchantConfigHandler({ getClient: () => client, logger: { error: (...args) => logs.push(args) } });
  return { handler, tables, calls, logs };
}

function request({ method = "GET", token, merchantId = MERCHANT_ID, query, body, headers = {} } = {}) {
  const url = new URL(ENDPOINT);
  if (query !== undefined) url.search = query;
  else if (merchantId != null) url.searchParams.set("merchantId", merchantId);
  return new Request(url, {
    method,
    headers: {
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

function put(body, token = "admin-token", options = {}) {
  return request({ method: "PUT", token, body, ...options });
}

test("anonymous GET selects only public columns and never returns private fields", async () => {
  const db = mockDatabase();
  const response = await db.handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  const result = await response.json();
  assert.equal(result.visibility, "public");
  assert.equal(result.profile.name, "Example Store");
  assert.equal(result.profile.address, "Public store address");
  assert.deepEqual(result.profile.imageUrls, ["https://images.example.test/store.jpg"]);
  for (const field of ["contactName", "contactPhone", "promptProfile"]) {
    assert.equal(Object.hasOwn(result.profile, field), false);
  }
  const responseText = JSON.stringify(result);
  for (const value of ["Private Owner", "15500000000", "PRIVATE_PROMPT_MARKER"]) assert.ok(!responseText.includes(value));
  const query = db.calls.find((call) => call.table === "merchants");
  assert.ok(!query.columns.includes("*"));
  for (const column of ["contact_name", "contact_phone", "prompt_profile"]) assert.ok(!query.columns.includes(column));
  assert.equal(db.calls.some((call) => call.operation === "getUser"), false);
});

test("authorized owners and administrators receive complete editable profiles", async () => {
  for (const token of ["owner-token", "admin-token"]) {
    const db = mockDatabase();
    const response = await db.handler(request({ token }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.visibility, "private");
    assert.equal(result.profile.contactName, "Private Owner");
    assert.equal(result.profile.contactPhone, "15500000000");
    assert.equal(result.profile.promptProfile, "PRIVATE_PROMPT_MARKER");
  }
});

test("merchant-scoped GET refuses another merchant instead of returning public editable defaults", async () => {
  const db = mockDatabase();
  const response = await db.handler(request({ token: "other-token" }));
  assert.equal(response.status, 403);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.profile, undefined);
  assert.equal(db.calls.some((call) => call.table === "merchants"), false);
});

test("expired or malformed authorization never falls back to anonymous public GET", async () => {
  for (const headers of [{ authorization: "Bearer expired" }, { authorization: "Basic anything" }, { authorization: "" }]) {
    const db = mockDatabase();
    const response = await db.handler(request({ headers }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).profile, undefined);
    assert.equal(db.calls.some((call) => call.table === "merchants"), false);
  }
});

test("name-based and default lookups retain authorization scope", async () => {
  const db = mockDatabase();
  const named = await db.handler(request({ token: "owner-token", query: "merchantName=Example%20Store" }));
  assert.equal(named.status, 200);
  assert.equal((await named.json()).profile.contactName, "Private Owner");
  const denied = await db.handler(request({ token: "other-token", query: "merchantName=Example%20Store" }));
  assert.equal(denied.status, 403);
  const fallback = await db.handler(request({ merchantId: null }));
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).visibility, "public");
});

test("invalid UUIDs and oversized query names fail before database access", async () => {
  for (const query of ["merchantId=not-a-uuid", "merchantId=", "merchant=javascript%3Aalert(1)", `merchantName=${"x".repeat(161)}`]) {
    const db = mockDatabase();
    const response = await db.handler(request({ query }));
    assert.equal(response.status, 400);
    assert.equal(db.calls.length, 0);
  }
});

test("unknown and inactive merchants do not resolve through a supplied name", async () => {
  const db = mockDatabase();
  const unknown = await db.handler(request({ query: `merchantId=${UNKNOWN_ID}&merchantName=Example%20Store` }));
  assert.equal(unknown.status, 404);
  for (const status of ["inactive", "suspended"]) {
    const inactive = mockDatabase({ status });
    assert.equal((await inactive.handler(request())).status, 404);
    assert.equal((await inactive.handler(request({ token: "admin-token" }))).status, 404);
  }
  const legacy = mockDatabase({ status: null });
  assert.equal((await legacy.handler(request())).status, 200);
});

test("GET database and configuration failures return generic errors without internal details", async () => {
  const marker = "postgres relation secret_table missing; SERVICE_ROLE_SECRET";
  const db = mockDatabase({ failure: () => new Error(marker) });
  const response = await db.handler(request());
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes(marker));
  const handler = createMerchantConfigHandler({
    getClient: () => { throw new Error(marker); },
    logger: { error() {} },
  });
  assert.ok(!(await (await handler(request())).text()).includes(marker));
});

test("PUT requires authorization and refuses cross-merchant writes", async () => {
  for (const [token, status] of [[undefined, 401], ["expired-token", 401], ["other-token", 403]]) {
    const db = mockDatabase();
    const response = await db.handler(request({ method: "PUT", token, body: { id: MERCHANT_ID, name: "Changed" } }));
    assert.equal(response.status, status);
    assert.equal(db.calls.some((call) => call.operation === "update"), false);
    assert.equal(db.tables.merchants[0].name, "Example Store");
  }
});

test("partial PUT preserves omitted private fields and existing platform links", async () => {
  const db = mockDatabase();
  const response = await db.handler(put({ id: MERCHANT_ID, name: "Renamed" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.visibility, "private");
  assert.equal(result.profile.name, "Renamed");
  assert.equal(result.profile.contactName, "Private Owner");
  assert.equal(result.profile.promptProfile, "PRIVATE_PROMPT_MARKER");
  assert.equal(result.profile.meituanUrl, "http://dpurl.cn/existing-meituan");
  const payload = db.calls.find((call) => call.operation === "update").payload;
  assert.deepEqual(Object.keys(payload).sort(), ["name", "updated_at"]);
});

test("PUT supports explicit clearing without reinserting defaults", async () => {
  const db = mockDatabase();
  const response = await db.handler(put({
    id: MERCHANT_ID, contactName: "", contactPhone: "", promptProfile: "", description: "",
    sellingPoints: [], imageUrls: [], serviceKeywords: [], featureKeywords: [], lengthOptions: [],
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.profile.contactName, "");
  assert.equal(result.profile.promptProfile, "");
  assert.equal(result.profile.description, "");
  assert.deepEqual(result.profile.sellingPoints, []);
  assert.deepEqual(result.profile.lengthOptions, []);
});

test("merchant owners can update their profile but cannot overwrite administrator-owned platform links", async () => {
  const db = mockDatabase();
  const response = await db.handler(put({
    id: MERCHANT_ID, name: "Owner edit", meituanUrl: "https://www.meituan.com/shop/new",
    dianpingUrl: "https://www.dianping.com/shop/new", xiaohongshuUrl: "https://xhslink.com/new",
    contactName: "New owner",
  }, "owner-token"));
  assert.equal(response.status, 200);
  const row = db.tables.merchants[0];
  assert.equal(row.contact_name, "New owner");
  assert.equal(row.meituan_url, "http://dpurl.cn/existing-meituan");
  assert.equal(row.dianping_url, "https://www.dianping.com/shop/existing");
  assert.equal(row.xiaohongshu_url, "https://www.xiaohongshu.com/user/profile/store");
});

test("valid HTTPS media and existing HTTP review short links remain supported", async () => {
  const db = mockDatabase();
  const response = await db.handler(put({
    id: MERCHANT_ID,
    imageUrls: ["https://images.example.test/store.webp", "https://images.example.test/render?id=photo"],
    meituanUrl: "http://dpurl.cn/legacy-link", dianpingUrl: "https://m.dianping.com/shop/123",
  }));
  assert.equal(response.status, 200);
  assert.equal(db.tables.merchants[0].meituan_url, "http://dpurl.cn/legacy-link");
  assert.equal(db.tables.merchants[0].image_urls.length, 2);
});

test("PUT rejects unsafe protocols, URL credentials, wrong review domains and non-HTTPS media", async (t) => {
  const cases = [
    { meituanUrl: "javascript:alert(1)" },
    { dianpingUrl: "data:text/html,attack" },
    { xiaohongshuUrl: "xhsdiscover://home" },
    { meituanUrl: "https://meituan.com.evil.test/shop/1" },
    { dianpingUrl: "https://user:secret@dianping.com/shop/1" },
    { imageUrls: ["http://images.example.test/store.jpg"] },
    { imageUrls: ["/mock-assets/store.jpg"] },
    { imageUrls: ["javascript:alert(1)"] },
    { imageUrls: ["data:image/jpeg;base64,AAAA"] },
    { imageUrls: ["https://images.example.test/attack.svg"] },
    { imageUrls: ["https://images.example.test/response.html"] },
  ];
  for (const [index, patch] of cases.entries()) {
    await t.test(`unsafe field case ${index + 1}`, async () => {
      const db = mockDatabase();
      const response = await db.handler(put({ id: MERCHANT_ID, ...patch }));
      assert.equal(response.status, 400);
      assert.equal(db.calls.some((call) => call.operation === "update"), false);
    });
  }
});

test("field lengths, list sizes, field types and conflicting IDs are validated", async () => {
  const patches = [
    { id: "bad", name: "Name" },
    { merchantId: OTHER_ID, name: "Name" },
    { name: "" },
    { name: 42 },
    { name: "x".repeat(161) },
    { contactPhone: "1".repeat(65) },
    { promptProfile: "x".repeat(8001) },
    { description: "x".repeat(5001) },
    { sellingPoints: Array(51).fill("selling point") },
    { sellingPoints: [{ private: "object" }] },
    { serviceKeywords: ["x".repeat(161)] },
    { lengthOptions: Array(11).fill("Short") },
    { imageUrls: Array(51).fill("https://images.example.test/store.jpg") },
    { description: "contains\u0000control" },
  ];
  for (const patch of patches) {
    const db = mockDatabase();
    const response = await db.handler(put({ id: MERCHANT_ID, ...patch }));
    assert.equal(response.status, 400, JSON.stringify(patch).slice(0, 100));
    assert.equal(db.calls.some((call) => call.operation === "update"), false);
  }
});

test("PUT rejects oversized encoded bodies, invalid JSON and non-object payloads", async () => {
  const cases = [
    { body: "{bad", status: 400 },
    { body: "null", status: 400 },
    { body: "[]", status: 400 },
    { body: "42", status: 400 },
    { body: { id: MERCHANT_ID, description: "\u754c".repeat(50000) }, status: 413 },
    { body: { id: MERCHANT_ID, name: "Name" }, headers: { "content-length": "131073" }, status: 413 },
    { body: { id: MERCHANT_ID, name: "Name" }, headers: { "content-type": "text/plain" }, status: 415 },
  ];
  for (const input of cases) {
    const db = mockDatabase();
    const response = await db.handler(put(input.body, "admin-token", { headers: input.headers }));
    assert.equal(response.status, input.status);
    assert.equal(db.calls.some((call) => call.operation === "update"), false);
  }
});

test("unrecognized privileged fields cannot change status or ownership", async () => {
  const db = mockDatabase();
  const response = await db.handler(put({
    id: MERCHANT_ID, name: "Valid name", status: "inactive", role: "admin",
    merchant_id: OTHER_ID, contact_phone: "bypass",
  }));
  assert.equal(response.status, 200);
  const row = db.tables.merchants[0];
  assert.equal(row.status, "active");
  assert.equal(row.role, undefined);
  assert.equal(row.contact_phone, "15500000000");
});

test("PUT database failures and vanished or inactive merchants never report success", async () => {
  const db = mockDatabase({ failure: (query) => query.operation === "update" ? new Error("database-internal-marker") : null });
  const failed = await db.handler(put({ id: MERCHANT_ID, name: "Failed edit" }));
  assert.equal(failed.status, 500);
  const failure = await failed.json();
  assert.equal(failure.ok, false);
  assert.ok(!failure.message.includes("database-internal-marker"));
  assert.equal(db.tables.merchants[0].name, "Example Store");
  assert.equal((await mockDatabase().handler(put({ id: UNKNOWN_ID, name: "Missing" }))).status, 404);
  assert.equal((await mockDatabase({ status: "inactive" }).handler(put({ id: MERCHANT_ID, name: "Inactive" }))).status, 404);
});

test("unsupported methods and preflight do not require backend credentials", async () => {
  const handler = createMerchantConfigHandler({ getClient: () => { throw new Error("Must not initialize"); } });
  assert.equal((await handler(request({ method: "OPTIONS" }))).status, 200);
  assert.equal((await handler(request({ method: "POST" }))).status, 405);
});
