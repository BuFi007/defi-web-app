/**
 * Barrel for the BuFi uPlot wrappers. Pull from here, not from sibling
 * files, so external imports stay stable when we shuffle files inside
 * `apps/web/lib/perps/uplot/`.
 *
 * Side-effect: importing this file pulls in the uPlot stylesheet via
 * `./uplot.css`, which Next.js bundles into the global CSS chunk for
 * any page that includes a uPlot component.
 */

import "./uplot.css";

export { useUplot } from "./use-uplot";
export type { UseUplotArgs, UseUplotResult } from "./use-uplot";

export {
  e18ToNumber,
  e18LikeToNumber,
  fmtAnnualizedPct,
  fmtPriceForDepth,
  fmtSizeForDepth,
} from "./format";
