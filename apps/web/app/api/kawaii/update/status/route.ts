import { NextRequest, NextResponse } from "next/server";
import { getUpdateTxStatus } from "@/lib/kawaii/update-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/kawaii/update/status?txId=<circleTxId> — poll the async setTokenURI
 * transaction kicked off by /api/kawaii/update. Returns the Circle state +
 * on-chain hash so the customizer can show "✓ confirmed on-chain". The txId is
 * an opaque Circle id (no PII); read-only.
 */
export async function GET(req: NextRequest) {
  const txId = req.nextUrl.searchParams.get("txId");
  if (!txId) return NextResponse.json({ error: "missing txId" }, { status: 400 });
  try {
    const s = await getUpdateTxStatus(txId);
    return NextResponse.json(s);
  } catch (e) {
    return NextResponse.json({ error: `status failed: ${String((e as Error).message ?? e)}` }, { status: 500 });
  }
}
