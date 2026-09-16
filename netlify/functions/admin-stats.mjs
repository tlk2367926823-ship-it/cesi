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

function todayKey(now) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function forEachPage(createQuery, consume) {
  let offset = 0;
  while (true) {
    const { data, error } = await createQuery().range(offset, offset + 999);
    if (error) throw error;
    if (!data?.length) return;
    consume(data);
    // Advance by the returned count, including projects with a lower API row cap.
    offset += data.length;
  }
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

export function createAdminStatsHandler({ getClient = getSupabaseClient, now = () => new Date(), logger = console } = {}) {
  return async function handler(request) {
    if (request.method === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { ok: false, message: "Method not allowed" });
    }

    try {
      const url = new URL(request.url);
      const snapshotTime = now();
      const generatedAt = snapshotTime.toISOString();
      const date = url.searchParams.get("date") || todayKey(snapshotTime);
      if (!isValidDate(date)) return jsonResponse(400, { ok: false, message: "Invalid date" });
      const supabase = getClient();
      const scope = await getViewerScope(supabase, getBearerToken(request));

      if (scope.error) return scope.error;

      const dailyQuery = () => {
        let query = supabase
          .from("daily_merchant_stats")
          .select("merchant_id, merchant_name, stat_date, today_entries, redbook_shares, meituan_shares, dianping_shares")
          .eq("stat_date", date)
          .order("merchant_id", { ascending: true });
        if (scope.merchantId) query = query.eq("merchant_id", scope.merchantId);
        return query;
      };

      const merchantQuery = () => {
        let query = supabase
          .from("merchants")
          .select("id,name,created_at,status")
          .or("status.is.null,status.eq.active")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
        if (scope.merchantId) query = query.eq("id", scope.merchantId);
        return query;
      };
      const totalsQuery = () => {
        let query = supabase
          .from("page_events")
          .select("merchant_id")
          .eq("event_type", "page_view")
          .lte("created_at", generatedAt)
          .order("id", { ascending: true });
        if (scope.merchantId) query = query.eq("merchant_id", scope.merchantId);
        return query;
      };

      const totalEntriesByMerchant = new Map();
      const dailyByMerchant = new Map();
      const merchants = [];
      await Promise.all([
        forEachPage(dailyQuery, (page) => {
          for (const row of page) dailyByMerchant.set(row.merchant_id, row);
        }),
        forEachPage(merchantQuery, (page) => merchants.push(...page)),
        forEachPage(totalsQuery, (page) => {
          for (const event of page) {
            totalEntriesByMerchant.set(event.merchant_id, (totalEntriesByMerchant.get(event.merchant_id) || 0) + 1);
          }
        }),
      ]);
      const rows = merchants.map((merchant) => {
        const daily = dailyByMerchant.get(merchant.id);
        return {
          merchantId: merchant.id,
          merchantName: merchant.name,
          todayEntries: Number(daily?.today_entries || 0),
          totalEntries: Number(totalEntriesByMerchant.get(merchant.id) || 0),
          redbookShares: Number(daily?.redbook_shares || 0),
          meituanShares: Number(daily?.meituan_shares || 0),
          dianpingShares: Number(daily?.dianping_shares || 0),
          updatedAt: generatedAt,
        };
      });

      return jsonResponse(200, {
        date,
        merchants: rows,
        generatedAt,
        viewer: {
          role: scope.role,
          merchantId: scope.merchantId,
        },
      });
    } catch (error) {
      logger.error("Failed to load admin stats");
      return jsonResponse(500, {
        ok: false,
        message: "Failed to load admin stats",
      });
    }
  };
}

export default createAdminStatsHandler();
