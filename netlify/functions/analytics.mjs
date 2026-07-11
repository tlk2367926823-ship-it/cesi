import { getStore } from "@netlify/blobs";

const STORE_NAME = "huizhi-analytics-v1";
const STATS_KEY = "stats";
const TIME_ZONE = "Asia/Shanghai";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function getDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function createEmptyData() {
  return {
    merchants: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function readData() {
  const store = getStore(STORE_NAME);
  const data = await store.get(STATS_KEY, { type: "json" });
  return data || createEmptyData();
}

async function writeData(data) {
  data.updatedAt = new Date().toISOString();
  const store = getStore(STORE_NAME);
  await store.setJSON(STATS_KEY, data);
}

function ensureMerchant(data, merchantId, merchantName) {
  if (!data.merchants[merchantId]) {
    data.merchants[merchantId] = {
      merchantId,
      merchantName,
      totalEntries: 0,
      redbookSharesTotal: 0,
      meituanSharesTotal: 0,
      dianpingSharesTotal: 0,
      daily: {},
      updatedAt: new Date().toISOString(),
    };
  }

  const merchant = data.merchants[merchantId];
  merchant.merchantName = merchantName || merchant.merchantName || merchantId;
  return merchant;
}

function ensureDaily(merchant, dateKey) {
  if (!merchant.daily[dateKey]) {
    merchant.daily[dateKey] = {
      entries: 0,
      redbookShares: 0,
      meituanShares: 0,
      dianpingShares: 0,
      visitors: [],
    };
  }
  return merchant.daily[dateKey];
}

function toAdminSnapshot(data, dateKey) {
  const merchants = Object.values(data.merchants).map((merchant) => {
    const daily = merchant.daily[dateKey] || {
      entries: 0,
      redbookShares: 0,
      meituanShares: 0,
      dianpingShares: 0,
    };

    return {
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      todayEntries: daily.entries || 0,
      totalEntries: merchant.totalEntries || 0,
      redbookShares: daily.redbookShares || 0,
      meituanShares: daily.meituanShares || 0,
      dianpingShares: daily.dianpingShares || 0,
      updatedAt: merchant.updatedAt || data.updatedAt,
    };
  });

  return {
    date: dateKey,
    merchants,
    generatedAt: new Date().toISOString(),
  };
}

async function handleRecord(body) {
  const type = body.type;
  const merchantId = String(body.merchantId || "huizhi-driving");
  const merchantName = String(body.merchantName || merchantId);
  const platform = body.platform;
  const visitorId = String(body.visitorId || "");
  const dateKey = body.date || getDateKey();

  const data = await readData();
  const merchant = ensureMerchant(data, merchantId, merchantName);
  const daily = ensureDaily(merchant, dateKey);

  if (type === "entry") {
    if (!visitorId || !daily.visitors.includes(visitorId)) {
      daily.entries += 1;
      merchant.totalEntries += 1;
      if (visitorId) daily.visitors.push(visitorId);
    }
  }

  if (type === "share") {
    if (platform === "redbook") {
      daily.redbookShares += 1;
      merchant.redbookSharesTotal += 1;
    }
    if (platform === "meituan") {
      daily.meituanShares += 1;
      merchant.meituanSharesTotal += 1;
    }
    if (platform === "dianping") {
      daily.dianpingShares += 1;
      merchant.dianpingSharesTotal += 1;
    }
  }

  merchant.updatedAt = new Date().toISOString();
  await writeData(data);

  return jsonResponse(200, {
    ok: true,
    snapshot: toAdminSnapshot(data, dateKey),
  });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const dateKey = url.searchParams.get("date") || getDateKey();
      const data = await readData();
      return jsonResponse(200, toAdminSnapshot(data, dateKey));
    }

    if (request.method === "POST") {
      const body = await request.json();
      return await handleRecord(body);
    }

    return jsonResponse(405, { ok: false, message: "Method not allowed" });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      message: error instanceof Error ? error.message : "Analytics function error",
    });
  }
}
