import { createClient } from "@supabase/supabase-js";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

async function resolveMerchant(supabase, merchantId, merchantName) {
  if (isUuid(merchantId)) {
    const { data, error } = await supabase.from("merchants").select("id,name").eq("id", merchantId).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const safeName = merchantName || merchantId || "未命名商家";
  const { data: existing, error: findError } = await supabase.from("merchants").select("id,name").eq("name", safeName).limit(1).maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("merchants")
    .insert({
      name: safeName,
      industry: "待补充",
      status: "active",
    })
    .select("id,name")
    .single();

  if (createError) throw createError;
  return created;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method not allowed" });
  }

  try {
    const body = await request.json();
    const eventType = String(body.eventType || "");

    if (!eventType) {
      return jsonResponse(400, { ok: false, message: "eventType is required" });
    }

    const supabase = getSupabaseClient();
    const merchant = await resolveMerchant(supabase, String(body.merchantId || ""), String(body.merchantName || ""));

    const { data, error } = await supabase
      .from("page_events")
      .insert({
        merchant_id: merchant.id,
        visitor_id: body.visitorId ? String(body.visitorId) : null,
        event_type: eventType,
        platform: body.platform ? String(body.platform) : null,
        source: body.source ? String(body.source) : null,
        page_path: body.pagePath ? String(body.pagePath) : "/",
        user_agent: body.userAgent ? String(body.userAgent) : null,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      })
      .select("id,created_at")
      .single();

    if (error) throw error;

    return jsonResponse(200, {
      ok: true,
      event: data,
      merchant,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to record event",
    });
  }
}
