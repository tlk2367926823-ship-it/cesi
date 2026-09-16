import { apiUrl } from "./api";
import type { PublishPayload } from "./types";

export interface XhsSignature {
  appKey: string;
  nonce: string;
  timestamp: string;
  signature: string;
}

export interface XhsPreparation {
  enabled: boolean;
  message: string;
  verifyConfig?: XhsSignature;
  validUntil?: number;
}

interface XhsSdk {
  share(options: {
    shareInfo: { type: "normal"; images: string[] };
    verifyConfig: XhsSignature;
    fail: (error: unknown) => void;
  }): void;
}

declare global {
  interface Window { xhs?: XhsSdk }
}

let sdkPromise: Promise<void> | undefined;
const sdkUrl = "https://fe-static.xhscdn.com/biz-static/goten/xhs-1.0.1.js";

function loadSdk() {
  if (window.xhs?.share) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(new Error("小红书组件加载超时")), 10000);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    }
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => finish(window.xhs?.share ? undefined : new Error("小红书组件暂不可用"));
    script.onerror = () => finish(new Error("小红书组件加载失败，请检查网络"));
    document.head.appendChild(script);
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export async function prepareXhsShare(merchantId: string, signal: AbortSignal): Promise<XhsPreparation> {
  const response = await fetch(apiUrl(`/.netlify/functions/xhs-share?merchantId=${encodeURIComponent(merchantId)}`), {
    signal, headers: { accept: "application/json" }, cache: "no-store",
  });
  if (!response.ok) throw new Error("小红书官方通道暂不可用，可重试或选择备用方式");
  const data = await response.json() as XhsPreparation;
  if (!data.enabled) return { enabled: false, message: "小红书官方通道尚未开通，当前可使用系统分享" };
  const config = data.verifyConfig;
  if (!config || !config.appKey || !config.nonce || !/^\d{13}$/.test(config.timestamp) ||
      !/^[a-f0-9]{64}$/.test(config.signature) || !Number.isFinite(data.validUntil)) {
    throw new Error("小红书签名返回异常，请重试");
  }
  await loadSdk();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return data;
}

export function invokeXhsShare(payload: PublishPayload, prepared: XhsPreparation, onFail: () => void) {
  if (!prepared.enabled || !prepared.verifyConfig || !prepared.validUntil ||
      Date.now() >= prepared.validUntil || !window.xhs?.share) {
    throw new Error("官方通道需要重新准备，请点击重试后再分享");
  }
  if (payload.assets.length === 0 || payload.assets.length > 18) throw new Error("请选择有效图片");
  const images = payload.assets.map(asset => {
    const url = new URL(asset, window.location.href);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("官方分享需要公开可访问的 HTTPS 图片地址");
    }
    return url.href;
  });
  // The current web SDK no longer fills title/body/topics and documents only fail.
  window.xhs.share({ shareInfo: { type: "normal", images }, verifyConfig: prepared.verifyConfig, fail: onFail });
}
