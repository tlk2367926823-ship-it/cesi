import type { MerchantProfile, MockAsset, ShareDraft } from "./types";

export const mockAssets: MockAsset[] = [
  {
    id: "huizhi-car-yard-01",
    type: "image",
    title: "训练场教练车实拍",
    keywords: ["练车", "训练场", "教练车", "深圳驾校", "汇职驾校"],
    url: "/mock-assets/huizhi-car-yard-01.jpg",
    tone: "真实、场地感强",
  },
  {
    id: "huizhi-training-base-02",
    type: "image",
    title: "驾驶技能实训基地",
    keywords: ["训练场", "基地", "场地", "练车", "深圳学车"],
    url: "/mock-assets/huizhi-training-base-02.jpg",
    tone: "专业、可信赖",
  },
  {
    id: "huizhi-practice-car-03",
    type: "image",
    title: "教练车练习场景",
    keywords: ["教练车", "练车", "新手", "训练场", "科目二"],
    url: "/mock-assets/huizhi-practice-car-03.jpg",
    tone: "清晰、有练车氛围",
  },
  {
    id: "huizhi-driving-closeup-04",
    type: "image",
    title: "学员上车练习近景",
    keywords: ["学员", "上车", "新手", "体验", "教练"],
    url: "/mock-assets/huizhi-driving-closeup-04.jpg",
    tone: "真实、像学员分享",
  },
  {
    id: "huizhi-coach-guidance-05",
    type: "image",
    title: "教练现场指导练车",
    keywords: ["教练", "指导", "陪练", "练车", "服务"],
    url: "/mock-assets/huizhi-coach-guidance-05.jpg",
    tone: "服务感、陪伴感",
  },
];

const placeholderAsset: MockAsset = {
  id: "merchant-assets-empty",
  type: "image",
  title: "请先上传商家素材",
  keywords: ["商家素材", "待上传", "真实图片"],
  url: "/mock-assets/generic-merchant-share.svg",
  tone: "素材待上传",
};

function isHuizhiDemoProfile(profile?: MerchantProfile) {
  const key = `${profile?.id || ""} ${profile?.name || ""} ${profile?.description || ""}`.toLowerCase();
  return key.includes("huizhi") || key.includes("汇职");
}

export function getMerchantAssets(profile?: MerchantProfile): MockAsset[] {
  if (!profile) return [placeholderAsset];

  const uploadedUrls = (profile.imageUrls || []).map((url) => url.trim()).filter(Boolean);
  if (uploadedUrls.length > 0) {
    const keywords = [
      profile.name,
      profile.industry,
      ...profile.sellingPoints,
      ...profile.serviceKeywords,
      ...profile.featureKeywords,
    ].filter(Boolean);

    return uploadedUrls.map((url, index) => ({
      id: `${profile.id || "merchant"}-asset-${index + 1}`,
      type: "image",
      title: index === 0 ? `${profile.name}素材图` : `${profile.name}素材图${index + 1}`,
      keywords,
      url,
      tone: "商家真实素材",
    }));
  }

  return isHuizhiDemoProfile(profile) ? mockAssets : [placeholderAsset];
}

export function selectAsset(draft: ShareDraft, cursor = 0, profile?: MerchantProfile): MockAsset {
  const assets = getMerchantAssets(profile);
  if (assets.length === 0) return placeholderAsset;

  const text = `${draft.title} ${draft.body} ${draft.tags.join(" ")}`;
  const candidates = assets
    .filter((asset) => asset.type === draft.materialType || draft.materialType === "image")
    .map((asset, index) => ({
      asset,
      index,
      score: asset.keywords.reduce((sum, keyword) => sum + (keyword && text.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const ranked = candidates.length > 0 ? candidates : assets.map((asset, index) => ({ asset, index, score: 0 }));
  const usefulCount = ranked[0]?.score ? Math.min(ranked.length, 3) : ranked.length;
  return ranked[cursor % usefulCount].asset;
}
