import { NextRequest, NextResponse } from "next/server";
import { updateClaim } from "@/lib/sheets";
import type { ClaimAction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const action = body.action as ClaimAction;

    if (!name) {
      return NextResponse.json({ ok: false, message: "The exact claim name is required." }, { status: 400 });
    }
    if (typeof action !== "string") {
      return NextResponse.json({ ok: false, message: "The action is required." }, { status: 400 });
    }

    const claim = await updateClaim(name, action);
    const labels: Record<string, string> = {
      submit_isapre: "Submitted to Isapre",
      isapre_reimbursement_received: "Ready to submit to complementary insurance",
      submit_complementary: "Submitted to complementary insurance",
      request_isapre_correction: "Isapre correction needed",
      request_complementary_correction: "Complementary insurance correction needed",
      resubmit_isapre: "Correction resubmitted to Isapre",
      resubmit_complementary: "Correction resubmitted to complementary insurance",
      close: "Claim closed"
    };

    return NextResponse.json({
      ok: true,
      message: `${claim.name}: ${labels[action] ?? "Updated"}.`,
      claim
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
