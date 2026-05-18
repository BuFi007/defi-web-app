// Fixed-point ↔ float conversion helpers for perps + telarana payloads.
//
// On-chain math runs in 18-decimal fixed-point bigints (priceE18,
// sizeDeltaE18, etc.) — those serialize as strings over the wire to
// dodge JSON's float precision loss. Render layers want plain numbers.
// Centralizing these two helpers prevents the silent `BigInt(undefined)`
// throws that earlier crashed the positions panel.

export function safeBigInt(value: string | undefined | null): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function e18ToNumber(value: bigint | null): number | null {
  if (value === null) return null;
  return Number(value) / 1e18;
}
