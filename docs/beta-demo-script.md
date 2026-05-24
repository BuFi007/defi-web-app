# BUFI Beta — Live Demo Script (Invitee 1)

Rehearsed happy-path walkthrough for the first invited beta tester.
Each step lists exactly what to click, what to expect on screen, and
where a screenshot should be captured. Designed to run in **~12 minutes
end to end** with all three canonical flows.

> Environment: **production** at `https://fx.bu.finance`. Tester wallet
> pre-funded with 100 USDC + 200 MXNB + a sliver of Arc ETH for gas.

---

## Pre-call checklist (operator)

- [ ] Confirm `https://fx.bu.finance/` returns 200 (or 307 to alpha gate).
- [ ] Confirm matcher is healthy (operator-side: `/health` endpoint OK).
- [ ] Confirm Arc Testnet RPC is responsive.
- [ ] Tester has the **alpha password** and the **invite link** in their
      inbox.
- [ ] Tester wallet has the funding above (one quick faucet drip if not).
- [ ] Screenshare ready, recording on.

---

## Flow 0 — Get past the alpha gate (≈ 1 min)

1. Tester clicks the **invite link** in their email.
   - Expected: lands on `/alpha` with a single-input password form.
   - `[screenshot: alpha gate empty state]`

2. Tester types the alpha password and clicks **Continue**.
   - Expected: redirected to `/en` (the homepage). The hero shows the
     welcome / NotConnectedHome layout because no wallet is connected.
   - `[screenshot: not-connected home]`

---

## Flow 1 — Connect wallet on Arc Testnet (≈ 1 min)

3. Tester clicks **Log in or sign up** (top right, Dynamic widget).
   - Expected: Dynamic modal opens listing wallet options.
   - `[screenshot: dynamic modal open]`

4. Tester picks their wallet (e.g. **MetaMask**) and approves the connect.
   - Expected: wallet pops up → tester approves.

5. App prompts to **add / switch to Arc Testnet (chain id 5042002)**.
   - Tester approves.
   - Expected: page state changes — `NotConnectedHome` swaps out for
     **Trade Island**.
   - `[screenshot: trade island after connect]`

---

## Flow 2 — First perp trade: EUR/USD long (≈ 3 min)

6. Tester is on the **Trade** tab (default).
   - In the market picker (left side), tester selects **EUR/USD**.
   - Expected: chart loads, oracle mark appears in the price strip.
   - `[screenshot: EUR/USD selected, chart loaded]`

7. In the order panel (right side):
   - Order type: **Market**.
   - Side: **Long** (green button).
   - Size: type **1** in the notional input (USDC).
   - Expected: a preview row shows est. entry, slippage, fees.

8. Tester clicks the green **Submit** button (bottom of order panel).
   - Expected: wallet pops up with an EIP-712 typed-data signature
     request.
   - `[screenshot: wallet signature prompt]`

9. Tester signs.
   - Expected: button shows "Submitting…" then "Pending fill…".
   - Within ~1–2 seconds: a toast says "Filled at <price>" and the
     **Positions** tab badge ticks to **1**.
   - `[screenshot: filled toast + positions badge]`

10. Tester clicks the **Positions** tab.
    - Expected: their EUR/USD long row is visible with entry, size,
      mark, and live PnL.
    - `[screenshot: positions tab with one open row]`

11. Tester clicks **Close** on the position row.
    - Wallet pops up → signs the reduce-only order.
    - Expected: position disappears from Positions. A new fill row
      appears in **History**.
    - `[screenshot: positions empty + history with two fills]`

---

## Flow 3 — Privacy deposit: 10 MXNB (≈ 3 min)

12. Tester clicks the **Privacy** tab.
    - Expected: lists the live privacy pools — MXNB, QCAD, cirBTC, AUDF.
    - `[screenshot: privacy tab pool list]`

13. Tester clicks the **MXNB** pool row.
    - Expected: pool detail opens with denomination picker (10 / 100 /
      1000 MXNB).

14. Tester picks **10 MXNB** and clicks **Deposit**.
    - Expected: a modal warns "save your note" with a single download /
      copy action.
    - `[screenshot: save-your-note modal]`

15. Tester clicks **Copy note** then **Continue**.
    - Wallet pops up to approve MXNB spend → tester signs.
    - Wallet pops up again for the deposit tx → tester signs.
    - Expected: "Deposit confirmed" toast within ~5 seconds. The pool
      row shows the new commitment count incremented.
    - `[screenshot: deposit confirmed + pool count incremented]`

> Skipping the withdraw side in this demo to keep under 12 min — call
> it out verbally as the next step the tester should try on their own.

---

## Flow 4 — Borrow MXNB against USDC on Morpho (≈ 3 min)

16. Tester clicks the **Lend / Borrow** tab.
    - Expected: market table with 5 asset-loan Morpho markets — USDC
      collateral / {MXNB, QCAD, cirBTC, AUDF, EURC} loan.
    - `[screenshot: lend-borrow market table]`

17. Tester clicks the **USDC → MXNB** row.
    - Expected: market detail shows live APYs (supply + borrow), LLTV,
      and an action panel.
    - **Verify:** APYs are not literal zeros and not the obvious
      hardcoded placeholder — if they are, flag immediately.

18. In the action panel:
    - Tab: **Borrow**.
    - Collateral: **10 USDC**.
    - Borrow: **5 MXNB** (well below LLTV).
    - Expected: health-factor preview shows healthy (green).
    - `[screenshot: borrow form with healthy preview]`

19. Tester clicks **Borrow**.
    - Wallet pops up for USDC approve → tester signs.
    - Wallet pops up for the supply-collateral + borrow tx → tester signs.
    - Expected: "Borrow confirmed" toast. Position row appears in the
      same tab with the open loan.
    - `[screenshot: open loan position row]`

20. Tester clicks **Repay** on the row, leaves max-amount, signs MXNB
    approve + repay.
    - Expected: position row disappears or shows zero debt. Health
      factor reads infinite / N/A.
    - `[screenshot: position closed]`

---

## Wrap-up (≈ 1 min)

21. Walk the tester through:
    - Where the **History** tab lives (all fills + tx hashes, click
      through to Arc Testnet explorer).
    - Where the **bug report channel** is (#bufi-beta Slack).
    - Reminder: **save the privacy note** — we can't recover it.

22. Stop recording. Save the screenshots + recording in the demo
    folder. File any anomalies in `docs/beta-blockers.md`.

---

## Failure-mode escape routes (operator)

| If this happens | Do this |
|---|---|
| Wallet won't connect | Refresh page once; if still bad, try a different wallet. |
| Submit button doesn't trigger signature | Open devtools console; capture error; switch to a backup wallet. |
| Order pending > 30s | Operator: check matcher `/ready` endpoint. If down, switch to "look around the UI" mode and reschedule. |
| Privacy deposit reverts | Likely missing approve — re-trigger; if reverts again, abort flow 3 and continue to flow 4. |
| Morpho APYs show 0 / placeholders | Skip the borrow action, flag as P0 in blockers, demo the UI only. |
