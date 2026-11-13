import { apiUrl } from "./api";
import type { PublishPayload } from "./types";

export interface XhsMiniappHandoff {
  handoffId: string;
  launchUrl: string;
  expiresAt: string;
}

function validLaunchUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "xhsdiscover:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function createXhsMiniappHandoff({
  merchantId,
  source,
  payload,
}: {
  merchantId: string;
  source: string;
  payload: PublishPayload;
}): Promise<XhsMiniappHandoff> {
  const response = await fetch(apiUrl("/.netlify/functions/share-handoff"), {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  if (!response.ok || !data || typeof data.handoffId !== "string" || !validLaunchUrl(data.launchUrl) || typeof data.expiresAt !== "string") {
    throw new Error(data?.message || "小红书小程序连接失败，请稍后重试");
  }
  return { handoffId: data.handoffId, launchUrl: data.launchUrl!, expiresAt: data.expiresAt };
}

export function openXhsMiniapp(launchUrl: string) {
  if (!validLaunchUrl(launchUrl)) throw new Error("小红书小程序地址无效");
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    throw new Error("本地预览已完成草稿交接，但不会打开小红书；部署后可进行真机测试");
  }
  window.location.href = launchUrl;
}
