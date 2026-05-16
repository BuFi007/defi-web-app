import { describe, expect, test } from "bun:test";

import {
  buildRoomPermissions,
  parseRoomId,
  roomIdForArcadeRoom,
  roomIdForMcpWorkflow,
  roomIdForPerpsMarket,
  roomIdForTelaranaMarket,
} from "./rooms";

describe("room id helpers", () => {
  test("round-trips perps room id", () => {
    const id = roomIdForPerpsMarket(43113, "USDC-EURC");
    expect(id).toBe("bufi:43113:perps:USDC-EURC");
    expect(parseRoomId(id)).toEqual({
      kind: "perps",
      chainId: 43113,
      marketId: "USDC-EURC",
    });
  });

  test("round-trips arcade room id", () => {
    const id = roomIdForArcadeRoom(5042002, "arc-room-1");
    expect(parseRoomId(id)).toEqual({
      kind: "arcade",
      chainId: 5042002,
      roomId: "arc-room-1",
    });
  });

  test("round-trips telarana room id", () => {
    const id = roomIdForTelaranaMarket(919, "USDC-BRL");
    expect(parseRoomId(id)).toEqual({
      kind: "telarana",
      chainId: 919,
      marketId: "USDC-BRL",
    });
  });

  test("round-trips mcp workflow room id (no chain scope)", () => {
    const id = roomIdForMcpWorkflow("wf_abc123");
    expect(parseRoomId(id)).toEqual({ kind: "mcp", workflowId: "wf_abc123" });
  });

  test("rejects malformed room ids", () => {
    expect(parseRoomId("garbage")).toBeNull();
    expect(parseRoomId("sendero:tenant:trip:foo")).toBeNull();
    expect(parseRoomId("bufi:perps:without-chain")).toBeNull();
  });

  test("buildRoomPermissions composes per-chain allowlist", () => {
    const ids = buildRoomPermissions({
      chainId: 43113,
      marketIds: ["USDC-EURC", "USDC-MXNB"],
      arcadeRoomIds: ["room-1"],
      mcpWorkflowIds: ["wf-1"],
    });
    expect(ids).toContain("bufi:43113:perps:USDC-EURC");
    expect(ids).toContain("bufi:43113:perps:USDC-MXNB");
    expect(ids).toContain("bufi:43113:arcade:room-1");
    expect(ids).toContain("bufi:mcp:workflow:wf-1");
    expect(ids.length).toBe(4);
  });
});
