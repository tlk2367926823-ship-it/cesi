import type { PublishPayload, PublishResult, Publisher } from "../types";

// #ifdef H5
const XHS_APP_STORE_IOS = "https://apps.apple.com/cn/app/id741292507";
const XHS_APP_STORE_ANDROID = "https://play.google.com/store/apps/details?id=com.xingin.xhs";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    // fall through to async method
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function getShareText(payload: PublishPayload) {
  return `${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;
}

function getFullShareText(payload: PublishPayload) {
  return `${payload.title}\n\n${getShareText(payload)}`;
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isIos() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isWechat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function getXhsScheme(payload: PublishPayload) {
  const isVideo = payload.assets.some((asset) => /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(asset));
  return isVideo ? "xhsdiscover://post_video_album/" : "xhsdiscover://post/";
}

function getXhsTextNoteScheme() {
  return "xhsdiscover://post_note/";
}

function getXhsHomeScheme() {
  return "xhsdiscover://home";
}

function getXhsAndroidIntent(payload: PublishPayload, target: "album" | "note" | "home") {
  const playStore = encodeURIComponent(XHS_APP_STORE_ANDROID);
  const scheme = "xhsdiscover";
  if (target === "home") {
    return `intent://home#Intent;scheme=${scheme};package=com.xingin.xhs;S.browser_fallback_url=${playStore};end`;
  }
  if (target === "note") {
    return `intent://post_note/#Intent;scheme=${scheme};package=com.xingin.xhs;S.browser_fallback_url=${playStore};end`;
  }
  const isVideo = payload.assets.some((asset) => /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(asset));
  const path = isVideo ? "post_video_album/" : "post/";
  return `intent://${path}#Intent;scheme=${scheme};package=com.xingin.xhs;S.browser_fallback_url=${playStore};end`;
}

function openDeepLink(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function openAppByUrl(url: string) {
  openDeepLink(url);
  window.location.href = url;
}

async function assetToFile(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("素材读取失败");
  }

  const blob = await response.blob();
  const mime = blob.type || "image/png";
  return new File([blob], getFileName(url), { type: mime });
}
// #endif

function getFileName(url: string) {
  const cleanUrl = url.split("?")[0];
  return cleanUrl.split("/").pop() || "huizhi-share.png";
}

export class CopyPublisher implements Publisher {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const text = `${payload.title}\n\n${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;

    try {
      // #ifdef H5
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      // #endif
      // #ifndef H5
      await uni.setClipboardData({ data: text });
      // #endif
      return { success: true, mode: "copy", message: "文案已复制" };
    } catch {
      return { success: false, mode: "copy", message: "复制失败，请手动复制" };
    }
  }
}

// #ifdef H5
export class DeeplinkPublisher implements Publisher {
  constructor(private target: "album" | "note" | "home" = "album") {}

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const fullText = `${payload.title}\n\n${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;

    if (!isAndroid() && !isIos()) {
      const copied = await copyToClipboard(fullText);
      return {
        success: copied,
        mode: "deeplink",
        message: copied ? "文案已复制。请在手机浏览器中打开此页面以跳转小红书。" : "请在手机浏览器中打开此页面。",
      };
    }

    if (isWechat()) {
      const copied = await copyToClipboard(fullText);
      return {
        success: copied,
        mode: "deeplink",
        message: copied
          ? "文案已复制。微信内无法直接打开小红书，请点击右上角··· → 在浏览器打开，然后重新点击发布按钮。"
          : "文案复制失败，请手动复制。微信内无法直接打开小红书，请点击右上角··· → 在浏览器打开。",
      };
    }

    const intentUrl = isAndroid() ? getXhsAndroidIntent(payload, this.target) : null;
    const schemeUrl = this.target === "home"
      ? getXhsHomeScheme()
      : this.target === "note"
        ? getXhsTextNoteScheme()
        : getXhsScheme(payload);

    // Fire deep link in user gesture context FIRST (must be synchronous, before any await)
    const url = isAndroid() ? (intentUrl || schemeUrl) : schemeUrl;
    openDeepLink(url);
    // App Link / Universal Link fallback — works on all Android/iOS browsers
    // via verified HTTPS association; opens directly if app installed, or loads in browser
    openDeepLink("https://www.xiaohongshu.com/explore");

    if (isAndroid()) {
      const copied = await copyToClipboard(fullText);
      return {
        success: true,
        mode: "deeplink",
        message: copied
          ? "文案已复制。如果小红书已安装，应该已自动打开。如未打开请手动打开小红书粘贴发布。"
          : "文案复制失败，请手动复制后在小红书发布。",
      };
    }

    const copied = await copyToClipboard(fullText);

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          mode: "deeplink",
          message: copied
            ? "文案已复制。如已安装小红书，请确认系统弹窗后进入粘贴发布。如未安装请下载后再试。"
            : "文案复制失败，请手动复制。如已安装小红书，请确认系统弹窗。",
          storeUrl: XHS_APP_STORE_IOS,
        });
      }, 4000);
    });
  }
}

export class XhsSchemePublisher implements Publisher {
  constructor(private target: "album" | "note" | "home" = "album") {}

