import { createClient } from "@supabase/supabase-js";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
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

async function assertAdmin(supabase, token) {
  if (!token) {
    return { error: jsonResponse(401, { ok: false, message: "请先登录后台" }) };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: jsonResponse(401, { ok: false, message: "登录状态已失效，请重新登录" }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile?.role !== "admin") {
    return { error: jsonResponse(403, { ok: false, message: "只有管理员可以新增商家" }) };
  }

  return { user: userData.user };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (!["POST", "DELETE"].includes(request.method)) {
    return jsonResponse(405, { ok: false, message: "Method not allowed" });
  }

  try {
    const supabase = getSupabaseClient();
    const admin = await assertAdmin(supabase, getBearerToken(request));
    if (admin.error) return admin.error;

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const merchantId = String(url.searchParams.get("merchantId") || "").trim();

      if (!merchantId) {
        return jsonResponse(400, { ok: false, message: "Missing merchantId" });
      }

      const { data: merchant, error: merchantError } = await supabase
        .from("merchants")
        .update({
          status: "inactive",
          updated_at: new Date().toISOString(),
        })
        .eq("id", merchantId)
        .select("id,name,status")
        .maybeSingle();

      if (merchantError) throw merchantError;
      if (!merchant) {
        return jsonResponse(404, { ok: false, message: "Merchant not found" });
      }

      return jsonResponse(200, {
        ok: true,
        merchant,
      });
    }

    const body = await request.json();
    const name = String(body.name || "").trim();
    const industry = String(body.industry || "本地生活").trim();
    const contactName = String(body.contactName || "").trim();
    const contactPhone = String(body.contactPhone || "").trim();

    if (!name) {
      return jsonResponse(400, { ok: false, message: "请填写商家名称" });
    }

    const { data: existing, error: existingError } = await supabase.from("merchants").select("id,name").eq("name", name).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return jsonResponse(409, { ok: false, message: "这个商家已经存在" });
    }

    const { data: merchant, error: createError } = await supabase
      .from("merchants")
      .insert({
        name,
        industry,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        status: "active",
      })
      .select("id,name,industry,status")
      .single();

    if (createError) throw createError;

    return jsonResponse(200, {
      ok: true,
      merchant,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to create merchant",
    });
  }
}
