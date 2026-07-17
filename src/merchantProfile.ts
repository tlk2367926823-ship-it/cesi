import { apiUrl } from "./api";
import type { MerchantProfile } from "./types";

const MERCHANT_CONFIG_ENDPOINT = "/.netlify/functions/merchant-config";

export const defaultMerchantProfile: MerchantProfile = {
  id: "a90fd384-a296-4a95-98dd-b3e79fc36d93",
  name: "汇职驾校",
  industry: "驾校培训",
  contactName: "",
  contactPhone: "",
  address: "深圳",
  description: "深圳本地驾校培训服务，适合准备报名学车、想了解练车安排和教练服务的用户。",
  sellingPoints: ["本地训练场", "教练讲解细", "流程清楚", "适合新手", "练车安排透明"],
  xiaohongshuUrl: "",
  meituanUrl: "http://dpurl.cn/KgRUKrtz",
  dianpingUrl:
    "https://m.dianping.com/shopshare/k394wSQFIF53x0Ng?msource=Appshare2021&utm_source=shop_share&shoptype=&shopcategoryid=&isoversea=&shareid=s1Uu9Rgjqw_1783613632",
  imageUrls: [
    "/mock-assets/huizhi-car-yard-01.jpg",
    "/mock-assets/huizhi-training-base-02.jpg",
    "/mock-assets/huizhi-practice-car-03.jpg",
    "/mock-assets/huizhi-driving-closeup-04.jpg",
    "/mock-assets/huizhi-coach-guidance-05.jpg",
  ],
  serviceKeywords: ["杨杨教练", "沈教练", "科学培训体系", "细节控专属体验", "收费明明白白", "小班教学", "拿证快", "省心"],
  featureKeywords: ["教练特别热情", "宽敞练车场", "舒适休息区", "口碑看得见", "配套齐全", "本地贴心服务", "一人一车", "不吵人不骂人"],
  lengthOptions: ["简短自然", "详细一点", "种草感强"],
  promptProfile: "用真实学员体验的口吻，突出练车安排、教练沟通、训练场和报名咨询，不要夸大承诺。",
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

export function mergeMerchantProfile(profile?: Partial<MerchantProfile> | null): MerchantProfile {
  if (!profile) return defaultMerchantProfile;

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
    sellingPoints: sellingPoints.length > 0 ? sellingPoints : defaultMerchantProfile.sellingPoints,
    imageUrls: imageUrls.length > 0 ? imageUrls : defaultMerchantProfile.imageUrls,
    serviceKeywords: serviceKeywords.length > 0 ? serviceKeywords : defaultMerchantProfile.serviceKeywords,
    featureKeywords: featureKeywords.length > 0 ? featureKeywords : defaultMerchantProfile.featureKeywords,
    lengthOptions: lengthOptions.length > 0 ? lengthOptions : defaultMerchantProfile.lengthOptions,
  };
}

export async function fetchMerchantProfile(params: { merchantId: string; merchantName?: string }): Promise<MerchantProfile> {
  const search = new URLSearchParams();
  if (params.merchantId) search.set("merchantId", params.merchantId);
  if (params.merchantName) search.set("merchantName", params.merchantName);

  try {
    const response = await fetch(apiUrl(`${MERCHANT_CONFIG_ENDPOINT}?${search.toString()}`), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("merchant profile unavailable");
    const result = (await response.json()) as { ok?: boolean; profile?: Partial<MerchantProfile> };
    if (!result.ok || !result.profile) throw new Error("merchant profile missing");
    return mergeMerchantProfile(result.profile);
  } catch {
    return mergeMerchantProfile({
      id: params.merchantId || defaultMerchantProfile.id,
      name: params.merchantName || defaultMerchantProfile.name,
    });
  }
}

export async function saveMerchantProfile(profile: MerchantProfile, accessToken: string): Promise<MerchantProfile> {
  const response = await fetch(apiUrl(MERCHANT_CONFIG_ENDPOINT), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(profile),
  });

  const result = (await response.json()) as { ok?: boolean; message?: string; profile?: Partial<MerchantProfile> };
  if (!response.ok || !result.ok || !result.profile) {
    throw new Error(result.message || "保存商家资料失败");
  }

  return mergeMerchantProfile(result.profile);
}
