import type { PublishPayload, PublishResult, Publisher } from "./types";

export function getFullShareText(payload: PublishPayload) {
  return `${payload.title}\n\n${payload.body}\n\n${payload.tags.map((tag) => `#${tag}`).join(" ")}`;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isShareCancelled(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function prepareShareFiles(urls: string[], signal?: AbortSignal): Promise<File[]> {
  if (urls.length > 18) throw new Error("一次最多准备 18 张图片");
  const maxImageBytes = 20 * 1024 * 1024;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const checkAborted = () => {
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
  };
  function verifyImage(blob: Blob) {
    checkAborted();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cleanup = () => {};
      const invalidImage = () => new Error("图片内容损坏或无法解码，请更换图片");
      const cancel = () => finish(new DOMException("Aborted", "AbortError"));
      function finish(error?: Error) {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", cancel);
        cleanup();
        if (error) reject(error); else resolve();
      }
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        if (typeof createImageBitmap === "function") {
          // A bitmap may finish after cancellation; always release its decoded pixels.
          createImageBitmap(blob).then(bitmap => {
            const valid = bitmap.width > 0 && bitmap.height > 0;
            bitmap.close();
            finish(valid ? undefined : invalidImage());
          }, () => finish(invalidImage()));
        } else if (typeof Image === "function") {
          const image = new Image();
          const objectUrl = URL.createObjectURL(blob);
          cleanup = () => {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
            URL.revokeObjectURL(objectUrl);
          };
          image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? undefined : invalidImage());
          image.onerror = () => finish(invalidImage());
          image.src = objectUrl;
        } else {
          finish(new Error("此浏览器无法校验图片，请更换浏览器"));
        }
      } catch {
        finish(invalidImage());
      }
    });
  }
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    return await Promise.all(urls.map(async (url, index) => {
      checkAborted();
      const parsed = new URL(url, window.location.href);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("素材地址无效");
      const response = await fetch(parsed.href, { signal: controller.signal });
      if (!response.ok) throw new Error("图片读取失败，请重试或更换图片");
      if (Number(response.headers.get("content-length")) > maxImageBytes) {
        throw new Error("图片过大，请更换为 20 MB 以内的素材");
      }
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp)$/.test(type)) {
        throw new Error("请使用 20 MB 以内的 JPG、PNG 或 WebP 图片");
      }
      if (!response.body) throw new Error("图片内容为空，请更换图片");
      const reader = response.body.getReader();
      const cancelReader = () => { void reader.cancel().catch(() => {}); };
      const chunks: BlobPart[] = [];
      let size = 0;
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      try {
        checkAborted();
        while (true) {
          const { done, value } = await reader.read();
          checkAborted();
          if (done) break;
          size += value.byteLength;
          if (size > maxImageBytes) {
            cancelReader();
            throw new Error("图片过大，请更换为 20 MB 以内的素材");
          }
          chunks.push(value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        reader.releaseLock();
      }
      if (size === 0) throw new Error("图片内容为空，请更换图片");
      const blob = new Blob(chunks, { type });
      await verifyImage(blob);
      checkAborted();
      return new File([blob], `taotian-${index + 1}.${blob.type.split("/")[1]}`, { type: blob.type });
    }));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

export class CopyPublisher implements Publisher {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const text = getFullShareText(payload);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return { success: true, mode: "copy", outcome: "copied", message: "文案已复制" };
      }
    } catch {
      // Permission denial can still allow the legacy selection-based copy path.
    }
    const previousFocus = document.activeElement as HTMLElement | null;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0";
    let copied = false;
    try {
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      textarea.remove();
      previousFocus?.focus?.({ preventScroll: true });
    }
    return {
      success: copied, mode: "copy", outcome: copied ? "copied" : "failed",
      message: copied ? "文案已复制" : "自动复制未完成，请长按文案手动复制",
    };
  }
}

export class DeeplinkPublisher implements Publisher {
  constructor(private target: "album" | "note" | "home" = "album") {}

  async publish(_payload: PublishPayload): Promise<PublishResult> {
    if (!isMobile()) {
      return { success: false, mode: "deeplink", outcome: "failed", message: "请在手机浏览器中打开小红书" };
    }
    const path = this.target === "home" ? "home" : this.target === "note" ? "post_note/" : "post/";
    window.location.href = `xhsdiscover://${path}`;
    return {
      success: true, mode: "deeplink", outcome: "requested",
      message: "已请求打开小红书，尚未确认进入发布页或完成发布",
    };
  }
}

export class NativeSharePublisher implements Publisher {
  constructor(private files: File[] = []) {}

  async publish(payload: PublishPayload): Promise<PublishResult> {
    if (!navigator.share) {
      return { success: false, mode: "native-share", outcome: "failed", message: "此浏览器不支持系统分享" };
    }
    if (payload.assets.length > 0 && this.files.length !== payload.assets.length) {
      return { success: false, mode: "native-share", outcome: "failed", message: "图片尚未准备好，请重试图片加载" };
    }
    const data: ShareData = { title: payload.title, text: getFullShareText(payload) };
    if (this.files.length) data.files = this.files;
    if (navigator.canShare && !navigator.canShare(data)) {
      return { success: false, mode: "native-share", outcome: "failed", message: "此浏览器不能分享这张图片，可保存后手动发布" };
    }
    try {
      // Media is prepared before the click so share() retains user activation.
      await navigator.share(data);
      return { success: true, mode: "native-share", outcome: "handed-off", message: "已交给系统分享，最终发布状态请在目标平台确认" };
    } catch (error) {
      if (isShareCancelled(error)) {
        return { success: false, mode: "native-share", outcome: "cancelled", message: "已取消分享，草稿已保留" };
      }
      return { success: false, mode: "native-share", outcome: "failed", message: "系统分享未完成，可重试或选择手动发布" };
    }
  }
}

type ReviewPlatform = "meituan" | "dianping";

export function getReviewWebUrl(platform: ReviewPlatform, customWebUrl?: string) {
  if (!customWebUrl?.trim()) throw new Error(`商家尚未配置${platform === "meituan" ? "美团" : "大众点评"}门店链接`);
  const url = new URL(customWebUrl);
  const domains = platform === "meituan" ? ["meituan.com", "dpurl.cn"] : ["dianping.com", "dpurl.cn"];
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error("门店链接无效，请联系商家核对");
  }
  return url.href;
}

export async function openReviewAppFirst(platform: ReviewPlatform, customWebUrl?: string) {
  const webUrl = getReviewWebUrl(platform, customWebUrl);
  window.location.href = webUrl;
  return { openedApp: false, fallback: webUrl };
}

// Kept for the isolated mini-program demo. Never used by the production H5 flow.
export class MockPublisher implements Publisher {
  async publish(_payload: PublishPayload): Promise<PublishResult> {
    return { success: true, mode: "mock", message: "模拟发布完成" };
  }
}
