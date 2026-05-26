const BRAND = "BUFX";

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
  return `${sym} ${fmtPrice(price, sym)} ${fmtChange(changePct)} | ${BRAND}`;
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
      : "";
  return rate
    ? `${pair} ${label} ${rate} | ${BRAND}`
    : `${pair} ${label} | ${BRAND}`;
}

export const DEFAULT_TAB_TITLE = `${BRAND} | Agentic Forex Stablecoin Trading`;
