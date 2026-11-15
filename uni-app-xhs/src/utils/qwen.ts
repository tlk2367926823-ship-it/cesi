import type { ShareDraft } from "../types";

export async function generateShareDraft(
  _params: { source: string; campaign: string },
): Promise<ShareDraft> {
  await new Promise((resolve) => setTimeout(resolve, 350));

  return {
    title: "",
    body: "",
    tags: ["深圳学车", "练车记录", "学车日常"],
    materialType: "image",
    style: "real_experience",
    cta: "",
  };
}
