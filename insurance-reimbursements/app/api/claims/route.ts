import { NextRequest, NextResponse } from "next/server";
import { createClaim, listClaims } from "@/lib/sheets";
import type { ClaimRoute } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json({ ok: false, message }, { status });
}

export async function GET() {
  try {
    const claims = await listClaims();
    return NextResponse.json({ ok: true, claims });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const route = body.route as ClaimRoute;

    if (!name) return errorResponse(new Error("The claim name is required."));
    if (route !== "both" && route !== "complementary_only") {
      return errorResponse(new Error('Route must be "both" or "complementary_only".'));
    }

    const claim = await createClaim(name, route);
    return NextResponse.json({ ok: true, message: `Created ${claim.name}.`, claim }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("already exists") ? 409 : 400;
    return errorResponse(error, status);
  }
}
