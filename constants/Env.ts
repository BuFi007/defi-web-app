export const DYNAMIC_ENVIRONMENT_ID = 
  process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID!;

const MAINNET_URL = process.env.NEXT_PUBLIC_MAINNET_URL;

const TESTNET_URL = process.env.NEXT_PUBLIC_TESTNET_URL;

if (!DYNAMIC_ENVIRONMENT_ID) {
  throw new Error("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is not set");
}

if (!MAINNET_URL) {
  throw new Error("NEXT_PUBLIC_MAINNET_URL is not set");
}

if (!TESTNET_URL) {
  throw new Error("NEXT_PUBLIC_TESTNET_URL is not set");
}

export const IS_MAINNET = typeof window !== 'undefined' 
  ? Boolean(MAINNET_URL && window.location.href.includes(MAINNET_URL)) || 
    Boolean(TESTNET_URL && window.location.href.includes(TESTNET_URL))
  : false;


