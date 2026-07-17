import { createClient } from "@supabase/supabase-js";

const DEFAULT_MERCHANT_ID = "a90fd384-a296-4a95-98dd-b3e79fc36d93";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,PUT,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
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

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message || "Merchant config request failed");
  }
  return "Merchant config request failed";
}

function normalizeProfile(row) {
  return {
    id: row.id,
    name: row.name || "未命名商家",
    industry: row.industry || "本地生活",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
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
    promptProfile: row.prompt_profile || "",
  };
}

async function resolveProfile(supabase, merchantId, merchantName) {
  let query = supabase.from("merchants").select("*").or("status.is.null,status.eq.active").limit(1);

  if (merchantId) {
    query = query.eq("id", merchantId);
  } else if (merchantName) {
    query = query.eq("name", merchantName);
  } else {
    query = query.eq("id", DEFAULT_MERCHANT_ID);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? normalizeProfile(data) : null;
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

function pickUpdateFields(body) {
  return {
    name: String(body.name || "").trim(),
    industry: String(body.industry || "本地生活").trim(),
    contact_name: String(body.contactName || "").trim() || null,
    contact_phone: String(body.contactPhone || "").trim() || null,
    address: String(body.address || "").trim() || null,
    description: String(body.description || "").trim() || null,
    selling_points: normalizeList(body.sellingPoints),
    xiaohongshu_url: String(body.xiaohongshuUrl || "").trim() || null,
    meituan_url: String(body.meituanUrl || "").trim() || null,
    dianping_url: String(body.dianpingUrl || "").trim() || null,
    image_urls: normalizeList(body.imageUrls),
    service_keywords: normalizeList(body.serviceKeywords),
    feature_keywords: normalizeList(body.featureKeywords),
    length_options: normalizeList(body.lengthOptions),
    prompt_profile: String(body.promptProfile || "").trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  try {
    const supabase = getSupabaseClient();

    if (request.method === "GET") {
      const url = new URL(request.url);
      const merchantId = url.searchParams.get("merchantId") || url.searchParams.get("merchant") || "";
      const merchantName = url.searchParams.get("merchantName") || "";
      const profile = await resolveProfile(supabase, merchantId, merchantName);

      if (!profile) {
        return jsonResponse(404, { ok: false, message: "商家不存在" });
      }

      return jsonResponse(200, { ok: true, profile });
    }

    if (request.method !== "PUT") {
      return jsonResponse(405, { ok: false, message: "Method not allowed" });
    }

    const body = await request.json();
    const merchantId = String(body.id || body.merchantId || "").trim();
    if (!merchantId) {
      return jsonResponse(400, { ok: false, message: "缺少商家 ID" });
    }

    const auth = await assertCanEdit(supabase, getBearerToken(request), merchantId);
    if (auth.error) return auth.error;

    const updateFields = pickUpdateFields(body);
    if (auth.role !== "admin") {
      delete updateFields.xiaohongshu_url;
      delete updateFields.meituan_url;
      delete updateFields.dianping_url;
    }
    if (!updateFields.name) {
      return jsonResponse(400, { ok: false, message: "请填写商家名称" });
    }

    const { data, error } = await supabase.from("merchants").update(updateFields).eq("id", merchantId).select("*").single();
    if (error) throw error;

    return jsonResponse(200, { ok: true, profile: normalizeProfile(data) });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      message: getErrorMessage(error),
    });
  }
}
