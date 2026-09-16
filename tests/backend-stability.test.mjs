import assert from "node:assert/strict";
import test from "node:test";
import { createEventsHandler } from "../netlify/functions/events.mjs";
import { createAdminStatsHandler } from "../netlify/functions/admin-stats.mjs";
import { createMerchantsHandler } from "../netlify/functions/merchants.mjs";

const MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const OTHER_ID = "b90fd384-a296-4a95-98dd-b3e79fc36d93";
const logger = { error() {} };
const now = () => new Date("2026-09-15T17:00:00.000Z");

function mockDatabase(options = {}) {
  const tables = structuredClone({
    merchants: [{ id: MERCHANT_ID, name: "Merchant", status: "active", created_at: "2026-01-01", updated_at: "2026-01-01" }],
    page_events: [],
    profiles: [{ id: "admin-user", role: "admin", merchant_id: null }],
    daily_merchant_stats: [],
    ...options.tables,
  });
  const calls = [];
  const users = new Map([["existing-user", { id: "existing-user", email: "existing@example.com" }]]);
  let nextId = 0;

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = "select";
      this.filters = [];
      this.orders = [];
      this.start = 0;
      this.end = Infinity;
    }
    select(columns) { this.columns = columns; return this; }
    eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
    is(field, value) { this.filters.push((row) => row[field] === value); return this; }
    lte(field, value) { this.filters.push((row) => row[field] <= value); return this; }
    or(expression) {
      assert.equal(expression, "status.is.null,status.eq.active");
      this.filters.push((row) => row.status === null || row.status === "active");
      return this;
    }
    order(field, { ascending = true } = {}) { this.orders.push({ field, ascending }); return this; }
    limit(count) { this.end = this.start + count - 1; return this; }
    range(start, end) { this.start = start; this.end = end; return this; }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    upsert(payload) { this.operation = "upsert"; this.payload = payload; return this; }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      calls.push({ table: this.table, operation: this.operation, payload: this.payload, start: this.start });
      const failure = options.fail?.(this, tables);
      if (failure) return { data: null, error: failure };
      let rows = tables[this.table].filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "insert") {
        const row = { id: `created-${++nextId}`, created_at: now().toISOString(), ...this.payload };
        tables[this.table].push(row);
        rows = [row];
      } else if (this.operation === "update") {
        for (const row of rows) Object.assign(row, this.payload);
      } else if (this.operation === "upsert") {
        const existing = tables[this.table].find((row) => row.id === this.payload.id);
        if (existing) Object.assign(existing, this.payload);
        else tables[this.table].push({ ...this.payload });
        rows = [existing || this.payload];
      }
      rows.sort((a, b) => {
        for (const { field, ascending } of this.orders) {
          if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
      const cap = options.rowCap ?? 1000;
      rows = rows.slice(this.start, Math.min(this.end + 1, this.start + cap));
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
  }
  const client = {
    from: (table) => new Query(table),
    auth: {
      getUser: async (token) => ({
        data: { user: token === "valid-token" ? { id: "admin-user" } : null },
        error: null,
      }),
      admin: {
        async createUser(payload) {
          calls.push({ operation: "createUser", payload });
          if (options.authError) return { data: { user: null }, error: options.authError };
          const user = { id: "new-user", email: payload.email };
          users.set(user.id, user);
          return { data: { user }, error: null };
        },
        async deleteUser(id) {
          calls.push({ operation: "deleteUser", id });
          if (options.deleteError) return { error: options.deleteError };
          users.delete(id);
          return { error: null };
        },
      },
    },
  };
  return { client, tables, calls, users };
}

function request(body, { method = "POST", token, url = "https://example.test/api", headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

function eventHandler(db) {
  return createEventsHandler({ getClient: () => db.client, logger });
}

function statsHandler(db) {
  return createAdminStatsHandler({ getClient: () => db.client, now, logger });
}

function merchantsHandler(db) {
  return createMerchantsHandler({ getClient: () => db.client, logger });
}

const pageView = { merchantId: MERCHANT_ID, eventType: "page_view", merchantName: "Untrusted name" };
const merchantInput = { name: "New merchant", createAccount: true, accountEmail: "new@example.com", accountPassword: "test-password" };
const adminRequest = (body) => request(body, { token: "valid-token" });

test("anonymous page views use an existing merchant without creating or renaming one", async () => {
  const db = mockDatabase();
  const response = await eventHandler(db)(request(pageView));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.merchant.name, "Merchant");
  assert.equal(db.tables.page_events.length, 1);
  assert.equal(db.tables.page_events[0].merchant_id, MERCHANT_ID);
  assert.equal(db.calls.filter((call) => call.table === "merchants" && call.operation !== "select").length, 0);
});

test("unknown merchant IDs cannot create merchants or fall back to a supplied name", async () => {
  const db = mockDatabase();
  const response = await eventHandler(db)(request({ ...pageView, merchantId: OTHER_ID, merchantName: "Merchant" }));
  assert.equal(response.status, 404);
  assert.equal(db.tables.merchants.length, 1);
  assert.equal(db.tables.page_events.length, 0);
});

test("inactive and unexpected merchant states reject events; legacy null status stays supported", async () => {
  for (const status of ["inactive", "suspended", null]) {
    const db = mockDatabase({ tables: { merchants: [{ id: MERCHANT_ID, name: "Merchant", status }] } });
    const response = await eventHandler(db)(request(pageView));
    assert.equal(response.status, status === null ? 200 : 404);
  }
});

test("event input rejects unknown types, invalid platforms and invalid field shapes before DB access", async () => {
  const invalid = [
    { merchantId: "new-arbitrary-merchant" },
    { merchantId: null },
    { eventType: "published" },
    { eventType: "share_click" },
    { platform: "unknown" },
    { visitorId: {} },
    { source: "x".repeat(129) },
    { userAgent: "x".repeat(1025) },
    { pagePath: "/bad\0path" },
    { merchantName: "x".repeat(161) },
    { metadata: [] },
    { metadata: "invalid" },
  ];
  for (const changes of invalid) {
    const db = mockDatabase();
    const response = await eventHandler(db)(request({ ...pageView, ...changes }));
    assert.equal(response.status, 400, JSON.stringify(changes));
    assert.equal(db.calls.length, 0);
  }
});

test("valid share clicks preserve supported platform and metadata", async () => {
  for (const platform of ["redbook", "meituan", "dianping"]) {
    const db = mockDatabase();
    const response = await eventHandler(db)(request({ ...pageView, eventType: "share_click", platform, metadata: { date: "2026-09-16" } }));
    assert.equal(response.status, 200);
    assert.equal(db.tables.page_events[0].platform, platform);
  }
});

test("malformed and oversized event bodies are client errors without database writes", async () => {
  for (const [body, headers, status] of [
    ["{", {}, 400],
    ["[]", {}, 400],
    ["null", {}, 400],
    [{ ...pageView, metadata: { value: "x".repeat(4096) } }, {}, 413],
    ["x".repeat(17000), {}, 413],
    [pageView, { "content-length": "17000" }, 413],
  ]) {
    const db = mockDatabase();
    const response = await eventHandler(db)(request(body, { headers }));
    assert.equal(response.status, status);
    assert.equal(db.calls.length, 0);
  }
});

test("event DB failures do not expose service details", async () => {
  const db = mockDatabase({ fail: () => ({ message: "secret SQL connection detail" }) });
  const response = await eventHandler(db)(request(pageView));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret|SQL|connection/);
});

test("event methods keep preflight available and reject non-POST writes", async () => {
  const db = mockDatabase();
  assert.equal((await eventHandler(db)(request(null, { method: "OPTIONS" }))).status, 200);
  assert.equal((await eventHandler(db)(request(null, { method: "GET" }))).status, 405);
  assert.equal(db.calls.length, 0);
});

test("stats aggregate every page even when the server row cap is lower than requested", async () => {
  const events = Array.from({ length: 2501 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
    merchant_id: MERCHANT_ID,
    event_type: "page_view",
    created_at: "2026-09-15T00:00:00.000Z",
  }));
  events.push({ id: "share", merchant_id: MERCHANT_ID, event_type: "share_click", created_at: "2026-09-15T00:00:00.000Z" });
  events.push({ id: "future", merchant_id: MERCHANT_ID, event_type: "page_view", created_at: "2026-09-15T18:00:00.000Z" });
  const db = mockDatabase({
    rowCap: 700,
    tables: {
      page_events: events,
      daily_merchant_stats: [{ merchant_id: MERCHANT_ID, stat_date: "2026-09-16", today_entries: 7, redbook_shares: 4 }],
    },
  });
  const response = await statsHandler(db)(request(null, { method: "GET", token: "valid-token" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.date, "2026-09-16");
  assert.equal(result.merchants[0].totalEntries, 2501);
  assert.equal(result.merchants[0].todayEntries, 7);
  assert.equal(result.merchants[0].redbookShares, 4);
  assert.deepEqual(db.calls.filter((call) => call.table === "page_events").map((call) => call.start), [0, 700, 1400, 2100, 2501]);
});

test("stats paginate merchant and daily rows as well as event totals", async () => {
  const merchants = Array.from({ length: 1002 }, (_, index) => ({ id: `merchant-${index}`, name: `Merchant ${index}`, status: "active", created_at: "2026-01-01" }));
  const daily = merchants.map((merchant) => ({ merchant_id: merchant.id, stat_date: "2026-09-16", today_entries: 2 }));
  const db = mockDatabase({ tables: { merchants, daily_merchant_stats: daily } });
  const response = await statsHandler(db)(request(null, { method: "GET", token: "valid-token" }));
  const result = await response.json();
  assert.equal(result.merchants.length, 1002);
  assert.equal(result.merchants.reduce((total, merchant) => total + merchant.todayEntries, 0), 2004);
});

test("merchant stats remain scoped on every paginated query", async () => {
  const db = mockDatabase({
    rowCap: 1,
    tables: {
      profiles: [{ id: "admin-user", role: "merchant", merchant_id: MERCHANT_ID }],
      merchants: [
        { id: MERCHANT_ID, name: "Own merchant", status: "active" },
        { id: OTHER_ID, name: "Other merchant", status: "active" },
      ],
      page_events: [
        { id: "1", merchant_id: MERCHANT_ID, event_type: "page_view", created_at: "2026-01-01" },
        { id: "2", merchant_id: OTHER_ID, event_type: "page_view", created_at: "2026-01-01" },
        { id: "3", merchant_id: MERCHANT_ID, event_type: "page_view", created_at: "2026-01-01" },
      ],
    },
  });
  const response = await statsHandler(db)(request(null, { method: "GET", token: "valid-token" }));
  const result = await response.json();
  assert.equal(result.merchants.length, 1);
  assert.equal(result.merchants[0].merchantId, MERCHANT_ID);
  assert.equal(result.merchants[0].totalEntries, 2);
});

test("stats reject unauthenticated requests and invalid dates", async () => {
  const db = mockDatabase();
  assert.equal((await statsHandler(db)(request(null, { method: "GET" }))).status, 401);
  for (const date of ["2026-02-30", "not-a-date", "2026-13-01"]) {
    const response = await statsHandler(db)(request(null, { method: "GET", token: "valid-token", url: `https://example.test/api?date=${date}` }));
    assert.equal(response.status, 400);
  }
});

test("a later stats page failure never returns a successful partial count", async () => {
  const db = mockDatabase({
    rowCap: 1,
    tables: { page_events: [{ id: "1", merchant_id: MERCHANT_ID, event_type: "page_view", created_at: "2026-01-01" }] },
    fail: (query) => query.table === "page_events" && query.start > 0 ? { message: "secret database info" } : null,
  });
  const response = await statsHandler(db)(request(null, { method: "GET", token: "valid-token" }));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret database/);
});

test("successful merchant creation returns the existing API contract without compensation", async () => {
  const db = mockDatabase();
  const response = await merchantsHandler(db)(adminRequest(merchantInput));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.merchant.name, merchantInput.name);
  assert.equal(result.account.email, merchantInput.accountEmail);
  assert.equal(result.account.password, merchantInput.accountPassword);
  assert.equal(db.tables.profiles.find((profile) => profile.id === "new-user").merchant_id, result.merchant.id);
  assert.equal(db.calls.some((call) => call.operation === "deleteUser"), false);
});

