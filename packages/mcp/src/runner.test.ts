import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import type { WalletSession } from "@bufi/shared-types";

import { ToolRegistry } from "./registry";
import { WorkflowRunner } from "./runner";
import {
  buildWorkflowAuthorizationTypedData,
  hashWorkflowAuthorization,
  verifyWorkflowAuthorizationSignature,
} from "./signatures";
import { createInMemoryWorkflowStore } from "./state";

describe("WorkflowRunner signature gates", () => {
  test("verifies a wallet signature before executing a gated tool", async () => {
    const account = privateKeyToAccount(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const session = testSession(account.address);
    const runner = createSignedRunner();

    const started = await runner.start({
      toolName: "signed.echo",
      input: { value: "hello" },
      session,
    });

    expect(started.status).toBe("pending_signature");
    expect(started.requiredSignatureDigest).toBeDefined();

    const signature = await account.signTypedData(
      buildWorkflowAuthorizationTypedData({
        chainId: session.chainId,
        workflowId: started.workflowId,
        toolName: started.toolName,
        input: started.input,
        actor: session.address,
      }),
    );

    const completed = await runner.resume(started.workflowId, { signature });
    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual({ value: "hello" });
  });

  test("rejects signatures from a different wallet", async () => {
    const account = privateKeyToAccount(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    const wrongAccount = privateKeyToAccount(
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );
    const session = testSession(account.address);
    const runner = createSignedRunner();

    const started = await runner.start({
      toolName: "signed.echo",
      input: { value: "hello" },
      session,
    });
    const signature = await wrongAccount.signTypedData(
      buildWorkflowAuthorizationTypedData({
        chainId: session.chainId,
        workflowId: started.workflowId,
        toolName: started.toolName,
        input: started.input,
        actor: session.address,
      }),
    );

    await expect(runner.resume(started.workflowId, { signature })).rejects.toThrow(
      "invalid workflow signature",
    );
  });
});

function createSignedRunner(): WorkflowRunner {
  const registry = new ToolRegistry();
  registry.register({
    name: "signed.echo",
    description: "test signed echo",
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    requiresSignature: true,
    async canExecute(ctx) {
      return Boolean(ctx.session);
    },
    async execute(_ctx, input) {
      return input;
    },
  });
  return new WorkflowRunner({
    registry,
    store: createInMemoryWorkflowStore(),
    newWorkflowId: () => "wf_test",
    buildSignatureDigest({ toolName, input, workflowId, session }) {
      return hashWorkflowAuthorization({
        chainId: session.chainId,
        workflowId,
        toolName,
        input,
        actor: session.address,
      });
    },
    verifySignature({ toolName, input, workflowId, session, digest, signature }) {
      const expected = hashWorkflowAuthorization({
        chainId: session.chainId,
        workflowId,
        toolName,
        input,
        actor: session.address,
      });
      if (expected !== digest) return false;
      return verifyWorkflowAuthorizationSignature({
        chainId: session.chainId,
        workflowId,
        toolName,
        input,
        actor: session.address,
        signature,
      });
    },
  });
}

function testSession(address: WalletSession["address"]): WalletSession {
  return {
    address,
    chainId: 5042002,
    proof: {
      message: "test",
      signature: `0x${"0".repeat(130)}`,
      iat: 0,
      exp: 9999999999,
    },
  };
}
