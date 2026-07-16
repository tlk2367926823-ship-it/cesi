import type { KeywordSelection, MerchantProfile, ShareDraft, SharePlatform } from "./types";

const API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const FALLBACK_INDEX_KEY = "huizhi_fallback_draft_index";
const DRAFT_HISTORY_KEY = "huizhi_recent_drafts";
const HISTORY_LIMIT = 8;

function pickFallbackPoints(profile: MerchantProfile, preferences?: KeywordSelection) {
  const selected = [...(preferences?.services || []), ...(preferences?.features || [])].filter(Boolean);
  if (selected.length > 0) return selected;
  if (profile.sellingPoints.length > 0) return profile.sellingPoints;
  return ["体验自然", "服务清楚", "适合本地用户"];
}

function buildFallbackDraft(profile: MerchantProfile, platform: SharePlatform, index: number, preferences?: KeywordSelection): ShareDraft {
  const points = pickFallbackPoints(profile, preferences);
  const pointA = points[index % points.length];
  const pointB = points[(index + 1) % points.length] || pointA;
  const industryName = profile.industry || "本地生活";
  const location = profile.address || "附近";
  const brandName = profile.name || "这家店";
  const shortName = brandName.slice(0, 8);

  const titleTemplates = [
    `${shortName}体验挺真实`,
    `${industryName}可以先看看这家`,
    `${location}附近这家挺省心`,
    `这次体验比想象顺`,
    `${pointA}这一点加分`,
  ];

  const redbookBodies = [
    `今天来${brandName}体验了一下，整体感觉比想象中轻松。\n\n比较喜欢的是${pointA}，不会让人觉得流程很乱。${pointB}也挺明显，现场感受会更安心一点。\n\n如果你也在${location}附近了解${industryName}，可以先收藏起来，实地看看适不适合自己。`,
    `之前一直想找一家靠谱一点的${industryName}，这次来${brandName}之后，感觉细节还是挺清楚的。\n\n${pointA}给我的印象比较深，${pointB}也不是那种只写在介绍里的感觉，现场能感受到。\n\n给正在对比的人一个参考，先了解再决定会更稳。`,
    `这次体验没有那种很强的推销感，整体比较自然。\n\n${brandName}让我觉得比较舒服的地方是${pointA}，还有${pointB}，对第一次了解的人会友好一些。\n\n如果刚好在${location}，可以把这家放进备选清单里。`,
  ];

  const reviewBodies = [
    `到${brandName}体验了一次，整体流程比较清楚。\n\n现场比较能感受到${pointA}，另外${pointB}也做得比较到位。对于正在对比同类门店的人来说，信息比较直观。\n\n整体体验偏踏实，适合想先了解实际情况的人参考。`,
    `${brandName}这次体验下来，给人的感觉是安排比较清楚，不会一上来就让人很有压力。\n\n${pointA}这一点比较明显，${pointB}也能看出门店有在认真做服务。\n\n如果在${location}附近，可以实地看一下再做决定。`,
    `这家店整体体验比较真实，没有夸张的感觉。\n\n我比较关注${pointA}和${pointB}，这两点现场感受都还不错。对正在了解${industryName}的人来说，参考价值比较高。\n\n整体来说，是一次比较顺的体验。`,
  ];

  let body = (platform === "redbook" ? redbookBodies : reviewBodies)[index % 3];
  if (preferences?.length.includes("简短")) {
    body = body.split("\n\n").slice(0, 2).join("\n\n");
  } else if (preferences?.length.includes("种草")) {
    body = `${body}\n\n比较适合先收藏起来，等需要的时候再认真对比一下。`;
  }

  return {
    title: titleTemplates[index % titleTemplates.length],
    body,
    tags: [industryName, `${location}本地`, pointA, pointB, "真实体验", "本地生活"].filter(Boolean).slice(0, 8),
    materialType: "image",
    style: "real_experience",
    cta: "可以先了解一下",
  };
}

