import { describe, expect, test } from "bun:test";
import { MockProvider } from "./mock-provider";
import { createGhostRegistry } from "./registry";
import type { ShieldedSigner, HexData } from "./shielded-execution-provider";

const ARC = 5042002;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const SETTLEMENT = "0x000000000000000000000000000000000000dEaD" as const;

const signer = (addr: string): ShieldedSigner => ({
  address: addr as `0x${string}`,
  chainId: ARC,
  signMessage: async () => "0x" as HexData,
  signTypedData: async () => "0x" as HexData,
});

const sig = "0xsig" as HexData;
const s = signer("0xb79e4987bc58057a322cd9bcface4944dd6a6cc7");

describe("MockProvider", () => {
  test("seeds + reads a shielded balance", async () => {
    const p = new MockProvider();
    const bals = await p.getBalances(s, ARC);
    const usdc = bals.find((b) => b.token.symbol === "USDC")!;
    expect(usdc.amount).toBe(1_250_000_000n);
    expect(usdc.usdEquivalent).toBe(1250);
  });

  test("shield deposit increases the balance after submit", async () => {
    const p = new MockProvider(false); // no seed → starts at 0
    const prep = await p.prepareShield(s, { chainId: ARC, funding: [{ token: USDC, amount: 100_000_000n }] });
    expect(prep.kind).toBe("shield");
    await p.submit(prep, sig);
    const usdc = (await p.getBalances(s, ARC)).find((b) => b.token.symbol === "USDC")!;
    expect(usdc.amount).toBe(100_000_000n);
  });

  test("execute funds from balance + records a resolvable owned execution", async () => {
    const p = new MockProvider(); // seeded 1250 USDC
    const prep = await p.prepareExecute(s, {
      chainId: ARC,
      target: SETTLEMENT,
      callData: "0xdeadbeef",
      funding: [{ token: USDC, amount: 200_000_000n }],
      label: "EURC/USDC long 5x",
    });
    expect(prep.kind).toBe("execute");
    const { ref } = await p.submit(prep, sig);
    // funding deducted from shielded balance
    const usdc = (await p.getBalances(s, ARC)).find((b) => b.token.symbol === "USDC")!;
    expect(usdc.amount).toBe(1_050_000_000n);
    // resolves to the user, executor detached from their wallet
    const owned = await p.resolveOwnedExecutions(s, ARC);
    expect(owned.some((e) => e.ref === ref && e.label === "EURC/USDC long 5x")).toBe(true);
    expect(owned[0].executor.toLowerCase()).not.toBe(s.address.toLowerCase());
  });

  test("unshield decreases the balance", async () => {
    const p = new MockProvider(); // 1250
    const prep = await p.prepareUnshield(s, {
      chainId: ARC,
      withdrawals: [{ token: USDC, amount: 50_000_000n }],
      recipient: "0x1111111111111111111111111111111111111111",
    });
    await p.submit(prep, sig);
    const usdc = (await p.getBalances(s, ARC)).find((b) => b.token.symbol === "USDC")!;
    expect(usdc.amount).toBe(1_200_000_000n);
  });

  test("registry routes Arc to a provider", () => {
    const reg = createGhostRegistry("mock");
    expect(reg.forChain(ARC)).not.toBeNull();
    expect(reg.forChain(999)).toBeNull();
    expect(reg.forChain(ARC)!.capabilities.supportsExecution(ARC)).toBe(true);
  });
});
