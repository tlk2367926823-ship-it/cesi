import { createClient } from "@supabase/supabase-js";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getViewerScope(supabase, token) {
  if (!token) {
    return { error: jsonResponse(401, { ok: false, message: "请先登录后台" }) };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: jsonResponse(401, { ok: false, message: "登录状态已失效，请重新登录" }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, merchant_id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) {
    return { error: jsonResponse(403, { ok: false, message: "当前账号还没有绑定商家资料" }) };
  }

  if (profile.role === "admin") {
    return { user: userData.user, role: "admin", merchantId: null };
  }

  if (!profile.merchant_id) {
    return { error: jsonResponse(403, { ok: false, message: "当前商家账号还没有绑定商家" }) };
  }

  return { user: userData.user, role: "merchant", merchantId: profile.merchant_id };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (request.method !== "GET") {
    return jsonResponse(405, { ok: false, message: "Method not allowed" });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || todayKey();
    const supabase = getSupabaseClient();
    const scope = await getViewerScope(supabase, getBearerToken(request));

    if (scope.error) return scope.error;

    let dailyQuery = supabase
      .from("daily_merchant_stats")
      .select("merchant_id, merchant_name, stat_date, today_entries, redbook_shares, meituan_shares, dianping_shares")
      .eq("stat_date", date)
      .order("merchant_name", { ascending: true });

    let merchantQuery = supabase
      .from("merchants")
      .select("id,name,created_at,status")
      .or("status.is.null,status.eq.active")
      .order("created_at", { ascending: true });
    let totalsQuery = supabase.from("page_events").select("merchant_id,event_type");

    if (scope.merchantId) {
      dailyQuery = dailyQuery.eq("merchant_id", scope.merchantId);
      merchantQuery = merchantQuery.eq("id", scope.merchantId);
      totalsQuery = totalsQuery.eq("merchant_id", scope.merchantId);
    }

    const { data: dailyStats, error: statsError } = await dailyQuery;
    if (statsError) throw statsError;

    const { data: merchants, error: merchantsError } = await merchantQuery;
    if (merchantsError) throw merchantsError;

    const { data: totals, error: totalsError } = await totalsQuery;
    if (totalsError) throw totalsError;

    const totalEntriesByMerchant = new Map();
    for (const event of totals || []) {
      if (event.event_type !== "page_view") continue;
      totalEntriesByMerchant.set(event.merchant_id, (totalEntriesByMerchant.get(event.merchant_id) || 0) + 1);
    }

    const dailyByMerchant = new Map((dailyStats || []).map((row) => [row.merchant_id, row]));
    const rows = (merchants || []).map((merchant) => {
      const daily = dailyByMerchant.get(merchant.id);
      return {
        merchantId: merchant.id,
        merchantName: merchant.name,
        todayEntries: Number(daily?.today_entries || 0),
        totalEntries: Number(totalEntriesByMerchant.get(merchant.id) || 0),
        redbookShares: Number(daily?.redbook_shares || 0),
        meituanShares: Number(daily?.meituan_shares || 0),
        dianpingShares: Number(daily?.dianping_shares || 0),
        updatedAt: new Date().toISOString(),
      };
    });

    return jsonResponse(200, {
      date,
      merchants: rows,
      generatedAt: new Date().toISOString(),
      viewer: {
        role: scope.role,
        merchantId: scope.merchantId,
      },
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load admin stats",
    });
  }
}
