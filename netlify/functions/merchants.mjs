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

function sanitizeAccountEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeAccountPassword(value) {
  return String(value || "").trim();
}

function sanitizeMerchantName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getReadableAuthError(error) {
  const message = String(error?.message || "");
  if (/already|exists|registered/i.test(message)) {
    return "这个登录邮箱已经被使用，请换一个邮箱，或先不要勾选创建登录账号";
  }
  return "商家登录账号创建失败，请检查邮箱和密码后重试";
}

class CreationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function compensateCreation(supabase, state, logger) {
  let restored = true;
  // Only the user returned by this request's successful createUser may be deleted.
  if (state.createdUserId) {
    try {
      const { error } = await supabase.auth.admin.deleteUser(state.createdUserId);
      if (error) throw error;
    } catch {
      restored = false;
      logger.error("Merchant creation account cleanup failed", { merchantId: state.merchantId });
    }
  }

  try {
    const payload = state.previous
      ? {
          name: state.previous.name,
          industry: state.previous.industry,
          contact_name: state.previous.contact_name,
          contact_phone: state.previous.contact_phone,
          status: state.previous.status,
          updated_at: state.previous.updated_at,
        }
      : { status: "inactive", updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from("merchants")
      .update(payload)
      .eq("id", state.merchantId)
      .eq("updated_at", state.writtenAt)
      .select("id")
      .maybeSingle();
    if (error || !data) throw error || new Error("Merchant changed during rollback");
  } catch {
    restored = false;
    logger.error("Merchant creation record cleanup failed", { merchantId: state.merchantId });
  }
  return restored;
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

export function createMerchantsHandler({ getClient = getSupabaseClient, logger = console } = {}) {
  return async function handler(request) {
    if (request.method === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    if (!["POST", "DELETE"].includes(request.method)) {
      return jsonResponse(405, { ok: false, message: "Method not allowed" });
    }

    let supabase;
    let pendingCreation = null;
    try {
      supabase = getClient();
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
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse(400, { ok: false, message: "Invalid request body" });
      }
      const fieldLimits = { name: 160, industry: 128, contactName: 100, contactPhone: 64, accountEmail: 254, accountPassword: 256 };
      for (const [field, limit] of Object.entries(fieldLimits)) {
        if (body[field] != null && (typeof body[field] !== "string" || body[field].length > limit)) {
          return jsonResponse(400, { ok: false, message: `Invalid ${field}` });
        }
      }
      if (body.createAccount != null && typeof body.createAccount !== "boolean") {
        return jsonResponse(400, { ok: false, message: "Invalid createAccount" });
      }
      const name = sanitizeMerchantName(body.name);
      const industry = String(body.industry || "本地生活").trim();
      const contactName = String(body.contactName || "").trim();
      const contactPhone = String(body.contactPhone || "").trim();
      const createAccount = Boolean(body.createAccount);
      const accountEmail = sanitizeAccountEmail(body.accountEmail);
      const accountPassword = sanitizeAccountPassword(body.accountPassword);

      if (!name) {
        return jsonResponse(400, { ok: false, message: "请填写商家名称" });
      }

      if (createAccount && !accountEmail) {
        return jsonResponse(400, { ok: false, message: "请填写商家登录邮箱" });
      }

      if (createAccount && accountPassword.length < 6) {
        return jsonResponse(400, { ok: false, message: "初始密码至少需要 6 位" });
      }

      const { data: existing, error: existingError } = await supabase
        .from("merchants")
        .select("id,name,industry,contact_name,contact_phone,status,updated_at")
        .eq("name", name)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.status === "active" || existing?.status === null) {
        return jsonResponse(409, { ok: false, message: "这个商家已经存在" });
      }

      const merchantPayload = {
        name,
        industry,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        status: "active",
        updated_at: new Date().toISOString(),
      };

      let merchantMutation = existing
        ? supabase.from("merchants").update(merchantPayload).eq("id", existing.id).eq("status", existing.status)
        : supabase.from("merchants").insert(merchantPayload);
      if (existing) {
        merchantMutation = existing.updated_at == null
          ? merchantMutation.is("updated_at", null)
          : merchantMutation.eq("updated_at", existing.updated_at);
      }

      const { data: merchant, error: createError } = await merchantMutation
        .select("id,name,industry,status,updated_at")
        .maybeSingle();

      if (createError) throw createError;
      if (!merchant) throw new CreationError(409, "商家资料已发生变化，请刷新后重试");
      pendingCreation = {
        merchantId: merchant.id,
        writtenAt: merchant.updated_at,
        previous: existing || null,
        createdUserId: null,
      };

      let account = null;
      if (createAccount) {
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: accountEmail,
          password: accountPassword,
          email_confirm: true,
          user_metadata: {
            merchant_id: merchant.id,
            merchant_name: merchant.name,
            role: "merchant",
          },
        });

        if (authError) {
          throw new CreationError(409, getReadableAuthError(authError));
        }
        if (!authData?.user?.id) throw new Error("Account creation returned no user");
        pendingCreation.createdUserId = authData.user.id;

        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            id: authData.user.id,
            role: "merchant",
            merchant_id: merchant.id,
          },
          { onConflict: "id" },
        );

        if (profileError) throw profileError;

        account = {
          email: accountEmail,
          password: accountPassword,
        };
      }

      pendingCreation = null;
      return jsonResponse(200, {
        ok: true,
        merchant,
        account,
      });
    } catch (error) {
      if (pendingCreation && !(await compensateCreation(supabase, pendingCreation, logger))) {
        return jsonResponse(500, {
          ok: false,
          message: "创建未完成，部分资料未能自动恢复，请联系管理员核查后再重试",
        });
      }
      if (error instanceof CreationError) {
        return jsonResponse(error.status, { ok: false, message: error.message });
      }
      if (error instanceof SyntaxError) {
        return jsonResponse(400, { ok: false, message: "Invalid JSON payload" });
      }
      logger.error("Failed to update merchant");
      return jsonResponse(500, {
        ok: false,
        message: "商家资料保存失败，请稍后重试",
      });
    }
  };
}

export default createMerchantsHandler();
