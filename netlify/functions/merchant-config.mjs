import { createClient } from "@supabase/supabase-js";

const DEFAULT_MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 128 * 1024;
const PUBLIC_FIELDS = [
  "id", "name", "industry", "address", "description", "selling_points", "xiaohongshu_url",
  "meituan_url", "dianping_url", "image_urls", "service_keywords", "feature_keywords", "length_options",
].join(",");
const PRIVATE_FIELDS = `${PUBLIC_FIELDS},contact_name,contact_phone,prompt_profile`;

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,PUT,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "no-store",
      vary: "Authorization",
    },
  });
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function validateMerchantId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new InputError("商家 ID 格式无效");
  }
  return value.trim().toLowerCase();
}

function normalizeProfile(row, includePrivate = false) {
  return {
    id: row.id,
    name: row.name || "未命名商家",
    industry: row.industry || "本地生活",
    address: row.address || "",
    description: row.description || "",
    sellingPoints: normalizeList(row.selling_points),
    xiaohongshuUrl: row.xiaohongshu_url || "",
    meituanUrl: row.meituan_url || "",
    dianpingUrl: row.dianping_url || "",
    imageUrls: normalizeList(row.image_urls),
    serviceKeywords: normalizeList(row.service_keywords),
    featureKeywords: normalizeList(row.feature_keywords),
    lengthOptions: normalizeList(row.length_options),
    ...(includePrivate ? {
      contactName: row.contact_name || "",
      contactPhone: row.contact_phone || "",
      promptProfile: row.prompt_profile || "",
    } : {}),
  };
}

async function resolveProfile(supabase, merchantId, merchantName, includePrivate = false) {
  let query = supabase.from("merchants")
    .select(includePrivate ? PRIVATE_FIELDS : PUBLIC_FIELDS)
    .or("status.is.null,status.eq.active").limit(1);

  if (merchantId) {
    query = query.eq("id", merchantId);
  } else if (merchantName) {
    query = query.eq("name", merchantName);
  } else {
    query = query.eq("id", DEFAULT_MERCHANT_ID);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? normalizeProfile(data, includePrivate) : null;
}

async function assertCanEdit(supabase, token, merchantId) {
  if (!token) return { error: jsonResponse(401, { ok: false, message: "请先登录后台" }) };

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: jsonResponse(401, { ok: false, message: "登录状态已失效，请重新登录" }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, merchant_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile?.role === "admin") return { user: userData.user, role: "admin" };
  if (profile?.merchant_id && profile.merchant_id === merchantId) return { user: userData.user, role: "merchant" };

  return { error: jsonResponse(403, { ok: false, message: "没有权限编辑这个商家" }) };
}

async function readRequestBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new InputError("请使用 JSON 格式提交商家资料", 415);
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_BODY_BYTES)) {
    throw new InputError("商家资料内容过大", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("缺少商家资料");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError("商家资料内容过大", 413);
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
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InputError("商家资料 JSON 格式无效");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("商家资料格式无效");
  }
  return body;
}

function validateText(value, field, limit, nullable = true) {
  if (value == null && nullable) return "";
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new InputError(`${field}格式无效或超出长度限制`);
  }
  return value.trim();
}

function validateUrl(value, field, { image = false, domains } = {}) {
  const text = validateText(value, field, 2048);
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new InputError(`${field}必须是完整的${image ? " HTTPS 图片" : "网页"}地址`);
  }
  const protocols = image ? ["https:"] : ["https:", "http:"];
  if (!protocols.includes(url.protocol) || url.username || url.password ||
      (domains && !domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)))) {
    throw new InputError(`${field}地址无效`);
  }
  if (image && /\.(?:svg|html?|js|json|pdf|mp4|mov|gif)$/i.test(url.pathname)) {
    throw new InputError(`${field}请使用 JPG、PNG 或 WebP 图片`);
  }
  return url.href;
}

function validateList(value, field, maxItems, itemLength) {
  if (value == null) return [];
  if (!Array.isArray(value) && typeof value !== "string") throw new InputError(`${field}格式无效`);
  const items = Array.isArray(value) ? value : value.split(/\n|,/);
  if (items.length > maxItems) throw new InputError(`${field}数量超出限制`);
  return items.map((item) => validateText(item, field, itemLength, false)).filter(Boolean);
}

