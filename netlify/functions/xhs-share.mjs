import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TOKEN_ENDPOINT = "https://edith.xiaohongshu.com/api/sns/v1/ext/access/token";
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_SAFETY_MS = 60 * 1000;
const SIGNATURE_LIFETIME_MS = 5 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 10 * 1000;
const MAX_TOKEN_RESPONSE_BYTES = 32 * 1024;
const UNAVAILABLE_MESSAGE = "小红书官方通道暂不可用，请稍后重试";

class ShareError extends Error {
  constructor(stage, status = 503, message = UNAVAILABLE_MESSAGE, retryAfter = null) {
    super(message);
    this.stage = stage;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function response(status, body, origin, retryAfter = null) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store",
      "netlify-cdn-cache-control": "no-store",
      "x-content-type-options": "nosniff",
      vary: "Origin, Sec-Fetch-Site",
      ...(origin ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "accept",
      } : {}),
      ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
    },
  });
}

function configuredOrigin(value) {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedRequestOrigin(request, env) {
  const configured = [
    env.URL,
    env.DEPLOY_PRIME_URL,
    ...(env.XHS_ALLOWED_ORIGINS || "").split(/[\s,]+/),
  ];
  const allowed = new Set(configured.map(configuredOrigin).filter(Boolean));
  const originHeader = request.headers.get("origin");
  if (originHeader !== null) {
    const origin = configuredOrigin(originHeader);
    return origin && originHeader === origin && allowed.has(origin) ? origin : null;
  }

  // Same-origin GET fetches may omit Origin. Never trust forwarded host headers.
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return null;
  const targetOrigin = new URL(request.url).origin;
  if (!allowed.has(targetOrigin)) return null;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== targetOrigin) return null;
    } catch {
      return null;
    }
  }
  return targetOrigin;
}

function isConfigured(env) {
  return env.XHS_SHARE_ENABLED === "true"
    && typeof env.XHS_APP_KEY === "string" && env.XHS_APP_KEY.trim().length > 0
    && env.XHS_APP_KEY.length <= 256
    && typeof env.XHS_APP_SECRET === "string" && env.XHS_APP_SECRET.trim().length > 0
    && env.XHS_APP_SECRET.length <= 4096
    && typeof env.SUPABASE_URL === "string" && env.SUPABASE_URL.trim().length > 0
    && typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" && env.SUPABASE_SERVICE_ROLE_KEY.trim().length > 0;
}

function getSupabaseClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function buildXhsSignature(appKey, nonce, timestamp, secret) {
  const parameters = { appKey, nonce, timeStamp: String(timestamp) };
  const input = Object.keys(parameters).sort().map((key) => `${key}=${parameters[key]}`).join("&") + secret;
  return createHash("sha256").update(input, "utf8").digest("hex");
}

async function readTokenPayload(upstream) {
  if (Number(upstream.headers.get("content-length")) > MAX_TOKEN_RESPONSE_BYTES) {
    throw new ShareError("token_response_size");
  }
  const reader = upstream.body?.getReader();
  if (!reader) throw new ShareError("token_response_empty");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TOKEN_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ShareError("token_response_size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ShareError("token_response_json");
  }
}

function validateTokenPayload(payload, requestedExpiry, currentTime) {
  // The public JS guide lists top-level fields but no full response envelope.
  // Unknown envelopes fail closed until an official fixture verifies their shape.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || (Object.hasOwn(payload, "success") && payload.success !== true)
    || (Object.hasOwn(payload, "code") && payload.code !== 0)
    || typeof payload.access_token !== "string"
    || payload.access_token.length === 0 || payload.access_token.length > 8192
    || !Number.isSafeInteger(payload.expires_in)
    || payload.expires_in <= currentTime + 2 * TOKEN_SAFETY_MS
    || payload.expires_in > requestedExpiry) {
    throw new ShareError("token_response_contract");
  }
  return { token: payload.access_token, expiresAt: payload.expires_in };
}