test("duplicate email failure deactivates only the new merchant and never deletes an existing account", async () => {
  const db = mockDatabase({ authError: { message: "A user with this email already exists" } });
  const response = await merchantsHandler(db)(adminRequest({ ...merchantInput, accountEmail: "existing@example.com" }));
  assert.equal(response.status, 409);
  assert.equal(db.tables.merchants.find((merchant) => merchant.name === merchantInput.name).status, "inactive");
  assert.equal(db.users.has("existing-user"), true);
  assert.equal(db.calls.some((call) => call.operation === "deleteUser"), false);
});

test("reactivating an inactive merchant is fully restored if account creation fails", async () => {
  const previous = {
    id: MERCHANT_ID, name: merchantInput.name, industry: "Original industry", status: "inactive",
    contact_name: "Original contact", contact_phone: "12345", created_at: "2026-01-01", updated_at: "2026-01-01",
  };
  const db = mockDatabase({ tables: { merchants: [previous] }, authError: { message: "already registered" } });
  const response = await merchantsHandler(db)(adminRequest({ ...merchantInput, industry: "Changed industry", contactName: "Changed contact" }));
  assert.equal(response.status, 409);
  assert.deepEqual(db.tables.merchants[0], previous);
  assert.equal(db.calls.some((call) => call.operation === "deleteUser"), false);
});

