import type { SharePlatform } from "./types";
import { apiUrl } from "./api";

export type MerchantStats = {
  merchantId: string;
  merchantName: string;
  todayEntries: number;
  totalEntries: number;
  redbookShares: number;
  meituanShares: number;
  dianpingShares: number;
  updatedAt: string;
};

export type AdminStatsSnapshot = {
  date: string;
  merchants: MerchantStats[];
  generatedAt: string;
  source?: "cloud" | "local";
  viewer?: {
    role: "admin" | "merchant";
    merchantId: string | null;
  };
};

const DEFAULT_MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const DEFAULT_MERCHANT_NAME = "深圳汇职驾校";
const STORAGE_KEY = "huizhi_admin_stats_v1";
const VISITOR_KEY = "huizhi_visitor_id";
const ADMIN_STATS_ENDPOINT = "/.netlify/functions/admin-stats";
const EVENTS_ENDPOINT = "/.netlify/functions/events";

const seededMerchants: MerchantStats[] = [
  {
    merchantId: DEFAULT_MERCHANT_ID,
    merchantName: DEFAULT_MERCHANT_NAME,
    todayEntries: 0,
    totalEntries: 0,
    redbookShares: 0,
    meituanShares: 0,
    dianpingShares: 0,
    updatedAt: new Date().toISOString(),
  },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function createVisitorId() {
  const existing = window.localStorage.getItem(VISITOR_KEY);
  if (existing) return existing;

  const next = `visitor_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(VISITOR_KEY, next);
  return next;
}

function readStats(): MerchantStats[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededMerchants));
    return seededMerchants;
  }

  try {
    const parsed = JSON.parse(raw) as MerchantStats[];
    return Array.isArray(parsed) ? parsed : seededMerchants;
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededMerchants));
    return seededMerchants;
  }
}

function writeStats(nextStats: MerchantStats[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStats));
}

function ensureMerchant(stats: MerchantStats[], merchantId: string, merchantName: string) {
  const existing = stats.find((merchant) => merchant.merchantId === merchantId);
  if (existing) return existing;

  const next: MerchantStats = {
    merchantId,
    merchantName,
    todayEntries: 0,
    totalEntries: 0,
    redbookShares: 0,
    meituanShares: 0,
    dianpingShares: 0,
    updatedAt: new Date().toISOString(),
  };
  stats.push(next);
  return next;
}

function getLocalAdminStats(date = todayKey()): AdminStatsSnapshot {
  return {
    date,
    merchants: readStats(),
    generatedAt: new Date().toISOString(),
    source: "local",
  };
}

async function postEvent(body: Record<string, unknown>) {
  const response = await fetch(apiUrl(EVENTS_ENDPOINT), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("事件记录接口暂不可用");
  }
}

export function getMerchantFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const merchantId = search.get("merchantId") || search.get("merchant") || DEFAULT_MERCHANT_ID;
  const merchantName = search.get("merchantName") || DEFAULT_MERCHANT_NAME;
  return { merchantId, merchantName };
}

export async function fetchAdminStats(date = todayKey(), accessToken?: string): Promise<AdminStatsSnapshot> {
  try {
    const response = await fetch(apiUrl(`${ADMIN_STATS_ENDPOINT}?date=${encodeURIComponent(date)}`), {
      headers: {
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    if (!response.ok) throw new Error("后台统计接口暂不可用");

    const snapshot = (await response.json()) as AdminStatsSnapshot;
    return {
      ...snapshot,
      date: snapshot.date || date,
      source: "cloud",
    };
  } catch {
    return getLocalAdminStats(date);
  }
}

export function getAdminStats(): AdminStatsSnapshot {
  return getLocalAdminStats();
}

export function trackProductEntry(merchantId: string, merchantName: string) {
  const visitorId = createVisitorId();
  const date = todayKey();
  const sessionKey = `huizhi_entry_${date}_${merchantId}_${visitorId}`;

  if (window.sessionStorage.getItem(sessionKey)) return;
  window.sessionStorage.setItem(sessionKey, "1");

  const stats = readStats();
  const merchant = ensureMerchant(stats, merchantId, merchantName);
  merchant.todayEntries += 1;
  merchant.totalEntries += 1;
  merchant.updatedAt = new Date().toISOString();
  writeStats(stats);

  void postEvent({
    eventType: "page_view",
    merchantId,
    merchantName,
    visitorId,
    source: new URLSearchParams(window.location.search).get("source") || "nfc",
    pagePath: window.location.pathname || "/",
    userAgent: navigator.userAgent,
    metadata: {
      date,
      href: window.location.href,
    },
  }).catch(() => undefined);
}

export function trackShareClick(merchantId: string, merchantName: string, platform: SharePlatform) {
  const stats = readStats();
  const merchant = ensureMerchant(stats, merchantId, merchantName);

  if (platform === "redbook") merchant.redbookShares += 1;
  if (platform === "meituan") merchant.meituanShares += 1;
  if (platform === "dianping") merchant.dianpingShares += 1;

  merchant.updatedAt = new Date().toISOString();
  writeStats(stats);

  void postEvent({
    eventType: "share_click",
    merchantId,
    merchantName,
    platform,
    source: new URLSearchParams(window.location.search).get("source") || "nfc",
    pagePath: window.location.pathname || "/",
    userAgent: navigator.userAgent,
    metadata: {
      date: todayKey(),
      href: window.location.href,
    },
  }).catch(() => undefined);
}

export function resetAdminStats() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededMerchants));
}
