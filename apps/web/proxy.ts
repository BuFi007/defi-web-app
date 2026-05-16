import { geolocation } from "@vercel/edge";
import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

// List of blocked countries (ISO 3166-1 alpha-2 country codes)
// North Korea (KP), Iran (IR), Syria (SY), Cuba (CU), Crimea (UA-43), Luhansk (UA-09), Donetsk (UA-14)
const BLOCKED_COUNTRIES = [
  "KP",
  "IR",
  "SY",
  "CU",
  "UA-43",
  "UA-09",
  "UA-14",
  "UNKNOWN",
];

const i18nMiddleware = createMiddleware({
  locales: ["en", "es", "pt"],
  defaultLocale: "en",
});

const ALPHA_COOKIE_NAME = "bu_alpha_access";

const isAlphaRoute = (pathname: string) =>
  pathname === "/alpha" || pathname.startsWith("/alpha/");

const shouldApplyAlphaGate = (pathname: string) =>
  pathname === "/" || (!isAlphaRoute(pathname) && !pathname.startsWith("/api/"));

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

export default async function proxy(req: NextRequest) {
  if (isAlphaRoute(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const alphaResponse = alphaGate(req);
  if (alphaResponse) return alphaResponse;

  const i18nResponse = i18nMiddleware(req);
  if (i18nResponse) return i18nResponse;

  const { country } = geolocation(req);
  const countryCode = country || "UNKNOWN";

  if (BLOCKED_COUNTRIES.includes(countryCode)) {
    return new Response("AI agent app not available in your country", {
      status: 403,
    });
  }
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
