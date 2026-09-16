import { apiUrl } from "./api";
import type { MerchantProfile } from "./types";

const MERCHANT_CONFIG_ENDPOINT = "/.netlify/functions/merchant-config";

export const defaultMerchantProfile: MerchantProfile = {
  id: "",
  name: "本地商家",
  industry: "本地生活",
  contactName: "",
  contactPhone: "",
  address: "",
  description: "适合顾客分享真实体验、服务感受和到店印象的本地商家。",
  sellingPoints: ["真实体验", "服务细致", "环境舒适", "流程清楚", "适合朋友参考"],
  xiaohongshuUrl: "",
  meituanUrl: "",
  dianpingUrl: "",
  imageUrls: [],
  serviceKeywords: ["真实体验", "服务项目", "到店体验", "适合分享", "方便省心", "值得参考"],
  featureKeywords: ["服务贴心", "环境不错", "流程清楚", "体验真实", "口碑不错", "推荐朋友"],
  lengthOptions: ["简短自然", "详细一点", "种草感强"],
  promptProfile:
    "用真实顾客体验的口吻写，重点描述服务过程、环境感受、体验细节和适合的人群。不要夸大承诺，不要编造没有提供的设施、价格、优惠、人员姓名或效果。",
};

function normalizeList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function buildFallbacks(profile?: Partial<MerchantProfile> | null) {
  const name = String(profile?.name || defaultMerchantProfile.name).trim();
  const industry = String(profile?.industry || defaultMerchantProfile.industry).trim();

  return {
    sellingPoints: [`${industry}真实体验`, "服务过程清楚", "环境感受真实", "适合朋友参考", "到店体验自然"],
    serviceKeywords: [name, industry, "真实体验", "服务项目", "到店体验", "适合分享", "方便省心"],
    featureKeywords: ["服务贴心", "环境舒适", "流程清楚", "体验真实", "口碑不错", "推荐朋友"],
    promptProfile: `围绕${name}的${industry}服务来写，用真实顾客体验口吻表达。只使用商家资料里提供的信息，不要编造设施、价格、优惠、人员姓名或效果承诺。`,
  };
}

export function mergeMerchantProfile(profile?: Partial<MerchantProfile> | null): MerchantProfile {
  if (!profile) return defaultMerchantProfile;

  const fallback = buildFallbacks(profile);
  const imageUrls = normalizeList(profile.imageUrls);
  const sellingPoints = normalizeList(profile.sellingPoints);
  const serviceKeywords = normalizeList(profile.serviceKeywords);
  const featureKeywords = normalizeList(profile.featureKeywords);
  const lengthOptions = normalizeList(profile.lengthOptions);

  return {
    ...defaultMerchantProfile,
    ...profile,
    id: profile.id || defaultMerchantProfile.id,
    name: profile.name || defaultMerchantProfile.name,
    industry: profile.industry || defaultMerchantProfile.industry,
    description: profile.description || defaultMerchantProfile.description,
    sellingPoints: sellingPoints.length > 0 ? sellingPoints : fallback.sellingPoints,
    imageUrls,
    serviceKeywords: serviceKeywords.length > 0 ? serviceKeywords : fallback.serviceKeywords,
    featureKeywords: featureKeywords.length > 0 ? featureKeywords : fallback.featureKeywords,
    lengthOptions: lengthOptions.length > 0 ? lengthOptions : defaultMerchantProfile.lengthOptions,
    promptProfile: profile.promptProfile || fallback.promptProfile,
  };
}

function mergeEditableProfile(profile: Partial<MerchantProfile>): MerchantProfile {
  return {
    ...mergeMerchantProfile(profile),
    contactName: profile.contactName || "",
    contactPhone: profile.contactPhone || "",
    description: profile.description || "",
    sellingPoints: normalizeList(profile.sellingPoints),
    serviceKeywords: normalizeList(profile.serviceKeywords),
    featureKeywords: normalizeList(profile.featureKeywords),
    lengthOptions: normalizeList(profile.lengthOptions),
    promptProfile: profile.promptProfile || "",
  };
}

export class MerchantProfileError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "unavailable" | "invalid-response",
  ) {
    super(message);
    this.name = "MerchantProfileError";
  }
}

export async function fetchMerchantProfile(params: {
  merchantId: string;
  merchantName?: string;
  signal?: AbortSignal;
  accessToken?: string;
}): Promise<MerchantProfile> {
  const search = new URLSearchParams();
  if (params.merchantId) search.set("merchantId", params.merchantId);
  if (params.merchantName) search.set("merchantName", params.merchantName);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (params.signal?.aborted) controller.abort();
  params.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);

  try {
    const response = await fetch(apiUrl(`${MERCHANT_CONFIG_ENDPOINT}?${search.toString()}`), {
      headers: {
        accept: "application/json",
        ...(params.accessToken ? { authorization: `Bearer ${params.accessToken}` } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new MerchantProfileError("未找到这个商家，或商家已停用。请核对商家链接。", "not-found");
    }
    if (response.status === 401) throw new MerchantProfileError("登录状态已失效，请重新登录后读取商家资料。", "unavailable");
    if (response.status === 403) throw new MerchantProfileError("当前账号没有权限读取这个商家的完整资料。", "unavailable");
    if (!response.ok) throw new MerchantProfileError("商家资料读取失败，请稍后重试。", "unavailable");
    const result = (await response.json()) as { ok?: boolean; visibility?: string; profile?: Partial<MerchantProfile> };
    if (
      !result.ok ||
      !result.profile ||
      !result.profile.id ||
      (params.accessToken && result.visibility !== "private") ||
      (params.accessToken && !["contactName", "contactPhone", "promptProfile"]
        .every((field) => typeof result.profile?.[field as keyof MerchantProfile] === "string")) ||
      (params.merchantId && result.profile.id !== params.merchantId)
    ) {
      throw new MerchantProfileError("商家资料返回异常，请重新读取后再操作。", "invalid-response");
    }
    return params.accessToken ? mergeEditableProfile(result.profile) : mergeMerchantProfile(result.profile);
  } catch (error) {
    if (params.signal?.aborted) throw error;
    if (error instanceof MerchantProfileError) throw error;
    throw new MerchantProfileError(
      controller.signal.aborted ? "商家资料读取超时，请重试。" : "商家资料暂时无法读取，请检查网络后重试。",
      "unavailable",
    );
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", abort);
  }
}

export async function saveMerchantProfile(profile: MerchantProfile, accessToken: string): Promise<MerchantProfile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl(MERCHANT_CONFIG_ENDPOINT), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(profile),
      signal: controller.signal,
    });

    const result = (await response.json()) as { ok?: boolean; message?: string; profile?: Partial<MerchantProfile> };
    if (!response.ok || !result.ok || !result.profile || result.profile.id !== profile.id) {
      throw new Error(result.message || "未能确认商家资料保存结果，请重新读取资料核对。");
    }

    return mergeEditableProfile(result.profile);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("保存请求超时，结果尚未确认。请重新读取商家资料核对后再操作。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
