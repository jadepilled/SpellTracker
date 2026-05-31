import { DurableObject } from "cloudflare:workers";

const COUNTER_OBJECT_NAME = "global-cooldowns-tracked";
const MAX_INCREMENT = 20;
const COOLDOWN_INCREMENT_LIMIT_PER_MINUTE = 60;
const ANALYTICS_EVENT_LIMIT_PER_MINUTE = 120;
const ANALYTICS_EVENTS = new Set(["site-view", "ad-click"]);
const ALLOWED_ORIGINS = new Set([
  "https://spelltracker.lol",
  "https://www.spelltracker.lol",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);

export class CooldownCounter extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && (pathname === "/" || pathname.endsWith("/api/cooldowns"))) {
      return jsonResponse({ total: await this.total(), updatedAt: new Date().toISOString() });
    }

    if (request.method === "GET" && pathname.endsWith("/api/analytics")) {
      return jsonResponse({ ...(await this.analytics()), updatedAt: new Date().toISOString() });
    }

    if (request.method === "POST" && (pathname === "/" || pathname.endsWith("/api/cooldowns"))) {
      const body = await safeJson(request);
      const amount = parseIncrementAmount(body?.amount);
      if (!amount) {
        return jsonResponse({ error: "Expected a positive integer amount." }, { status: 400 });
      }
      const allowed = await this.takeRateLimitSlot("cooldown", clientKey(request), COOLDOWN_INCREMENT_LIMIT_PER_MINUTE, amount);
      if (!allowed) {
        return jsonResponse({ error: "Rate limited." }, { status: 429 });
      }
      const total = await this.increment(amount);
      return jsonResponse({ total, accepted: amount, updatedAt: new Date().toISOString() });
    }

    if (request.method === "POST" && pathname.endsWith("/api/analytics")) {
      const body = await safeJson(request);
      const event = String(body?.event || "");
      if (!ANALYTICS_EVENTS.has(event)) {
        return jsonResponse({ error: "Unknown analytics event." }, { status: 400 });
      }
      const allowed = await this.takeRateLimitSlot("analytics", clientKey(request), ANALYTICS_EVENT_LIMIT_PER_MINUTE, 1);
      if (!allowed) {
        return jsonResponse({ error: "Rate limited." }, { status: 429 });
      }
      const stats = await this.trackAnalytics(event, {
        adId: normalizeAnalyticsKey(body?.adId),
        position: normalizeAnalyticsKey(body?.position)
      });
      return jsonResponse({ accepted: event, ...stats, updatedAt: new Date().toISOString() });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  async total() {
    return this.totalBigInt().then((total) => total.toString());
  }

  async totalBigInt() {
    return parseStoredBigInt(await this.ctx.storage.get("total"));
  }

  async increment(amount) {
    const total = (await this.totalBigInt()) + BigInt(amount);
    await this.ctx.storage.put("total", total.toString());
    return total.toString();
  }

  async analytics() {
    const siteViews = Math.max(0, Number(await this.ctx.storage.get("analytics:siteViews")) || 0);
    const adClicks = Math.max(0, Number(await this.ctx.storage.get("analytics:adClicks")) || 0);
    return {
      siteViews,
      adClicks,
      clickthroughRate: rate(adClicks, siteViews),
      adClicksById: (await this.ctx.storage.get("analytics:adClicksById")) || {},
      adClicksByPosition: (await this.ctx.storage.get("analytics:adClicksByPosition")) || {}
    };
  }

  async trackAnalytics(event, details = {}) {
    if (event === "site-view") {
      await this.incrementKey("analytics:siteViews", 1);
    }

    if (event === "ad-click") {
      await this.incrementKey("analytics:adClicks", 1);
      await this.incrementMap("analytics:adClicksById", details.adId || "unknown", 1);
      await this.incrementMap("analytics:adClicksByPosition", details.position || "unknown", 1);
    }

    return this.analytics();
  }

  async incrementKey(key, amount) {
    const total = Math.max(0, Number(await this.ctx.storage.get(key)) || 0) + amount;
    await this.ctx.storage.put(key, total);
    return total;
  }

  async incrementMap(key, itemKey, amount) {
    const map = (await this.ctx.storage.get(key)) || {};
    map[itemKey] = Math.max(0, Number(map[itemKey]) || 0) + amount;
    await this.ctx.storage.put(key, map);
    return map;
  }

  async takeRateLimitSlot(bucket, keyName, limit, cost) {
    const minute = Math.floor(Date.now() / 60000);
    const key = `rate:${bucket}:${minute}`;
    const counts = (await this.ctx.storage.get(key)) || {};
    const used = Math.max(0, Number(counts[keyName]) || 0);
    if (used + cost > limit) return false;
    counts[keyName] = used + cost;
    await this.ctx.storage.put(key, counts);
    await this.ctx.storage.delete(`rate:${bucket}:${minute - 3}`);
    return true;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }));
    }

    if (!originAllowed(request)) {
      return withCors(request, jsonResponse({ error: "Origin not allowed" }, { status: 403 }));
    }

    const id = env.COUNTER.idFromName(COUNTER_OBJECT_NAME);
    const object = env.COUNTER.get(id);
    return withCors(request, await object.fetch(request));
  }
};

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseIncrementAmount(value) {
  const integer = Math.floor(Number(value) || 0);
  if (integer < 1) return null;
  return Math.min(MAX_INCREMENT, integer);
}

function parseStoredBigInt(value) {
  try {
    const text = String(value ?? "0").replace(/[^\d]/g, "");
    return text ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}

function normalizeAnalyticsKey(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64) || "unknown";
}

function clientKey(request) {
  return normalizeAnalyticsKey(
    request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")
    || request.headers.get("Origin")
    || "unknown"
  );
}

function rate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(6));
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

function originAllowed(request) {
  const origin = request.headers.get("Origin");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function withCors(request, response) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  headers.set("Access-Control-Allow-Origin", originAllowed(request) && origin ? origin : "https://spelltracker.lol");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
