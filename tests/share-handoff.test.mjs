import assert from "node:assert/strict";
import test from "node:test";
import { buildMiniappLaunchUrl, createShareHandoffHandler } from "../netlify/functions/share-handoff.mjs";

const NOW = Date.parse("2026-11-13T08:00:00.000Z");
const HANDOFF_ID = "11111111-1111-4111-8111-111111111111";
const MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const ORIGIN = "https://product.example.com";
const env = {
  URL: ORIGIN,
  XHS_MINIAPP_APP_ID: "6a4c8abbdb457600012f5b25",
  XHS_MINIAPP_PAGE_PATH: "pages/index/index",
};

function createDatabase({ expired = false, missingMerchant = false, insertError = null } = {}) {
  const rows = new Map();
  const calls = [];
  rows.set(HANDOFF_ID, {
    id: HANDOFF_ID,
    merchant_id: MERCHANT_ID,
    title: "深圳练车体验",
    body: "今天来汇职驾校练车，整体体验很顺。",
    tags: ["深圳学车", "汇职驾校"],
    image_url: `${ORIGIN}/mock-assets/coach-car.png`,
    source: "qrcode",
    status: "created",
    expires_at: new Date(NOW + (expired ? -1 : 30 * 60 * 1000)).toISOString(),
  });

  return {
    rows,
    calls,
    client: {
      from(table) {
        if (table === "merchants") {
          let id;
          return {
            select() { return this; },
            eq(_field, value) { id = value; return this; },
            async maybeSingle() {
              calls.push({ operation: "merchant", id });
              return { data: !missingMerchant && id === MERCHANT_ID ? { id, status: "active" } : null, error: null };
            },
          };
        }
        assert.equal(table, "share_handoffs");
        return {
          async insert(row) {
            calls.push({ operation: "insert", row });
            if (!insertError) rows.set(row.id, row);
            return { error: insertError };
          },
          select() {
            return {
              eq(_field, id) {
                return {
                  async maybeSingle() {
                    calls.push({ operation: "select", id });
                    return { data: rows.get(id) || null, error: null };
                  },
                };
              },
            };
          },
          update(changes) {
            return {
              async eq(_field, id) {
                calls.push({ operation: "update", id, changes });
                const current = rows.get(id);
                if (current) rows.set(id, { ...current, ...changes });
                return { error: null };
              },
            };
          },
        };
      },
    },
  };
}

function harness(options = {}) {
  const database = createDatabase(options);
  const logs = [];
  const handler = createShareHandoffHandler({
    env,
    getClient: () => database.client,
    now: () => NOW,
    makeId: () => HANDOFF_ID,
    logger: { error: (...args) => logs.push(args) },
  });
  return { handler, database, logs };
}

function postBody(overrides = {}) {
  return {
    merchantId: MERCHANT_ID,
    title: "深圳练车体验",
    body: "今天来汇职驾校练车，整体体验很顺。",
    tags: ["深圳学车", "汇职驾校"],
    imageUrl: "/mock-assets/coach-car.png",
    source: "qrcode",
    ...overrides,
  };
}

function postRequest(body = postBody()) {
  return new Request(`${ORIGIN}/.netlify/functions/share-handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("builds the configured Xiaohongshu miniapp route with only the handoff id", () => {
  assert.equal(
    buildMiniappLaunchUrl(HANDOFF_ID, env),
    `xhsdiscover://miniapp/6a4c8abbdb457600012f5b25/pages/index/index?handoffId=${HANDOFF_ID}`,
  );
});

test("creates a short-lived server-side draft and returns its miniapp launch URL", async () => {
  const { handler, database } = harness();
  const response = await handler(postRequest());
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.handoffId, HANDOFF_ID);
  assert.equal(payload.launchUrl, buildMiniappLaunchUrl(HANDOFF_ID, env));
  const inserted = database.calls.find((call) => call.operation === "insert").row;
  assert.equal(inserted.image_url, `${ORIGIN}/mock-assets/coach-car.png`);
  assert.equal(inserted.status, "created");
  assert.equal(inserted.expires_at, new Date(NOW + 30 * 60 * 1000).toISOString());
});

test("returns a live handoff and marks it opened without claiming publication", async () => {
  const { handler, database } = harness();
  const response = await handler(new Request(`${ORIGIN}/.netlify/functions/share-handoff?id=${HANDOFF_ID}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.title, "深圳练车体验");
  assert.deepEqual(payload.tags, ["深圳学车", "汇职驾校"]);
  const update = database.calls.find((call) => call.operation === "update");
  assert.equal(update.changes.status, "opened");
  assert.equal("published" in update.changes, false);
});

test("expired handoffs cannot be opened", async () => {
  const { handler, database } = harness({ expired: true });
  const response = await handler(new Request(`${ORIGIN}/.netlify/functions/share-handoff?id=${HANDOFF_ID}`));
  assert.equal(response.status, 410);
  assert.equal(database.calls.some((call) => call.operation === "update"), false);
});

test("rejects unsafe media, invalid merchants, and unsupported methods", async () => {
  const unsafe = harness();
  assert.equal((await unsafe.handler(postRequest(postBody({ imageUrl: "http://evil.example/image.jpg" })))).status, 400);
  const missing = harness({ missingMerchant: true });
  assert.equal((await missing.handler(postRequest())).status, 404);
  assert.equal((await missing.handler(new Request(`${ORIGIN}/.netlify/functions/share-handoff`, { method: "DELETE" }))).status, 405);
});

test("missing database migration returns an actionable message without leaking details", async () => {
  const { handler, logs } = harness({ insertError: { code: "42P01", message: "secret database detail" } });
  const response = await handler(postRequest());
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.match(text, /数据表尚未创建/);
  assert.equal(text.includes("secret database detail"), false);
  assert.equal(logs.length, 1);
});