async function refreshToken({ appKey, appSecret, fetchImpl, now, makeNonce, timeoutMs }) {
  const timestamp = now();
  const nonce = makeNonce();
  const requestedExpiry = timestamp + TOKEN_LIFETIME_MS;
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ShareError("token_timeout"));
    }, timeoutMs);
  });
  try {
    const refreshing = (async () => {
      const upstream = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          app_key: appKey,
          nonce,
          timestamp,
          signature: buildXhsSignature(appKey, nonce, timestamp, appSecret),
          expires_in: requestedExpiry,
        }),
      });
      if (!upstream.ok) throw new ShareError("token_http");
      return validateTokenPayload(await readTokenPayload(upstream), requestedExpiry, now());
    })();
    return await Promise.race([refreshing, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function getSharedToken(supabase, options) {
  const owner = options.makeLeaseOwner();
  const { data: claim, error: claimError } = await supabase.rpc("xhs_share_token_claim", {
    p_app_key: options.appKey,
    p_lease_owner: owner,
  });
  if (claimError) throw new ShareError("cache_claim");
  if (claim?.state === "ready") {
    if (typeof claim.access_token !== "string" || !claim.access_token || claim.access_token.length > 8192
      || !Number.isSafeInteger(claim.expires_at_ms)
      || claim.expires_at_ms <= options.now() + TOKEN_SAFETY_MS) {
      throw new ShareError("cache_contract");
    }
    return { token: claim.access_token, expiresAt: claim.expires_at_ms };
  }
  if (claim?.state === "busy") {
    throw new ShareError("cache_busy", 503, "小红书官方通道正在准备，请稍后重试", 2);
  }
  if (claim?.state !== "refresh") throw new ShareError("cache_contract");

  try {
    const token = await refreshToken(options);
    const { data: stored, error: storeError } = await supabase.rpc("xhs_share_token_store", {
      p_app_key: options.appKey,
      p_lease_owner: owner,
      p_access_token: token.token,
      p_expires_at_ms: token.expiresAt,
    });
    if (storeError || stored !== true) throw new ShareError("cache_store");
    return token;
  } catch (error) {
    // Keep the lease cooldown after uncertain upstream outcomes; never refresh in a loop.
    try {
      await supabase.rpc("xhs_share_token_fail", { p_app_key: options.appKey, p_lease_owner: owner });
    } catch {
      // The lease also expires automatically if cleanup cannot reach the database.
    }
    throw error;
  }
}

export function createXhsShareHandler({
  env = process.env,
  getClient = getSupabaseClient,
  fetchImpl = fetch,
  now = Date.now,
  makeNonce = () => randomBytes(16).toString("hex"),
  makeLeaseOwner = randomUUID,
  tokenTimeoutMs = TOKEN_TIMEOUT_MS,
  logger = console,
} = {}) {
  return async function handler(request) {
    const origin = allowedRequestOrigin(request, env);
    if (request.method === "OPTIONS") {
      return response(origin ? 204 : 403, { enabled: false, message: "Origin is not allowed" }, origin);
    }
    if (request.method !== "GET") {
      return response(405, { enabled: false, message: "Method not allowed" }, origin);
    }
    if (!isConfigured(env)) {
      return response(200, { enabled: false, message: "小红书官方通道尚未开通，当前可使用系统分享" }, origin);
    }
    if (!origin) return response(403, { enabled: false, message: "Origin is not allowed" }, null);

    try {
      const url = new URL(request.url);
      const merchantId = url.searchParams.get("merchantId");
      if (url.searchParams.getAll("merchantId").length !== 1
        || [...url.searchParams.keys()].some((key) => key !== "merchantId")
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(merchantId || "")) {
        return response(400, { enabled: false, message: "Invalid merchantId or query parameters" }, origin);
      }

      const supabase = getClient(env);
      const { data: merchant, error: merchantError } = await supabase
        .from("merchants")
        .select("id,status")
        .eq("id", merchantId)
        .maybeSingle();
      if (merchantError) throw new ShareError("merchant_lookup");
      if (!merchant || (merchant.status !== "active" && merchant.status !== null)) {
        return response(404, { enabled: false, message: "Merchant is unavailable" }, origin);
      }

      const appKey = env.XHS_APP_KEY;
      const token = await getSharedToken(supabase, {
        appKey,
        appSecret: env.XHS_APP_SECRET,
        fetchImpl,
        now,
        makeNonce,
        makeLeaseOwner,
        timeoutMs: tokenTimeoutMs,
      });
      const timestamp = now();
      const validUntil = Math.min(timestamp + SIGNATURE_LIFETIME_MS, token.expiresAt - TOKEN_SAFETY_MS);
      if (validUntil <= timestamp) throw new ShareError("signature_expired");
      const nonce = makeNonce();
      return response(200, {
        enabled: true,
        message: "小红书官方通道已准备",
        verifyConfig: {
          appKey,
          nonce,
          timestamp: String(timestamp),
          signature: buildXhsSignature(appKey, nonce, timestamp, token.token),
        },
        validUntil,
      }, origin);
    } catch (error) {
      const failure = error instanceof ShareError ? error : new ShareError("unexpected");
      logger.error("XHS share preparation failed", { stage: failure.stage });
      return response(failure.status, { enabled: false, message: failure.message }, origin, failure.retryAfter);
    }
  };
}

export default createXhsShareHandler();
