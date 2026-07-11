import { createClient } from "@supabase/supabase-js";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
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

    const { data: dailyStats, error: statsError } = await supabase
      .from("daily_merchant_stats")
      .select("merchant_id, merchant_name, stat_date, today_entries, redbook_shares, meituan_shares, dianping_shares")
      .eq("stat_date", date)
      .order("merchant_name", { ascending: true });

    if (statsError) throw statsError;

    const { data: merchants, error: merchantsError } = await supabase.from("merchants").select("id,name,created_at").order("created_at", { ascending: true });
    if (merchantsError) throw merchantsError;

    const { data: totals, error: totalsError } = await supabase.from("page_events").select("merchant_id,event_type");
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
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load admin stats",
    });
  }
}
