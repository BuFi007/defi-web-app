import { geolocation } from "@vercel/functions";
import { createI18nMiddleware } from "next-international/middleware";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "@bufi/location/supported-locales";

// ISO-3166-1 alpha-2 country codes that are blocked from accessing the app.
const BLOCKED_COUNTRIES = ["KP", "IR", "SY", "CU", "UA-43", "UA-09", "UA-14"];

const I18N_CONFIG = {
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  urlMappingStrategy: "rewrite",
} as const;

const I18nMiddleware = createI18nMiddleware(I18N_CONFIG);
const LOCALE_COOKIE = "Next-Locale";
const LOCALE_COOKIE_OPTIONS = {
  path: "/" as const,
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

const RATE_LIMIT_EXEMPT_API_ROUTES = new Set([
  "/api/dynamic-webhook",
  "/api/radio/discover",
]);

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
  const cookie = response.cookies.get(LOCALE_COOKIE);
  if (cookie) {
    response.cookies.set(LOCALE_COOKIE, cookie.value, LOCALE_COOKIE_OPTIONS);
  }
  return response;
};

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const { country } = geolocation(req);
  if (country && BLOCKED_COUNTRIES.includes(country)) {
    return new Response("AI agent app not available in your country", {
      status: 403,
    });
  }

  if (pathname.startsWith("/api/")) {
    if (isOgApiRoute(pathname)) {
      const limited = rateLimitOg(req);
      if (limited) return limited;
    }
    return NextResponse.next();
  }

  const stripped = stripLocalePrefix(req);
  if (stripped) return stripped;

  const i18nResponse = I18nMiddleware(req);
  return ensureSecureLocaleCookies(i18nResponse);
}

export const config = {
  matcher: ["/((?!_next|monitoring|.*\\..*).*)"],
};
