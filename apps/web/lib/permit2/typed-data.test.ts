/// <reference types="bun-types" />
/**
 * Digest-fixture tests for the Permit2 typed-data builders.
 *
 * Strategy: compute the EIP-712 digest of our hand-rolled envelope via
 * viem's `hashTypedData()`, then independently compute the same digest by
 * walking the spec by hand (typeHash → struct hash → domain separator →
 * `\x19\x01` prefix). The two paths MUST agree — that proves our types,
 * field ordering, and domain shape are byte-identical to what an on-chain
 * `Permit2.permit()` call would recover from.
 *
 * The hand-walked path uses the well-known PERMIT2 typeHashes from
 * `PermitHash.sol` — derived inline from their canonical type strings
 * (not hard-coded) so the test fails loudly if anyone tweaks field order
 * in `./types.ts`.
 *
 * Run with: bun test apps/web/lib/permit2/typed-data.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { PERMIT2_ADDRESS } from "./constants";
import {
  buildPermit2Domain,
  buildPermitSingleTypedData,
  buildPermitTransferFromTypedData,
} from "./typed-data";

// ---------------------------------------------------------------------------
// Canonical Permit2 type strings — verbatim from PermitHash.sol.
// ---------------------------------------------------------------------------

const PERMIT_DETAILS_TYPE_STRING =
  "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)";

const PERMIT_SINGLE_TYPE_STRING =
  "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)" +
  PERMIT_DETAILS_TYPE_STRING;

const TOKEN_PERMISSIONS_TYPE_STRING =
  "TokenPermissions(address token,uint256 amount)";

const PERMIT_TRANSFER_FROM_TYPE_STRING =
  "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)" +
  TOKEN_PERMISSIONS_TYPE_STRING;

const EIP712_DOMAIN_TYPE_STRING =
  "EIP712Domain(string name,uint256 chainId,address verifyingContract)";

function hashString(s: string): Hex {
  return keccak256(stringToHex(s));
}

function buildDomainSeparator(chainId: number): Hex {
  const typeHash = hashString(EIP712_DOMAIN_TYPE_STRING);
  const nameHash = hashString("Permit2");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, uint256, address"),
      [typeHash, nameHash, BigInt(chainId), PERMIT2_ADDRESS],
    ),
  );
}

// ---------------------------------------------------------------------------
// Reference (well-known) type hashes — derived, NOT hard-coded.
// ---------------------------------------------------------------------------

describe("Permit2 canonical type strings produce deterministic, non-empty type hashes", () => {
  test("PermitDetails type string hashes to a 32-byte digest", () => {
    const h = hashString(PERMIT_DETAILS_TYPE_STRING);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h).not.toBe("0x" + "0".repeat(64));
  });

  test("PermitSingle type string hashes to a 32-byte digest", () => {
    const h = hashString(PERMIT_SINGLE_TYPE_STRING);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h).not.toBe("0x" + "0".repeat(64));
  });

  test("TokenPermissions + PermitTransferFrom strings hash to distinct digests", () => {
    const a = hashString(TOKEN_PERMISSIONS_TYPE_STRING);
    const b = hashString(PERMIT_TRANSFER_FROM_TYPE_STRING);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(b).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  // The bytewise digest equality of these four type hashes is validated
  // transitively via the `digest matches reference computation` tests
  // below — if the canonical strings drift, the hand-walked digests
  // diverge from viem's hashTypedData output and those tests fail.
});

// ---------------------------------------------------------------------------
// Hand-walked digest for PermitSingle, compared against viem's hashTypedData.
// ---------------------------------------------------------------------------

interface PermitSingleFixture {
  chainId: number;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  expiration: number;
  nonce: number;
  sigDeadline: bigint;
}

const FIXTURE_SINGLE: PermitSingleFixture = {
  chainId: 1,
  owner: "0x1111111111111111111111111111111111111111",
  token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC mainnet
  spender: "0x2222222222222222222222222222222222222222",
  amount: 1_000_000_000n, // 1,000 USDC (6-decimals)
  expiration: 1_700_000_000,
  nonce: 0,
  sigDeadline: 1_700_001_000n,
};

function handHashPermitSingle(fx: PermitSingleFixture): Hex {
  const detailsTypeHash = hashString(PERMIT_DETAILS_TYPE_STRING);
  const singleTypeHash = hashString(PERMIT_SINGLE_TYPE_STRING);

  // Hash the inner PermitDetails struct.
  const detailsHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, address, uint160, uint48, uint48"),
      [
        detailsTypeHash,
        fx.token,
        fx.amount,
        fx.expiration,
        fx.nonce,
      ],
    ),
  );

  // Hash the outer PermitSingle struct, which embeds detailsHash.
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, address, uint256"),
      [singleTypeHash, detailsHash, fx.spender, fx.sigDeadline],
    ),
  );

  // EIP-712 envelope: keccak256(\x19\x01 || domainSeparator || structHash).
  const domainSeparator = buildDomainSeparator(fx.chainId);
  return keccak256(concat(["0x1901" as Hex, domainSeparator, structHash]));
}

describe("buildPermitSingleTypedData → digest matches hand-walked EIP-712 reference", () => {
  test("digest matches reference computation (mainnet, USDC, 1,000 amount)", () => {
    const typedData = buildPermitSingleTypedData({
      chainId: FIXTURE_SINGLE.chainId,
      owner: FIXTURE_SINGLE.owner,
      token: FIXTURE_SINGLE.token,
      amount: FIXTURE_SINGLE.amount,
      expiration: FIXTURE_SINGLE.expiration,
      nonce: FIXTURE_SINGLE.nonce,
      sigDeadline: FIXTURE_SINGLE.sigDeadline,
      spender: FIXTURE_SINGLE.spender,
    });

    const viemDigest = hashTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const referenceDigest = handHashPermitSingle(FIXTURE_SINGLE);
    expect(viemDigest).toBe(referenceDigest);
  });

  test("digest is sensitive to amount changes", () => {
    const base = buildPermitSingleTypedData({
      ...FIXTURE_SINGLE,
    });
    const tweaked = buildPermitSingleTypedData({
      ...FIXTURE_SINGLE,
      amount: FIXTURE_SINGLE.amount + 1n,
    });

    const a = hashTypedData({
      domain: base.domain,
      types: base.types,
      primaryType: base.primaryType,
      message: base.message,
    });
    const b = hashTypedData({
      domain: tweaked.domain,
      types: tweaked.types,
      primaryType: tweaked.primaryType,
      message: tweaked.message,
    });
    expect(a).not.toBe(b);
  });

  test("digest is sensitive to chainId changes (replay safety)", () => {
    const onMainnet = buildPermitSingleTypedData({
      ...FIXTURE_SINGLE,
      chainId: 1,
    });
    const onArc = buildPermitSingleTypedData({
      ...FIXTURE_SINGLE,
      chainId: 5042002,
    });
    expect(
      hashTypedData({
        domain: onMainnet.domain,
        types: onMainnet.types,
        primaryType: onMainnet.primaryType,
        message: onMainnet.message,
      }),
    ).not.toBe(
      hashTypedData({
        domain: onArc.domain,
        types: onArc.types,
        primaryType: onArc.primaryType,
        message: onArc.message,
      }),
    );
  });

  test("buildPermit2Domain omits the `version` field (Permit2 deliberately has none)", () => {
    const domain = buildPermit2Domain(1);
    expect(domain.name).toBe("Permit2");
    expect(domain.chainId).toBe(1);
    expect(domain.verifyingContract).toBe(PERMIT2_ADDRESS);
    // Permit2 does NOT include version — defending against EIP-712 libs
    // that auto-add `version: "1"`.
    expect("version" in domain).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hand-walked digest for PermitTransferFrom.
// ---------------------------------------------------------------------------

interface PermitTransferFromFixture {
  chainId: number;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

const FIXTURE_TRANSFER: PermitTransferFromFixture = {
  chainId: 5042002, // Arc testnet
  owner: "0x3333333333333333333333333333333333333333",
  token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  spender: "0x4444444444444444444444444444444444444444",
  amount: 500_000_000n, // 500 USDC
  nonce: 7n,
  deadline: 1_700_002_000n,
};

function handHashPermitTransferFrom(fx: PermitTransferFromFixture): Hex {
  const permissionsTypeHash = hashString(TOKEN_PERMISSIONS_TYPE_STRING);
  const transferTypeHash = hashString(PERMIT_TRANSFER_FROM_TYPE_STRING);

  const permissionsHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, address, uint256"),
      [permissionsTypeHash, fx.token, fx.amount],
    ),
  );

  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, address, uint256, uint256"),
      [transferTypeHash, permissionsHash, fx.spender, fx.nonce, fx.deadline],
    ),
  );

  const domainSeparator = buildDomainSeparator(fx.chainId);
  return keccak256(concat(["0x1901" as Hex, domainSeparator, structHash]));
}

describe("buildPermitTransferFromTypedData → digest matches hand-walked EIP-712 reference", () => {
  test("digest matches reference computation (Arc testnet, USDC, 500 amount)", () => {
    const typedData = buildPermitTransferFromTypedData({
      chainId: FIXTURE_TRANSFER.chainId,
      owner: FIXTURE_TRANSFER.owner,
      token: FIXTURE_TRANSFER.token,
      amount: FIXTURE_TRANSFER.amount,
      nonce: FIXTURE_TRANSFER.nonce,
      deadline: FIXTURE_TRANSFER.deadline,
      spender: FIXTURE_TRANSFER.spender,
    });

    const viemDigest = hashTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const referenceDigest = handHashPermitTransferFrom(FIXTURE_TRANSFER);
    expect(viemDigest).toBe(referenceDigest);
  });

  test("digest is sensitive to nonce changes (single-use replay safety)", () => {
    const a = buildPermitTransferFromTypedData({ ...FIXTURE_TRANSFER });
    const b = buildPermitTransferFromTypedData({
      ...FIXTURE_TRANSFER,
      nonce: FIXTURE_TRANSFER.nonce + 1n,
    });
    expect(
      hashTypedData({
        domain: a.domain,
        types: a.types,
        primaryType: a.primaryType,
        message: a.message,
      }),
    ).not.toBe(
      hashTypedData({
        domain: b.domain,
        types: b.types,
        primaryType: b.primaryType,
        message: b.message,
      }),
    );
  });
});
