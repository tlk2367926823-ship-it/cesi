export type AppStep = "intro" | "generating" | "result" | "publish";

export type MaterialKind = "image" | "video";

export type SharePlatform = "redbook" | "meituan" | "dianping";

export interface ShareDraft {
  title: string;
  body: string;
  tags: string[];
  materialType: MaterialKind;
  style: "real_experience" | "promotion" | "student_story" | "exam_tips";
  cta: string;
}

export interface MockAsset {
  id: string;
  type: MaterialKind;
  title: string;
  keywords: string[];
  url: string;
  tone: string;
}

export interface MerchantProfile {
  id: string;
  name: string;
  industry: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
  description?: string;
  sellingPoints: string[];
  xiaohongshuUrl?: string;
  meituanUrl?: string;
  dianpingUrl?: string;
  imageUrls: string[];
  promptProfile?: string;
}

export interface PublishPayload {
  title: string;
  body: string;
  tags: string[];
  assets: string[];
}

export interface PublishResult {
  success: boolean;
  mode: "mock" | "copy" | "deeplink" | "native-share" | "api";
  message?: string;
}

export interface Publisher {
  publish(payload: PublishPayload): Promise<PublishResult>;
}