  async publish(payload: PublishPayload): Promise<PublishResult> {
    if (!isAndroid() && !isIos()) {
      return {
        success: false,
        mode: "deeplink",
        message: "当前不是手机浏览器，请用安卓或 iPhone 打开活动页。",
      };
    }

    const appUrl =
      this.target === "home"
        ? getXhsHomeScheme()
        : this.target === "note"
          ? getXhsTextNoteScheme()
          : getXhsScheme(payload);

    window.location.href = appUrl;

    return {
      success: true,
      mode: "deeplink",
      message:
        this.target === "home"
          ? "正在打开小红书"
          : this.target === "note"
            ? "正在打开小红书文字发布界面"
            : "正在尝试打开小红书相册发布入口",
    };
  }
}

export class NativeSharePublisher implements Publisher {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    if (!navigator.share) {
      return {
        success: false,
        mode: "native-share",
        message: "当前浏览器不支持系统分享",
      };
    }

    const files = await Promise.all(payload.assets.map(assetToFile));
    const shareData: ShareData = {
      title: payload.title,
      text: getShareText(payload),
      files,
    };

    if (files.length > 0 && navigator.canShare && !navigator.canShare(shareData)) {
      await navigator.share({
        title: payload.title,
        text: getFullShareText(payload),
      });
      return { success: true, mode: "native-share", message: "已调起系统分享，素材需手动选择" };
    }

    await navigator.share(shareData);
    return { success: true, mode: "native-share", message: "已调起系统分享" };
  }
}

export class XhsSdkPublisher implements Publisher {
  private signatureUrl: string;

  constructor(signatureUrl = "http://192.168.111.10:3000/api/xhs/signature") {
    this.signatureUrl = signatureUrl;
  }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    try {
      await loadXhsSdk();

      const xhs = (window as any).xhs;
      if (!xhs?.share) throw new Error("小红书 SDK 加载失败");

      const absoluteImages = payload.assets.map((url) =>
        url.startsWith("http") ? url : `${window.location.origin}${url}`,
      );

      const sigData = await this.fetchSignature();
      const verifyConfig = {
        appKey: sigData.appKey,
        nonce: sigData.nonce,
        timestamp: sigData.timestamp,
        signature: sigData.signature,
      };
      console.log("[XHS] signature OK, calling xhs.share with", verifyConfig);

      await new Promise<void>((resolve, reject) => {
        xhs.share({
          shareInfo: {
            type: "normal",
            title: payload.title,
            content: `${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`,
            images: absoluteImages,
          },
          verifyConfig,
          success: () => resolve(),
          fail: (err: any) => {
            console.error("xhs.share fail full:", JSON.stringify(err));
            reject(new Error(typeof err === "string" ? err : err?.message || JSON.stringify(err) || "分享失败"));
          },
        });
      });

      return { success: true, mode: "api", message: "已打开小红书发布页面" };
    } catch (err: any) {
      console.error("XhsSdkPublisher error:", err);
      const text = `${payload.title}\n\n${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;
      try {
        await navigator.clipboard.writeText(text);
      } catch {}
      return { success: false, mode: "api", message: `${err.message}，文案已复制到剪贴板` };
    }
  }

  private async fetchSignature() {
    const sigRes = await fetch(this.signatureUrl);
    if (!sigRes.ok) throw new Error(`签名服务 ${sigRes.status}`);
    const sigData = await sigRes.json();
    if (!sigData.success) throw new Error(sigData.message || "获取签名失败");
    return sigData.data;
  }
}

function loadXhsSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).xhs?.share) return resolve();
    const script = document.createElement("script");
    script.src = "https://fe-static.xhscdn.com/biz-static/goten/xhs-1.1.0.js";
    script.async = true;
    script.onload = () => {
      if ((window as any).xhs?.share) return resolve();
      setTimeout(() => {
        (window as any).xhs?.share ? resolve() : reject(new Error("小红书 SDK 加载失败"));
      }, 1000);
    };
    script.onerror = () => reject(new Error("小红书 SDK 加载失败"));
    document.head.appendChild(script);
  });
}
// #endif

// #ifdef MP-WEIXIN
export class MiniProgramPublisher implements Publisher {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const text = `${payload.title}\n\n${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;

    try {
      await uni.setClipboardData({ data: text });
      return { success: true, mode: "copy", message: "文案已复制到剪贴板" };
    } catch {
      return { success: false, mode: "copy", message: "复制失败" };
    }
  }
}
// #endif

export class XhsMiniProgramPublisher implements Publisher {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const text = `${payload.title}\n\n${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;

    try {
      await uni.setClipboardData({ data: text });
      return { success: true, mode: "copy", message: "文案已复制到剪贴板，请打开小红书 App 粘贴发布" };
    } catch {
      return { success: false, mode: "copy", message: "复制失败，请手动复制文案" };
    }
  }
}

export class MockPublisher implements Publisher {
  async publish(_payload: PublishPayload): Promise<PublishResult> {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return { success: true, mode: "mock", message: "模拟发布完成" };
  }
}
