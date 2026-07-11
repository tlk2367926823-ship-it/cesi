export const activityConfig = {
  brandName: "商家分享打卡",
  demoBrandName: "深圳汇职驾校",
  activityName: "AI 分享打卡工具",
  heroTitle: "扫码进入，快速生成分享内容",
  heroDescription:
    "适用于本地生活、培训、餐饮、美业等商家。用户选择平台后，系统会自动准备文案和图片，再引导用户到对应平台完成发布。当前案例使用深圳汇职驾校素材演示。",
  steps: ["选择发布平台", "生成文案和配图", "一键保存素材", "前往平台发布"],
};

export function getSourceLabel(source: string) {
  if (source === "qrcode") return "扫码进入";
  if (source === "nfc") return "NFC碰一碰";
  return "活动入口";
}
