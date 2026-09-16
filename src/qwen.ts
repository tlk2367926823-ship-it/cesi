import { apiUrl } from "./api";
import type { KeywordSelection, MerchantProfile, ShareDraft, SharePlatform } from "./types";

const DRAFT_ENDPOINT = "/.netlify/functions/generate-draft";
const VARIANT_KEY = "taotian_draft_variant";
const REQUEST_TIMEOUT_MS = 25_000;
const STYLES = new Set(["real_experience", "promotion", "student_story", "exam_tips"]);

export interface GeneratedShareDraft extends ShareDraft {
  generationSource: "ai" | "template";
  generationNotice: string;
}

function nextVariant(profile: MerchantProfile, platform: SharePlatform) {
  const key = `${VARIANT_KEY}:${profile.id}:${platform}`;
  try {
    const stored = Number(window.localStorage.getItem(key));
    const current = Number.isSafeInteger(stored) && stored >= 0 ? stored % 1000 : 0;
    window.localStorage.setItem(key, String((current + 1) % 1000));
    return current;
  } catch {
    return Math.floor(Math.random() * 1000);
  }
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= maxLength;
}

function parseDraft(value: unknown): GeneratedShareDraft {
  if (!value || typeof value !== "object") throw new Error("文案服务返回格式异常，请重试");
  const draft = value as Record<string, unknown>;
  if (
    !boundedText(draft.title, 20) ||
    !boundedText(draft.body, 1000) ||
    !Array.isArray(draft.tags) ||
    draft.tags.length > 8 ||
    !draft.tags.every((tag) => boundedText(tag, 40)) ||
    !["image", "video"].includes(String(draft.materialType)) ||
    !STYLES.has(String(draft.style)) ||
    !boundedText(draft.cta, 80) ||
    !["ai", "template"].includes(String(draft.generationSource)) ||
    !boundedText(draft.generationNotice, 160)
  ) {
    throw new Error("文案服务返回格式异常，请重试");
  }
  return {
    title: draft.title,
    body: draft.body,
    tags: draft.tags as string[],
    materialType: draft.materialType as ShareDraft["materialType"],
    style: draft.style as ShareDraft["style"],
    cta: draft.cta,
    generationSource: draft.generationSource as GeneratedShareDraft["generationSource"],
    generationNotice: draft.generationNotice,
  };
}

export async function generateShareDraft(params: {
  source: string;
  campaign: string;
  platform: SharePlatform;
  profile: MerchantProfile;
  preferences?: KeywordSelection;
  signal?: AbortSignal;
}): Promise<GeneratedShareDraft> {
  if (params.signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  params.signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(DRAFT_ENDPOINT), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        merchantId: params.profile.id,
        platform: params.platform,
        preferences: params.preferences,
        variant: nextVariant(params.profile, params.platform),
      }),
    });
    if (response.status === 429) throw new Error("生成次数已达到限制，请稍后再试");
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("文案服务暂时不可用，请稍后重试");
    }
    const text = await response.text();
    if (text.length > 20_000) throw new Error("文案服务返回内容异常，请重试");
    let result: { ok?: boolean; message?: unknown; draft?: unknown };
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("文案服务返回格式异常，请重试");
    }
    if (!result || typeof result !== "object" || !response.ok || result.ok !== true) {
      throw new Error(
        boundedText(result?.message, 160) ? result.message : "文案生成失败，请稍后重试",
      );
    }
    return parseDraft(result.draft);
  } catch (error) {
    if (params.signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
    if (timedOut) throw new Error("文案生成超时，请稍后重试");
    if (error instanceof TypeError) throw new Error("无法连接文案服务，请检查网络后重试");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    params.signal?.removeEventListener("abort", cancel);
  }
}
