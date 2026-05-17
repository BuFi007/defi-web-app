import { geolocation } from "@vercel/functions";
import { createI18nMiddleware } from "next-international/middleware";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "@bufi/location/supported-locales";

// ISO-3166-1 alpha-2 country codes that are blocked from accessing the app.
// "UNKNOWN" intentionally excluded — geolocation is undefined in local dev,
// blocking that would 403 our own dev environment.
const BLOCKED_COUNTRIES = ["KP", "IR", "SY", "CU", "UA-43", "UA-09", "UA-14"];

const I18N_CONFIG = {
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  urlMappingStrategy: "rewrite",
} as const;

const I18nMiddleware = createI18nMiddleware(I18N_CONFIG);
const LOCALE_COOKIE = "NEXT_LOCALE";
const LOCALE_COOKIE_OPTIONS = {
  path: "/" as const,
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
};

const ALPHA_COOKIE_NAME = "bu_alpha_access";

const isAlphaRoute = (pathname: string) =>
  pathname === "/alpha" || pathname.startsWith("/alpha/");

const shouldApplyAlphaGate = (pathname: string) =>
  pathname === "/" || (!isAlphaRoute(pathname) && !pathname.startsWith("/api/"));

// API routes that are NOT rate-limited. Webhooks and form submits can
// legitimately burst; the radio discover is already cached server-side.
const RATE_LIMIT_EXEMPT_API_ROUTES = new Set([
  "/api/alpha-gate",
  "/api/dynamic-webhook",
  "/api/radio/discover",
]);

// In-memory per-IP counter. Scoped to a single edge instance (so a real
// attacker hitting multiple instances would split the count), but it's
// free and catches the common one-IP fuzzing case. Memory is bounded by
// instance lifetime — Vercel recycles edge workers regularly.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const ipCounts = new Map<string, { count: number; windowStart: number }>();

const clientIp = (req: NextRequest): string => {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
};

const isOgApiRoute = (pathname: string): boolean => {
  if (!pathname.startsWith("/api/")) return false;
  if (RATE_LIMIT_EXEMPT_API_ROUTES.has(pathname)) return false;
  // /api/og/* and the dynamic /api/[id] catch-all are both OG image gens.
  if (pathname.startsWith("/api/og/")) return true;
  const segments = pathname.split("/").filter(Boolean);
  return segments.length === 2 && segments[0] === "api";
};

const rateLimitOg = (req: NextRequest): NextResponse | null => {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = ipCounts.get(ip);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipCounts.set(ip, { count: 1, windowStart: now });
    return null;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  entry.count += 1;
  return null;
};

const alphaGate = (req: NextRequest) => {
  if (process.env.ALPHA_GATE_ENABLED !== "true") {
    return null;
  }

  const pathname = req.nextUrl.pathname;
  if (!shouldApplyAlphaGate(pathname)) {
    return null;
  }

  const hasAccess = req.cookies.get(ALPHA_COOKIE_NAME)?.value === "true";
  if (hasAccess) {
    return null;
  }

  const url = req.nextUrl.clone();
  url.pathname = "/alpha";
  url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);

  return NextResponse.redirect(url);
};

/**
 * If the URL still has a `/<locale>` prefix, redirect to the clean path and
 * persist the choice in `NEXT_LOCALE`. After this redirect, the locale lives
 * only in the cookie — every subsequent URL stays clean.
 */
const stripLocalePrefix = (req: NextRequest): NextResponse | null => {
  const { pathname, search } = req.nextUrl;
  const segments = pathname.split("/");
  const maybeLocale = segments[1];
  if (
    !maybeLocale ||
    !(SUPPORTED_LOCALES as readonly string[]).includes(maybeLocale)
  ) {
    return null;
  }

  const rest = "/" + segments.slice(2).join("/");
  const cleaned = rest === "/" ? "/" : rest;
  const newUrl = new URL(cleaned, req.url);
  newUrl.search = search;

  const redirect = NextResponse.redirect(newUrl);
  redirect.cookies.set(LOCALE_COOKIE, maybeLocale, LOCALE_COOKIE_OPTIONS);
  return redirect;
};

const ensureSecureLocaleCookies = (response: NextResponse): NextResponse => {
  for (const name of ["Next-Locale", LOCALE_COOKIE]) {
    const cookie = response.cookies.get(name);
    if (cookie) {
      response.cookies.set(name, cookie.value, LOCALE_COOKIE_OPTIONS);
    }
  }
  return response;
};

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isAlphaRoute(pathname)) {
    return NextResponse.next();
  }

  // Universal geo block — runs on BOTH pages and /api/* now that the
  // matcher covers everything. Skip the check when geolocation can't
  // resolve (local dev, non-Vercel hosts) so we don't lock ourselves out.
  const { country } = geolocation(req);
  if (country && BLOCKED_COUNTRIES.includes(country)) {
    return new Response("AI agent app not available in your country", {
      status: 403,
    });
  }

  // /api/* branch: rate-limit the expensive OG renders, pass everything else.
  // No locale rewriting and no alpha gate here — API auth lives on the
  // route handler itself.
  if (pathname.startsWith("/api/")) {
    if (isOgApiRoute(pathname)) {
      const limited = rateLimitOg(req);
      if (limited) return limited;
    }
    return NextResponse.next();
  }

  // Page branch: alpha gate, then locale strip, then i18n rewrite.
  const alphaResponse = alphaGate(req);
  if (alphaResponse) return alphaResponse;

  const stripped = stripLocalePrefix(req);
  if (stripped) return stripped;

  const i18nResponse = I18nMiddleware(req);
  return ensureSecureLocaleCookies(i18nResponse);
}

export const config = {
  // /api/* is now matched (was previously excluded). _next and asset files
  // still skip the proxy so we don't waste time on hot-path requests.
  matcher: ["/((?!_next|.*\\..*).*)"],
};
