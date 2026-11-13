import { createClient } from "@supabase/supabase-js";

const DEFAULT_APP_ID = "6a4c8abbdb457600012f5b25";
const DEFAULT_PAGE_PATH = "pages/index/index";
const MAX_BODY_BYTES = 24 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_SOURCES = new Set(["nfc", "qrcode", "qr", "direct", "unknown"]);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("handoff_config");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new RequestError(415, "请使用JSON格式提交草稿");
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new RequestError(413, "草稿内容过大");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "缺少草稿内容");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "草稿内容过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new RequestError(400, "草稿格式无效");
  }
}

function textField(value, name, limit, required = true) {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    throw new RequestError(400, `${name}格式无效`);
  }
  const text = value.trim();
  if ((required && !text) || text.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new RequestError(400, `${name}格式无效`);
  }
  return text;
}

function normalizeImageUrl(value, request, env) {
  const text = textField(value, "图片地址", 2048);
  const base = env.URL || env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  let url;
  try {
    url = new URL(text, base);
  } catch {
    throw new RequestError(400, "图片地址无效");
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password ||
      /\.(?:svg|html?|js|json|pdf|mp4|mov|gif)$/i.test(url.pathname)) {
    throw new RequestError(400, "请使用可公开访问的HTTPS JPG、PNG或WebP图片");
  }
  return url.href;
}

function validateDraft(body, request, env) {
  const merchantId = textField(body.merchantId, "商家编号", 36);
  if (!UUID_PATTERN.test(merchantId)) throw new RequestError(400, "商家编号格式无效");
  if (!Array.isArray(body.tags) || body.tags.length === 0 || body.tags.length > 10) {
    throw new RequestError(400, "标签格式无效");
  }
  const source = typeof body.source === "string" && ALLOWED_SOURCES.has(body.source.toLowerCase())
    ? body.source.toLowerCase()
    : "unknown";
  return {
    merchant_id: merchantId.toLowerCase(),
    title: textField(body.title, "标题", 80),
    body: textField(body.body, "正文", 8000),
    tags: body.tags.map((tag) => textField(tag, "标签", 48)),
    image_url: normalizeImageUrl(body.imageUrl, request, env),
    source,
  };
}

function miniappConfig(env) {
  const appId = (env.XHS_MINIAPP_APP_ID || DEFAULT_APP_ID).trim();
  const pagePath = (env.XHS_MINIAPP_PAGE_PATH || DEFAULT_PAGE_PATH).trim().replace(/^\/+/, "");
  if (!/^[0-9a-f]{24}$/i.test(appId) || !/^[a-zA-Z0-9_/-]{1,256}$/.test(pagePath)) {
    throw new Error("miniapp_config");
  }
  return { appId, pagePath };
}

export function buildMiniappLaunchUrl(handoffId, env = process.env) {
  if (!UUID_PATTERN.test(handoffId)) throw new Error("handoff_id");
  const { appId, pagePath } = miniappConfig(env);
  return `xhsdiscover://miniapp/${appId}/${pagePath}?handoffId=${encodeURIComponent(handoffId)}`;
}

export function createShareHandoffHandler({
  env = process.env,
  getClient = getSupabaseClient,
  now = () => Date.now(),
  makeId = () => crypto.randomUUID(),
  logger = console,
} = {}) {
  return async function handler(request) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (!new Set(["GET", "POST"]).has(request.method)) {
      return jsonResponse(405, { ok: false, message: "请求方式不支持" });
    }

    try {
      const supabase = getClient();
      if (request.method === "POST") {
        const draft = validateDraft(await readBody(request), request, env);
        const { data: merchant, error: merchantError } = await supabase
          .from("merchants").select("id,status").eq("id", draft.merchant_id).maybeSingle();
        if (merchantError) throw merchantError;
        if (!merchant || (merchant.status !== "active" && merchant.status !== null)) {
          throw new RequestError(404, "当前商家不可用");
        }

        const handoffId = makeId();
        const expiresAt = new Date(now() + 30 * 60 * 1000).toISOString();
        const { error } = await supabase.from("share_handoffs").insert({
          id: handoffId,
          ...draft,
          status: "created",
          expires_at: expiresAt,
        });
        if (error) throw error;

        return jsonResponse(201, {
          ok: true,
          handoffId,
          expiresAt,
          launchUrl: buildMiniappLaunchUrl(handoffId, env),
        });
      }

      const handoffId = new URL(request.url).searchParams.get("id") || "";
      if (!UUID_PATTERN.test(handoffId)) throw new RequestError(400, "交接编号格式无效");
      const { data, error } = await supabase.from("share_handoffs")
        .select("id,merchant_id,title,body,tags,image_url,source,status,expires_at")
        .eq("id", handoffId).maybeSingle();
      if (error) throw error;
      if (!data) throw new RequestError(404, "没有找到这份分享草稿");
      if (new Date(data.expires_at).getTime() <= now()) throw new RequestError(410, "分享草稿已过期，请返回H5重新生成");

      const openedAt = new Date(now()).toISOString();
      const { error: updateError } = await supabase.from("share_handoffs")
        .update({ status: "opened", opened_at: openedAt }).eq("id", handoffId);
      if (updateError) logger.error("Share handoff open marker failed", { code: updateError.code });

      return jsonResponse(200, {
        ok: true,
        handoffId: data.id,
        merchantId: data.merchant_id,
        title: data.title,
        body: data.body,
        tags: data.tags,
        imageUrl: data.image_url,
        source: data.source,
        expiresAt: data.expires_at,
      });
    } catch (error) {
      if (error instanceof RequestError) return jsonResponse(error.status, { ok: false, message: error.message });
      const missingTable = error?.code === "42P01";
      logger.error("Share handoff failed", { code: error?.code || "unexpected" });
      return jsonResponse(500, {
        ok: false,
        message: missingTable ? "草稿交接数据表尚未创建" : "草稿交接暂时不可用，请稍后重试",
      });
    }
  };
}

export default createShareHandoffHandler();
