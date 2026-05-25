# BUFI / fx-telaraña — Beta Tester Onboarding

Welcome! You've been invited to test BUFI — an on-chain FX trading,
privacy-pool, and lending app running on **Arc Testnet**. This guide
gets you from invite link to first trade in **under 10 minutes**.

> Audience: external beta tester. Zero context required. You only need
> a browser, a wallet (MetaMask / Rabby / WalletConnect-compatible), and
> a few minutes.

---

## Prerequisites

You need:

1. **A browser wallet.** MetaMask, Rabby, or any WalletConnect mobile
   wallet works. We use Dynamic for connection, so all major wallets
   are supported.
2. **A funded EVM address with a tiny bit of ETH** for gas on the
   source chain (Sepolia or Base Sepolia). ~0.01 ETH is plenty.
3. **The alpha-gate password** — sent to you in your invite email.
4. **The invite link** — also in your invite email. It looks like:
   `https://fx.bu.finance/?invite=<your-code>`

> ⚠️ **BLOCKER if not deployed:** This guide assumes the app is hosted
> at `https://fx.bu.finance`. If that URL is not yet live, ping the
> team in Slack before continuing — local-dev setup is **not** part of
> the beta experience.

> 🛠️ **Operators only — local dev:** boot the full stack with
> `bun run dev:up` (was `bun run dev:complete`). Web serves at
> **`https://localhost:3001`** under an mkcert self-signed cert — install
> mkcert + run `mkcert -install` once so your browser trusts it.
> Logs land in `/tmp/bufi-*.log`. The API dev CORS allow-list already
> includes `https://localhost:3001`.

---

## Step 1 — Open the invite link

Click the invite link from your email. You'll land on the alpha gate.

- Enter the alpha password.
- Click **Continue**.
- You'll be redirected to the trade homepage at `/en`.

If you see a 404 or a blank page, the deploy may be down — report in
the bug channel (see end of doc) and re-try in 5 minutes.

---

## Step 2 — Connect your wallet

On the homepage welcome card you'll see a primary **Log in or sign up**
button (and a matching one top-right in the header — both open the
Dynamic widget).

1. Click **Log in or sign up** on the welcome card.
2. Pick your wallet (MetaMask, Rabby, WalletConnect, etc.).
3. Approve the connect prompt in your wallet.
4. The app will prompt you to **switch / add Arc Testnet (chain id
   5042002)**. Approve.

Once connected, the homepage transitions from the welcome screen to
the **Trade Island** (the main trading surface).

> If the page still says "wallet not connected" after a successful
> connect, refresh once — this is a known Dynamic flake we're tracking.

> 🩹 **Wallet flow flaking on local dev?** Fall back to the **Dynamic
> test login**: in the modal pick **Enter your email**, paste
> `tomas.cordero.esp+dynamic_test@gmail.com` (any `+dynamic_test`
> address works), and use OTP `967140`. Full credential set lives at
> `tests/fixtures/dynamic-test-accounts.json`. This bypasses
> MetaMask/SIWE entirely and provisions a Turnkey embedded wallet on
> first login. **Local dev only** — do not ship to invitees.

---

## Step 3 — Fund your wallet on Arc Testnet

You'll need two things on Arc Testnet:

1. **USDC on Arc** for trading collateral.
2. **A bit of native ETH on Arc** for gas (very small — sub-cent).

Both come from the BUFI faucet (linked from the homepage banner) OR
from bridging via the in-app **Bridge** tab if you have testnet USDC
on Sepolia / Base Sepolia.

Quickest path:

- Click the **Faucet** link in the homepage banner.
- Paste your wallet address.
- Receive 100 test USDC + gas drip within ~30 seconds.

> For privacy-pool testing you'll also want some **MXNB** (test peso
> stable). Same faucet, different button.

---

## Step 4 — Your first perp trade (EUR/USD)

This is the canary flow — small notional, fast settlement.

1. On the homepage, you're already on the **Trade** tab.
2. In the market picker, select **EUR/USD**.
3. Choose **Market** order type, **Long** side.
4. Set notional to **1 USDC** (the minimum, for safety while testing).
5. Click **Submit** (the primary action button in the order panel).
6. Your wallet pops up to sign an EIP-712 message — approve it.

What happens next:

- The order goes to the matcher.
- Within ~1 second the matcher settles the fill on Arc.
- The **Positions** tab badge increments to **1**.
- Your new position appears in the Positions tab with entry price + PnL.

To close: open **Positions**, click **Close** on your row, sign once
more.

---

## Step 5 — Your first privacy deposit (MXNB)

The Privacy tab lets you deposit into a Privacy Pool — a fixed-denom
shielded pool inspired by Privacy Pools v2.

1. Click the **Privacy** tab.
2. Select the **MXNB** pool.
3. Choose a fixed denomination (e.g. 10 MXNB).
4. Click **Deposit**.
5. Sign the approve + deposit transactions in your wallet.

When the deposit confirms, you'll get a **note / commitment** — save
it (it's your withdraw key). Without the note you cannot withdraw.

To withdraw: switch wallets (or use a delay), open Privacy → Withdraw,
paste your note, pick a recipient, click **Withdraw**.

---

## Step 6 — Your first loan (Morpho, MXNB-against-USDC)

1. Click the **Lend / Borrow** tab.
2. Find the **USDC-collateral / MXNB-loan** market row.
3. Click **Borrow**.
4. Choose collateral amount (e.g. 10 USDC) and borrow amount (e.g.
   5 MXNB worth, well under the LLTV).
5. Approve USDC, then sign the supply-collateral + borrow tx.
6. Your borrowed MXNB lands in your wallet; your collateralized
   position shows in the Lend / Borrow tab.

To repay: same tab, click **Repay** on your position row, approve
MXNB, sign.

---

## Where to report bugs

Please file every issue you hit — even small ones — in the **#bufi-beta**
Slack channel. Include:

- What you were trying to do
- What you saw instead
- A screenshot if the UI is involved
- The wallet address you were connected with (so we can trace on-chain)
- Browser + wallet (e.g. "Chrome 131 + Rabby")

For critical issues (lost funds, stuck position, contract revert that
locked a tx) DM **@bufi-oncall** directly.

---

## Known operational notes

- **Wallet flake on connect:** if Dynamic widget says "wallet not
  connected" after you connect, refresh once.
- **Arc network add:** if your wallet doesn't know Arc, the app will
  offer to add it — approve.
- **Order doesn't fill instantly:** the matcher runs a 1-second busy
  loop and 30-second idle loop. Worst case is ~30 seconds before your
  order picks up if the book is quiet.
- **Withdraw from Privacy needs the note:** don't lose it. We do not
  hold a copy.

Happy testing — and thanks for being one of the first humans through
this stack. Your bug reports literally shape the launch.
