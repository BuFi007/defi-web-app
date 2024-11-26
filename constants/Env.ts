export const DYNAMIC_ENVIRONMENT_ID =
  process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID!;

export const PEANUTAPIKEY = process.env.NEXT_PUBLIC_DEEZ_NUTS_API_KEY;

if (!DYNAMIC_ENVIRONMENT_ID || !PEANUTAPIKEY) {
  throw new Error(
    "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID or NEXT_PUBLIC_DEEZ_NUTS_API_KEY is not set"
  );
}

export const IS_MAINNET =
  process.env.NEXT_PUBLIC_IS_MAINNET === "http://localhost:3000" ? false : true;
