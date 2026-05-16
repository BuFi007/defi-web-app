import { NextResponse } from "next/server";
import { CHANNELS } from "@/components/radio/channels";

// Cache the entire discovery result for 6 hours. With ~50 query-based
// channels, one discovery run costs ~5000 YouTube Data API units; 4 runs
// per day = ~20k units. Next.js requires `revalidate` to be a literal,
// so 21600 = 6 * 60 * 60 is inlined here.
export const revalidate = 21600;
const REVALIDATE_SECONDS = 21600;

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

  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.items?.[0]?.id?.videoId ?? null;
}

export async function GET(): Promise<NextResponse<DiscoverResponse>> {
  const key = process.env.YOUTUBE_API_KEY;
  const queryChannels = CHANNELS.filter((c) => c.query && !c.videoId);

  if (!key) {
    return NextResponse.json({
      resolved: {},
      source: "no-api-key",
      generatedAt: new Date().toISOString(),
      unresolved: queryChannels.map((c) => c.id),
    });
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

  return NextResponse.json({
    resolved,
    source: "live-api",
    generatedAt: new Date().toISOString(),
    unresolved,
  });
}
