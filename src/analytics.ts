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

function createSeededMerchants(): MerchantStats[] {
  return [
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
}

export function localDateKey(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const todayKey = localDateKey;
let fallbackStats: { date: string; merchants: MerchantStats[] } | undefined;
let fallbackVisitorId = "";
const trackedEntries = new Set<string>();

function createVisitorId() {
  let existing = fallbackVisitorId;
  try {
    existing = window.localStorage.getItem(VISITOR_KEY) || existing;
  } catch {
    // Storage can be unavailable in private or embedded browsers.
  }
  if (existing) return existing;

  const next = `visitor_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  fallbackVisitorId = next;
  try {
    window.localStorage.setItem(VISITOR_KEY, next);
  } catch {
    // Keep the same visitor for this page when persistent storage is blocked.
  }
  return next;
}

function readStats(): MerchantStats[] {
  let stored: unknown = fallbackStats;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    // In-memory statistics remain available without persistent storage.
  }
  const envelope = stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored as { date?: string; merchants?: unknown }
    : undefined;
  const rows = Array.isArray(stored) ? stored : envelope?.merchants;
  if (!Array.isArray(rows)) {
    const initial = createSeededMerchants();
    writeStats(initial);
    return initial;
  }
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const today = todayKey();
  const merchants = rows
    .filter((row): row is MerchantStats => Boolean(row && typeof row === "object" && typeof row.merchantId === "string"))
    .map((row) => {
      const entryDate = envelope?.date || localDateKey(new Date(row.updatedAt));
      const sameDay = entryDate === today;
      return {
        merchantId: row.merchantId,
        merchantName: typeof row.merchantName === "string" ? row.merchantName : "未命名商家",
        totalEntries: count(row.totalEntries),
        todayEntries: sameDay ? count(row.todayEntries) : 0,
        redbookShares: sameDay ? count(row.redbookShares) : 0,
        meituanShares: sameDay ? count(row.meituanShares) : 0,
        dianpingShares: sameDay ? count(row.dianpingShares) : 0,
        updatedAt: Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : new Date().toISOString(),
      };
    });
  writeStats(merchants);
  return merchants;
}

function writeStats(nextStats: MerchantStats[]) {
  fallbackStats = { date: todayKey(), merchants: nextStats };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallbackStats));
  } catch {
    // Tracking must not prevent the publishing workflow from opening.
  }
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

function getLocalAdminStats(): AdminStatsSnapshot {
  return {
    date: todayKey(),
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl(`${ADMIN_STATS_ENDPOINT}?date=${encodeURIComponent(date)}`), {
      headers: {
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      signal: controller.signal,
    });

    if (response.status === 401) throw new Error("登录状态已失效，请重新登录后读取统计。");
    if (response.status === 403) throw new Error("当前账号没有统计权限，请联系管理员检查商家绑定。");
    if (!response.ok) throw new Error("云端统计读取失败，请稍后重试。");

    const snapshot = (await response.json()) as AdminStatsSnapshot;
    if (
      !snapshot ||
      !Array.isArray(snapshot.merchants) ||
      !["admin", "merchant"].includes(snapshot.viewer?.role || "") ||
      snapshot.merchants.some((merchant) =>
        !merchant ||
        typeof merchant.merchantId !== "string" ||
        typeof merchant.merchantName !== "string" ||
        ![merchant.todayEntries, merchant.totalEntries, merchant.redbookShares, merchant.meituanShares, merchant.dianpingShares]
          .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
      )
    ) {
      throw new Error("云端统计返回异常，请重新读取。");
    }
    return {
      ...snapshot,
      date: snapshot.date || date,
      source: "cloud",
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("云端统计读取超时，请检查网络后重试。");
    throw error instanceof Error ? error : new Error("云端统计暂时无法读取，请检查网络后重试。");
  } finally {
    clearTimeout(timeout);
  }
}

export function getAdminStats(): AdminStatsSnapshot {
  return getLocalAdminStats();
}

export function trackProductEntry(merchantId: string, merchantName: string) {
  const visitorId = createVisitorId();
  const date = todayKey();
  const sessionKey = `huizhi_entry_${date}_${merchantId}_${visitorId}`;

  if (trackedEntries.has(sessionKey)) return;
  try {
    if (window.sessionStorage.getItem(sessionKey)) return;
    window.sessionStorage.setItem(sessionKey, "1");
  } catch {
    // Fall back to per-page deduplication when session storage is blocked.
  }
  trackedEntries.add(sessionKey);

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
  writeStats(createSeededMerchants());
}
