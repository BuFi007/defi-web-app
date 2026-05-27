const BRAND = "BUFX";

function joinTitle(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" | ");
}

function fmtPrice(price: number, sym: string): string {
  const isFx =
    !sym.includes("-PERP") &&
    !sym.includes("BTC") &&
    !sym.includes("ETH") &&
    !sym.includes("SOL");
  const decimals = isFx ? 4 : 2;
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtChange(changePct: number): string {
  const sign = changePct >= 0 ? "+" : "";
  return `${sign}${changePct.toFixed(2)}%`;
}

export function tradeTabTitle(
  sym: string,
  price: number,
  changePct: number,
): string {
  return joinTitle([sym, fmtPrice(price, sym), fmtChange(changePct), BRAND]);
}

export function loanTabTitle(
  loan: string,
  coll: string,
  action: "supply" | "borrow",
  ratePct: number | null,
): string {
  const pair = `${loan}/${coll}`;
  const label = action === "supply" ? "Supply" : "Borrow";
  const rate =
    ratePct != null && Number.isFinite(ratePct)
      ? `${ratePct.toFixed(2)}%`
      : null;
  return joinTitle([pair, label, rate, BRAND]);
}

export const DEFAULT_TAB_TITLE = `${BRAND} | Agentic Forex Stablecoin Trading`;
