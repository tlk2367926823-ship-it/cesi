import type { MerchantProfile, ShareDraft, SharePlatform } from "./types";

const API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const FALLBACK_INDEX_KEY = "huizhi_fallback_draft_index";
const DRAFT_HISTORY_KEY = "huizhi_recent_drafts";
const HISTORY_LIMIT = 8;

function buildFallbackDraft(profile: MerchantProfile, platform: SharePlatform, index: number): ShareDraft {
  const points = profile.sellingPoints.length > 0 ? profile.sellingPoints : ["体验不错", "服务清楚", "适合本地用户"];
  const pointA = points[index % points.length];
  const pointB = points[(index + 1) % points.length] || pointA;
  const industryName = profile.industry || "本地生活";
  const location = profile.address || "深圳";

  const platformTone =
    platform === "redbook"
      ? "这次体验下来，最明显的是整体感觉比较自然，不会让人有压力。"
      : platform === "meituan"
        ? "整体体验比较直接，服务细节和现场安排都能看得出来。"
        : "现场感受比预期更踏实，适合正在对比同类门店的人参考。";

  return {
    title: `${profile.name.slice(0, 8)}体验不错`,
    body: `今天到${profile.name}体验了一下，整体感受挺真实。\n\n${platformTone}${pointA}这一点比较加分，${pointB}也让人觉得比较省心。\n\n如果你也在${location}附近了解${industryName}，可以先收藏起来，实地看看适不适合自己。`,
    tags: [profile.name, industryName, `${location}本地`, pointA, pointB, "真实体验"].filter(Boolean).slice(0, 8),
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

function getNextFallbackDraft(profile: MerchantProfile, platform: SharePlatform): ShareDraft {
  const current = Number(window.localStorage.getItem(FALLBACK_INDEX_KEY) || "0");
  const next = current + 1;
  window.localStorage.setItem(FALLBACK_INDEX_KEY, String(next));
  return buildFallbackDraft(profile, platform, current);
}

function isDuplicateDraft(draft: ShareDraft) {
  return getRecentDrafts().some((item) => item.title === draft.title || item.body === draft.body);
}

function getPlatformPrompt(platform: SharePlatform) {
  if (platform === "meituan") {
    return {
      name: "美团",
      audience: "正在搜索门店、对比服务、价格、距离和评价的本地用户",
      tone: "像真实消费评价，具体、克制、可信，不要种草口吻，不要出现发布平台说明",
      tags: "生成 4-6 个偏门店评价、服务体验、本地搜索的标签",
    };
  }

  if (platform === "dianping") {
    return {
      name: "大众点评",
      audience: "正在看探店评价、关注环境服务细节、想做消费决策的本地用户",
      tone: "像真实探店体验点评，重点写环境、服务、流程、细节感，不要出现发布平台说明",
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

function getPrompt(params: {
  source: string;
  campaign: string;
  platform: SharePlatform;
  profile: MerchantProfile;
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
生成批次：${seed}

最近已经生成过的内容：
${recentDrafts || "暂无"}

要求：
1. 标题不超过 20 个中文字符。
2. 正文像真实用户分享，不要像硬广。
3. 必须围绕当前商家资料生成，不能出现其他商家、其他行业、汇职驾校、练车等无关内容，除非当前商家资料就是驾校。
4. 正文分段清晰，适合移动端阅读。
5. 避开最近已经生成过的内容，标题、开头、表达角度都不能重复。
6. 每次生成都换一个角度，可从环境、服务、流程、细节、性价比、体验感、适合人群中任选。
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
  params: { source: string; campaign: string; platform: SharePlatform; profile: MerchantProfile },
  apiKey: string,
  model: string,
) {
  const fallbackDraft = buildFallbackDraft(params.profile, params.platform, 0);
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
}): Promise<ShareDraft> {
  const apiKey = import.meta.env.VITE_DASHSCOPE_API_KEY;
  const model = import.meta.env.VITE_DASHSCOPE_MODEL || "qwen-plus";

  if (!apiKey) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    const fallbackDraft = getNextFallbackDraft(params.profile, params.platform);
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
