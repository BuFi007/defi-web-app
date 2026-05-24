/**
 * Barrel for the Wave-L3 swap surface.
 *
 * Kept thin so the implicit `index.tsx` resolution doesn't collide with
 * the legacy `components/swap/components/` (which is unrelated CDP-style
 * amount-input scaffolding — not the new /swap widget).
 *
 * Consumers should still import the components by name; this is here as
 * a convenience for the page shell.
 */
export { SwapWidget } from "./swap-widget";
export { SwapPairPicker } from "./pair-picker";
export { QuoteStream } from "./quote-stream";
export { SwapCta } from "./swap-cta";