test("profile upsert failure deletes only the account created by the current request", async () => {
  const db = mockDatabase({ fail: (query) => query.table === "profiles" && query.operation === "upsert" ? { message: "secret profile failure" } : null });
  const response = await merchantsHandler(db)(adminRequest(merchantInput));
  assert.equal(response.status, 500);
  assert.equal(db.users.has("new-user"), false);
  assert.equal(db.users.has("existing-user"), true);
  assert.deepEqual(db.calls.filter((call) => call.operation === "deleteUser").map((call) => call.id), ["new-user"]);
  assert.equal(db.tables.merchants.find((merchant) => merchant.name === merchantInput.name).status, "inactive");
  assert.doesNotMatch(await response.text(), /secret profile/);
});

test("failed cleanup returns an actionable failure and still attempts merchant compensation", async () => {
  const db = mockDatabase({
    deleteError: { message: "secret delete failure" },
    fail: (query) => query.table === "profiles" && query.operation === "upsert" ? { message: "profile failure" } : null,
  });
  const response = await merchantsHandler(db)(adminRequest(merchantInput));
  assert.equal(response.status, 500);
  assert.match((await response.json()).message, /管理员/);
  assert.equal(db.tables.merchants.find((merchant) => merchant.name === merchantInput.name).status, "inactive");
  assert.equal(db.users.has("existing-user"), true);
});

