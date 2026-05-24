import { NextRequest, NextResponse } from "next/server";
import { CHANNELS } from "@/components/radio/channels";

// ~50 query-based channels × 100 YouTube units each = ~5000 units per
// discovery. Caching for 6h ⇒ at most ~20k units/day. Bust via
// revalidateTag('radio-discovery') if you ever need fresh results sooner.
const REVALIDATE_SECONDS = 6 * 60 * 60;

type DiscoverResponse = {
  resolved: Record<string, string>;
  source: "live-api" | "no-api-key";
  generatedAt: string;
  /** IDs of channels that had a `query` but no live result. */
  unresolved: string[];
};

async function searchLive(query: string, apiKey: string): Promise<string | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("eventType", "live");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.items?.[0]?.id?.videoId ?? null;
}

// Singleton inflight promise per 6h epoch. Coalesces cold-cache stampedes:
// if N requests hit the route at the same instant after a cache miss, only
// ONE upstream YouTube fan-out runs and all N share that result.
let inflightPromise: Promise<DiscoverResponse> | null = null;
let inflightEpoch = -1;

const currentEpoch = (): number =>
  Math.floor(Date.now() / (REVALIDATE_SECONDS * 1000));

async function getDiscovery(): Promise<DiscoverResponse> {
  const epoch = currentEpoch();
  if (inflightPromise && inflightEpoch === epoch) {
    return inflightPromise;
  }
  inflightEpoch = epoch;
  inflightPromise = getDiscoveryCached();
  return inflightPromise;
}

async function getDiscoveryCached(): Promise<DiscoverResponse> {

  const key = process.env.YOUTUBE_API_KEY;
  const queryChannels = CHANNELS.filter((c) => c.query && !c.videoId);

  if (!key) {
    return {
      resolved: {},
      source: "no-api-key",
      generatedAt: new Date().toISOString(),
      unresolved: queryChannels.map((c) => c.id),
    };
  }

  const results = await Promise.allSettled(
    queryChannels.map(async (c) => ({
      id: c.id,
      videoId: await searchLive(c.query!, key),
    })),
  );

  const resolved: Record<string, string> = {};
  const unresolved: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.videoId) resolved[r.value.id] = r.value.videoId;
      else unresolved.push(r.value.id);
    }
  }

  return {
    resolved,
    source: "live-api",
    generatedAt: new Date().toISOString(),
    unresolved,
  };
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<DiscoverResponse> | NextResponse> {
  // Reject browser fetches from any origin other than our own — stops
  // third-party sites from rehosting the videoIds we paid YouTube quota
  // for. Same-origin fetches and server-to-server requests don't send
  // an `origin` header, so they pass through naturally.
  const originHeader = request.headers.get("origin");
  if (originHeader && originHeader !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(await getDiscovery(), {
    // Tell intermediaries that the response varies by Origin so we don't
    // accidentally serve an allowed-origin body to a forbidden caller.
    headers: { Vary: "Origin" },
  });
}
