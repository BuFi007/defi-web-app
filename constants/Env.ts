export const DYNAMIC_ENVIRONMENT_ID =
  process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID!;

if (!DYNAMIC_ENVIRONMENT_ID) {
  throw new Error("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is not set");
}

export const IS_MAINNET =
  process.env.NEXT_PUBLIC_IS_MAINNET === "http://localhost:3000" ? false : true;