function pickUpdateFields(body, role) {
  const fields = { updated_at: new Date().toISOString() };
  const textFields = {
    name: ["name", "商家名称", 160],
    industry: ["industry", "行业", 128],
    contactName: ["contact_name", "联系人", 100],
    contactPhone: ["contact_phone", "联系电话", 64],
    address: ["address", "地址", 500],
    description: ["description", "商家介绍", 5000],
    promptProfile: ["prompt_profile", "AI 生成要求", 8000],
  };
  for (const [key, [column, label, limit]] of Object.entries(textFields)) {
    if (!Object.hasOwn(body, key)) continue;
    const value = validateText(body[key], label, limit, key !== "name");
    if (key === "name" && !value) throw new InputError("请填写商家名称");
    fields[column] = key === "industry" ? value || "本地生活" : value || null;
  }
  const lists = {
    sellingPoints: ["selling_points", "核心卖点", 50, 240],
    serviceKeywords: ["service_keywords", "服务关键词", 50, 160],
    featureKeywords: ["feature_keywords", "宣传关键词", 50, 160],
    lengthOptions: ["length_options", "长度选项", 10, 80],
  };
  for (const [key, [column, label, maxItems, itemLength]] of Object.entries(lists)) {
    if (Object.hasOwn(body, key)) fields[column] = validateList(body[key], label, maxItems, itemLength);
  }
  if (Object.hasOwn(body, "imageUrls")) {
    fields.image_urls = validateList(body.imageUrls, "图片素材", 50, 2048)
      .map((value) => validateUrl(value, "图片素材", { image: true }));
  }
  const links = {
    xiaohongshuUrl: ["xiaohongshu_url", "小红书链接", ["xiaohongshu.com", "xhslink.com"]],
    meituanUrl: ["meituan_url", "美团链接", ["meituan.com", "dpurl.cn"]],
    dianpingUrl: ["dianping_url", "大众点评链接", ["dianping.com", "dpurl.cn"]],
  };
  for (const [key, [column, label, domains]] of Object.entries(links)) {
    if (role !== "admin" || !Object.hasOwn(body, key)) continue;
    const value = validateUrl(body[key], label, { domains });
    fields[column] = value || null;
  }
  return fields;
}

export function createMerchantConfigHandler({ getClient = getSupabaseClient, logger = console } = {}) {
  return async function handler(request) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (!["GET", "PUT"].includes(request.method)) {
      return jsonResponse(405, { ok: false, message: "Method not allowed" });
    }

    try {
      if (request.method === "GET") {
        const url = new URL(request.url);
        const suppliedId = url.searchParams.get("merchantId") ?? url.searchParams.get("merchant");
        let merchantId = suppliedId == null ? "" : validateMerchantId(suppliedId);
        const merchantName = validateText(url.searchParams.get("merchantName"), "商家名称", 160);
        const token = getBearerToken(request);
        const includePrivate = request.headers.has("authorization");
        if (includePrivate && !token) {
          return jsonResponse(401, { ok: false, message: "请重新登录后台" });
        }
        const supabase = getClient();
        if (includePrivate) {
          if (!merchantId && merchantName) {
            const { data, error } = await supabase.from("merchants").select("id")
              .or("status.is.null,status.eq.active").eq("name", merchantName).limit(1).maybeSingle();
            if (error) throw error;
            merchantId = data?.id || "";
          } else if (!merchantId) {
            merchantId = DEFAULT_MERCHANT_ID;
          }
          const auth = await assertCanEdit(supabase, token, merchantId);
          if (auth.error) return auth.error;
          if (!merchantId) return jsonResponse(404, { ok: false, message: "商家不存在或已停用" });
        }
        const profile = await resolveProfile(supabase, merchantId, merchantName, includePrivate);
        if (!profile) return jsonResponse(404, { ok: false, message: "商家不存在或已停用" });
        return jsonResponse(200, { ok: true, visibility: includePrivate ? "private" : "public", profile });
      }

      const token = getBearerToken(request);
      if (!token) return jsonResponse(401, { ok: false, message: "请先登录后台" });
      const body = await readRequestBody(request);
      const merchantId = validateMerchantId(body.id ?? body.merchantId);
      if (body.id != null && body.merchantId != null && validateMerchantId(body.merchantId) !== merchantId) {
        throw new InputError("商家 ID 不一致");
      }
      const supabase = getClient();
      const auth = await assertCanEdit(supabase, token, merchantId);
      if (auth.error) return auth.error;

      const updateFields = pickUpdateFields(body, auth.role);
      if (Object.keys(updateFields).length === 1) throw new InputError("没有可更新的商家资料");
      const { data, error } = await supabase.from("merchants").update(updateFields)
        .eq("id", merchantId).or("status.is.null,status.eq.active").select(PRIVATE_FIELDS).maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(404, { ok: false, message: "商家不存在或已停用" });

      return jsonResponse(200, { ok: true, visibility: "private", profile: normalizeProfile(data, true) });
    } catch (error) {
      if (error instanceof InputError) return jsonResponse(error.status, { ok: false, message: error.message });
      logger.error("Merchant config request failed", { method: request.method });
      return jsonResponse(500, { ok: false, message: "商家资料服务暂时不可用，请稍后重试" });
    }
  };
}

export default createMerchantConfigHandler();
