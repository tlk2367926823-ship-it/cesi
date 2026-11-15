import type { ShareDraft } from "../types";

const FALLBACK_INDEX_KEY = "huizhi_fallback_draft_index";

const editableDrafts: ShareDraft[] = [
  {
    title: "我的练车记录",
    body: "这次练车主要练习了【请填写实际练习内容】。\n\n我对教练讲解、场地安排和练习节奏的真实感受是：【请根据本人经历补充】。\n\n这是一份 AI 辅助整理的草稿，发布前我会删除提示文字，并只保留本人确认过的真实内容。",
    tags: ["深圳学车", "练车记录", "学车日常"],
    materialType: "image",
    style: "real_experience",
    cta: "",
  },
  {
    title: "今天的学车小结",
    body: "今天想记录一下【请填写日期或练习项目】。\n\n练习过程中让我印象比较深的是：【请填写真实细节】。还有哪些地方需要继续练习：【请填写本人计划】。\n\n内容由 AI 辅助整理，请在发布前按实际情况完成修改。",
    tags: ["学车记录", "练车日常", "深圳生活"],
    materialType: "image",
    style: "student_story",
    cta: "",
  },
  {
    title: "新手练车复盘",
    body: "本次练习内容：【请填写真实项目】。\n\n我已经掌握的部分：【请填写】。接下来需要继续注意的部分：【请填写】。\n\n这是一份待核对的 AI 辅助草稿，不包含通过率、拿证时间或其他效果承诺。",
    tags: ["新手学车", "练车复盘", "驾考记录"],
    materialType: "image",
    style: "exam_tips",
    cta: "",
  },
];

function getNextEditableDraft(): ShareDraft {
  const current = Number(uni.getStorageSync(FALLBACK_INDEX_KEY) || "0");
  uni.setStorageSync(FALLBACK_INDEX_KEY, String(current + 1));
  const selected = editableDrafts[current % editableDrafts.length];
  return { ...selected, tags: [...selected.tags] };
}

export async function generateShareDraft(_params: { source: string; campaign: string }): Promise<ShareDraft> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  return getNextEditableDraft();
}
