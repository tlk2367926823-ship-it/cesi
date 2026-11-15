export const activityConfig = {
  brandName: "深圳汇职驾校",
  activityName: "学车记录整理",
  heroTitle: "整理你的真实学车记录",
  heroDescription:
    "系统会准备真实记录表单和现场素材。请根据本人真实经历填写、核对，再自主决定是否发布。",
  steps: ["进入真实记录表单", "填写本人学车体验", "确认图片和文案", "进入官方发布流程"],
  rules: [
    "内容可由 AI 辅助整理，不代表平台或商家的最终表述",
    "只填写本人真实经历，不使用虚假、夸大或承诺性内容",
    "发布完全自愿，最终内容和发布操作均由用户本人确认",
  ],
};

export function getSourceLabel(source: string) {
  if (source === "qrcode") return "扫码进入";
  if (source === "nfc") return "NFC碰一碰";
  return "内容入口";
}