test("rollback does not overwrite a merchant changed by another request", async () => {
  const db = mockDatabase({
    fail(query, tables) {
      if (query.table === "profiles" && query.operation === "upsert") {
        const created = tables.merchants.find((merchant) => merchant.name === merchantInput.name);
        created.updated_at = "2099-01-01";
        created.contact_name = "Concurrent edit";
        return { message: "profile failure" };
      }
      return null;
    },
  });
  const response = await merchantsHandler(db)(adminRequest(merchantInput));
  assert.equal(response.status, 500);
  const created = db.tables.merchants.find((merchant) => merchant.name === merchantInput.name);
  assert.equal(created.contact_name, "Concurrent edit");
  assert.equal(created.updated_at, "2099-01-01");
  assert.equal(db.users.has("new-user"), false);
  assert.match((await response.json()).message, /管理员/);
});

test("reactivation rejects a concurrently changed inactive merchant before creating an account", async () => {
  const db = mockDatabase({
    tables: { merchants: [{ id: MERCHANT_ID, name: merchantInput.name, status: "inactive", updated_at: "2026-01-01" }] },
    fail(query, tables) {
      if (query.table === "merchants" && query.operation === "update") {
        tables.merchants[0].updated_at = "2026-02-01";
      }
      return null;
    },
  });
  const response = await merchantsHandler(db)(adminRequest(merchantInput));
  assert.equal(response.status, 409);
  assert.equal(db.tables.merchants[0].status, "inactive");
  assert.equal(db.calls.some((call) => call.operation === "createUser"), false);
});

test("merchant creation validates requests and keeps administrator authorization", async () => {
  const db = mockDatabase();
  assert.equal((await merchantsHandler(db)(request(merchantInput))).status, 401);
  assert.equal((await merchantsHandler(db)(adminRequest("{"))).status, 400);
  assert.equal((await merchantsHandler(db)(adminRequest({ ...merchantInput, createAccount: "false" }))).status, 400);
  assert.equal((await merchantsHandler(db)(adminRequest({ ...merchantInput, name: "x".repeat(161) }))).status, 400);
  const merchantDb = mockDatabase({ tables: { profiles: [{ id: "admin-user", role: "merchant", merchant_id: MERCHANT_ID }] } });
  assert.equal((await merchantsHandler(merchantDb)(adminRequest(merchantInput))).status, 403);
});
