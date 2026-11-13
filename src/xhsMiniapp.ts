import { apiUrl } from "./api";
import type { PublishPayload } from "./types";

export interface XhsMiniappHandoff {
  handoffId: string;
  launchUrl: string;
  expiresAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validLaunchUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "xhsdiscover:") return url.hostname === "miniapp";
    return url.protocol === "https:" && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"));
  } catch {
    return false;
  }
}

export async function createXhsMiniappHandoff({
  merchantId,
  source,
  payload,
  signal,
  timeoutMs = 12000,
}: {
  merchantId: string;
  source: string;
  payload: PublishPayload;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<XhsMiniappHandoff> {
  if (!payload.assets[0]) throw new Error("请先准备分享图片");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error("小红书连接超时配置无效");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(apiUrl("/.netlify/functions/share-handoff"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({
        merchantId,
        source,
        title: payload.title,
        body: payload.body,
        tags: payload.tags,
        imageUrl: payload.assets[0],
      }),
    });
    const data = await response.json().catch(() => null) as Partial<XhsMiniappHandoff> & { message?: string } | null;
    const expiry = typeof data?.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
    if (!response.ok || !data || !UUID_PATTERN.test(data.handoffId || "") || !validLaunchUrl(data.launchUrl) || !Number.isFinite(expiry) || expiry <= Date.now()) {
      throw new Error(data?.message || "小红书小程序连接失败，请稍后重试");
    }
    return { handoffId: data.handoffId!, launchUrl: data.launchUrl!, expiresAt: data.expiresAt! };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (controller.signal.aborted) throw new Error("连接小红书超时，请检查网络后重试");
    if (error instanceof TypeError || (typeof error === "object" && error !== null && "name" in error && error.name === "TypeError")) {
      throw new Error("暂时无法连接小红书，请检查网络后重试");
    }
    if (error instanceof Error) throw error;
    throw new Error("暂时无法连接小红书，请检查网络后重试");
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function openXhsMiniapp(launchUrl: string) {
  if (!validLaunchUrl(launchUrl)) throw new Error("小红书小程序地址无效");
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    throw new Error("本地预览已完成草稿交接，但不会打开小红书；部署后可进行真机测试");
  }
  window.location.href = launchUrl;
}