function getRecentDrafts(): Array<Pick<ShareDraft, "title" | "body">> {
  try {
    const raw = window.localStorage.getItem(DRAFT_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberDraft(draft: ShareDraft) {
  const history = getRecentDrafts();
  const nextHistory = [
    { title: draft.title, body: draft.body },
    ...history.filter((item) => item.title !== draft.title && item.body !== draft.body),
  ].slice(0, HISTORY_LIMIT);
  window.localStorage.setItem(DRAFT_HISTORY_KEY, JSON.stringify(nextHistory));
}

function getNextFallbackDraft(profile: MerchantProfile, platform: SharePlatform, preferences?: KeywordSelection): ShareDraft {
  const current = Number(window.localStorage.getItem(FALLBACK_INDEX_KEY) || "0");
  const next = current + 1;
  window.localStorage.setItem(FALLBACK_INDEX_KEY, String(next));
  return buildFallbackDraft(profile, platform, current, preferences);
}

function isDuplicateDraft(draft: ShareDraft) {
  return getRecentDrafts().some((item) => item.title === draft.title || item.body === draft.body);
}

function getPlatformPrompt(platform: SharePlatform) {
  if (platform === "meituan") {
    return {
      name: "美团",
      audience: "正在搜索门店、对比服务、价格、距离和评价的本地用户",
      tone: "像真实消费评价，具体、克制、可信，不要种草口吻，不要出现发布平台名称",
      tags: "生成 4-6 个偏门店评价、服务体验、本地搜索的标签",
    };
  }

  if (platform === "dianping") {
    return {
      name: "大众点评",
      audience: "正在看探店评价、关注环境服务细节、想做消费决策的本地用户",
      tone: "像真实探店体验点评，重点写环境、服务、流程、细节感，不要出现发布平台名称",
      tags: "生成 4-6 个偏探店评价、本地生活、服务体验的标签",
    };
  }

  return {
    name: "小红书",
    audience: "正在刷本地生活经验、想看真实分享和避坑建议的年轻用户",
    tone: "像真实个人分享，轻松、有画面感，可以有收藏参考口吻，但不要硬广",
    tags: "生成 5-8 个小红书标签，不要包含 # 符号",
  };
}

function getPreferencePrompt(preferences?: KeywordSelection) {
  if (!preferences) return "用户未选择额外关键词，请根据商家资料自然发挥。";

  return `用户本次选择：
产品/服务：${preferences.services.length > 0 ? preferences.services.join("、") : "未选择"}
特色/宣传点：${preferences.features.length > 0 ? preferences.features.join("、") : "未选择"}
文案长度：${preferences.length || "自然中等"}`;
}

function getPrompt(params: {
  source: string;
  campaign: string;
  platform: SharePlatform;
  profile: MerchantProfile;
  preferences?: KeywordSelection;
}): string {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const platformPrompt = getPlatformPrompt(params.platform);
  const profile = params.profile;
  const recentDrafts = getRecentDrafts()
    .map((item, index) => `${index + 1}. 标题：${item.title}\n正文开头：${item.body.slice(0, 80)}`)
    .join("\n\n");

  return `你是本地生活内容运营专家。请为一个线下商家生成用户可直接发布的${platformPrompt.name}文案。

商家名称：${profile.name}
行业类型：${profile.industry || "本地生活"}
门店地址/城市：${profile.address || "未填写"}
商家介绍：${profile.description || "未填写"}
核心卖点：${profile.sellingPoints.join("、") || "服务真实、体验自然"}
商家补充要求：${profile.promptProfile || "无"}
活动来源：${params.source || "扫码或 NFC 进入"}
活动名称：${params.campaign || "分享打卡活动"}
发布平台：${platformPrompt.name}
目标受众：${platformPrompt.audience}
语气要求：${platformPrompt.tone}

顾客选择偏好：
${getPreferencePrompt(params.preferences)}

最近已经生成过的内容：
${recentDrafts || "暂无"}

生成批次：${seed}

要求：
1. 标题不超过 20 个中文字符。
2. 正文像真实用户分享，不要像硬广告。
3. 必须围绕当前商家资料和用户选择的关键词生成，不能出现其他商家或其他行业。
4. 正文分段清晰，适合移动端阅读。
5. 避开最近已经生成过的内容，标题、开头、表达角度都不要重复。
6. 每次生成都换一个角度，可以从环境、服务、流程、细节、性价比、体验感、适合人群中任选。
7. ${platformPrompt.tags}。
8. materialType 只能是 image 或 video，优先 image。
9. style 只能是 real_experience、promotion、student_story、exam_tips 之一。
10. 不要使用夸大承诺，不要使用“最”“第一”“保证”“百分百”等绝对化表达。
11. 正文里不要出现“发布到小红书/美团/大众点评”“门店评价区”“平台”等暴露发布渠道的话。
12. 返回严格 JSON，不要输出 Markdown，不要解释。

JSON 格式：
{
  "title": "20字以内标题",
  "body": "适合用户直接发布的正文",
  "tags": ["本地生活", "真实体验"],
  "materialType": "image",
  "style": "real_experience",
  "cta": "可以先了解一下"
}`;
}

function stripCodeFence(content: string): string {
  return content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
}

function normalizeDraft(raw: Partial<ShareDraft>, fallbackDraft: ShareDraft): ShareDraft {
  return {
    title: String(raw.title || fallbackDraft.title).slice(0, 20),
    body: String(raw.body || fallbackDraft.body),
    tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags.map(String).slice(0, 8) : fallbackDraft.tags,
    materialType: raw.materialType === "video" ? "video" : "image",
    style:
      raw.style === "promotion" || raw.style === "student_story" || raw.style === "exam_tips"
        ? raw.style
        : fallbackDraft.style,
    cta: String(raw.cta || fallbackDraft.cta),
  };
}

async function requestQwenDraft(
  params: { source: string; campaign: string; platform: SharePlatform; profile: MerchantProfile; preferences?: KeywordSelection },
  apiKey: string,
  model: string,
) {
  const fallbackDraft = buildFallbackDraft(params.profile, params.platform, 0, params.preferences);
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "你只输出可解析的 JSON。内容必须自然、真实、合规，并且每次表达都要有明显变化。",
        },
        {
          role: "user",
          content: getPrompt(params),
        },
      ],
      temperature: 1,
      presence_penalty: 0.9,
      frequency_penalty: 0.4,
    }),
  });

  if (!response.ok) {
    throw new Error(`通义千问请求失败：${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("通义千问返回内容为空");
  }

  return normalizeDraft(JSON.parse(stripCodeFence(content)), fallbackDraft);
}

export async function generateShareDraft(params: {
  source: string;
  campaign: string;
  platform: SharePlatform;
  profile: MerchantProfile;
  preferences?: KeywordSelection;
}): Promise<ShareDraft> {
  const apiKey = import.meta.env.VITE_DASHSCOPE_API_KEY;
  const model = import.meta.env.VITE_DASHSCOPE_MODEL || "qwen-plus";

  if (!apiKey) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    const fallbackDraft = getNextFallbackDraft(params.profile, params.platform, params.preferences);
    rememberDraft(fallbackDraft);
    return fallbackDraft;
  }

  let generated = await requestQwenDraft(params, apiKey, model);
  if (isDuplicateDraft(generated)) {
    generated = await requestQwenDraft(params, apiKey, model);
  }

  rememberDraft(generated);
  return generated;
}
