import { createClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 4 * 1024;
const EVENT_TYPES = new Set(["page_view", "share_click"]);
const PLATFORMS = new Set(["redbook", "meituan", "dianping"]);

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

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new RequestError(413, "Event payload is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Invalid JSON payload");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "Event payload is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new RequestError(400, "Invalid JSON payload");
  }
}

function optionalString(body, field, maxLength) {
  const value = body[field];
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength || value.includes("\0")) {
    throw new RequestError(400, `Invalid ${field}`);
  }
  return value;
}

function validateEvent(body) {
  const merchantId = optionalString(body, "merchantId", 36);
  if (!isUuid(merchantId)) throw new RequestError(400, "Invalid merchantId");
  optionalString(body, "merchantName", 160);
  if (!EVENT_TYPES.has(body.eventType)) throw new RequestError(400, "Invalid eventType");

  const platform = optionalString(body, "platform", 32);
  if ((platform && !PLATFORMS.has(platform)) || (body.eventType === "share_click" && !platform)) {
    throw new RequestError(400, "Invalid platform");
  }
  const metadata = body.metadata ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new RequestError(400, "Invalid metadata");
  }
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > MAX_METADATA_BYTES) {
    throw new RequestError(413, "Event metadata is too large");
  }

  return {
    merchant_id: merchantId,
    visitor_id: optionalString(body, "visitorId", 128),
    event_type: body.eventType,
    platform,
    source: optionalString(body, "source", 128),
    page_path: optionalString(body, "pagePath", 2048) || "/",
    user_agent: optionalString(body, "userAgent", 1024),
    metadata,
  };
}

export function createEventsHandler({ getClient = getSupabaseClient, logger = console } = {}) {
  return async function handler(request) {
    if (request.method === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, message: "Method not allowed" });
    }

    try {
      const event = validateEvent(await readBody(request));
      const supabase = getClient();
      const { data: merchant, error: merchantError } = await supabase
        .from("merchants")
        .select("id,name,status")
        .eq("id", event.merchant_id)
        .maybeSingle();
      if (merchantError) throw merchantError;
      if (!merchant || (merchant.status !== "active" && merchant.status !== null)) {
        return jsonResponse(404, { ok: false, message: "Merchant is unavailable" });
      }

      const { data, error } = await supabase
        .from("page_events")
        .insert(event)
        .select("id,created_at")
        .single();

      if (error) throw error;

      return jsonResponse(200, {
        ok: true,
        event: data,
        merchant: { id: merchant.id, name: merchant.name },
      });
    } catch (error) {
      if (error instanceof RequestError) {
        return jsonResponse(error.status, { ok: false, message: error.message });
      }
      logger.error("Failed to record event");
      return jsonResponse(500, {
        ok: false,
        message: "Failed to record event",
      });
    }
  };
}

export default createEventsHandler();
