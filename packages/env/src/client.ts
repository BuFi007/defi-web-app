import { z } from "zod";

/**
 * Client-side env. Only NEXT_PUBLIC_* gets shipped to the browser bundle —
 * never put secrets here. Mirrors the names already used in apps/web/.
 */
const schema = z.object({
  NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: z.string().optional(),
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_X402_NETWORK: z.string().optional(),
  NEXT_PUBLIC_BG_VARIANT: z.string().optional(),
  ONE_NEXT_PUBLIC_BG_VARIANT: z.string().optional(),
  TWO_NEXT_PUBLIC_BG_VARIANT: z.string().optional(),
});

export function clientEnv() {
  const parsed = schema.safeParse(
    typeof process !== "undefined" ? process.env : {},
  );
  if (!parsed.success) {
    // Client env is permissive — don't crash the bundle on a missing public var.
    if (typeof console !== "undefined") {
      console.warn("@bufi/env: client env validation failed", parsed.error.issues);
    }
    return {} as z.infer<typeof schema>;
  }
  return parsed.data;
}

export type ClientEnv = z.infer<typeof schema>;
