"use client";

/**
 * Pair picker for the /swap widget.
 *
 * Wave-L3 only supports four routes today (EURC, JPYC, MXNB, CHFC, all
 * USDC-in on Fuji → token-out on Arc). The picker reads them from
 * `SPOT_PAIRS` rather than hardcoding labels here so adding a fifth
 * pair only requires updating the catalogue.
 *
 * TODO(K4): when `GET /spot/pools` lands, swap `SPOT_PAIRS` for a
 * React Query fetch and feed the live list into the same UI surface.
 */

import { SPOT_PAIRS, type SpotPair, type SpotPairSymbol } from "@/lib/swap/pairs";

interface PairPickerProps {
  value: SpotPairSymbol;
  onChange: (next: SpotPair) => void;
  disabled?: boolean;
}

export function SwapPairPicker({ value, onChange, disabled }: PairPickerProps) {
  return (
    <div className="swap-pair-picker" role="radiogroup" aria-label="Swap pair">
      {SPOT_PAIRS.map((pair) => {
        const active = pair.symbol === value;
        return (
          <button
            key={pair.symbol}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(pair)}
            className={"swap-pair-chip" + (active ? " active" : "")}
          >
            <span className="swap-pair-flags" aria-hidden>
              <span className="swap-pair-flag">{pair.inputToken.flag}</span>
              <span className="swap-pair-arrow">→</span>
              <span className="swap-pair-flag">{pair.outputToken.flag}</span>
            </span>
            <span className="swap-pair-label">
              {pair.inputToken.asset} → {pair.outputToken.asset}
            </span>
          </button>
        );
      })}
    </div>
  );
}
