import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;

  // Fail closed in production if the access credentials are missing.
  if (!username || !password) {
    return new NextResponse("App access is not configured.", { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const suppliedUsername = decoded.slice(0, separator);
      const suppliedPassword = decoded.slice(separator + 1);

      if (
        separator > -1 &&
        suppliedUsername === username &&
        suppliedPassword === password
      ) {
        return NextResponse.next();
      }
    } catch {
      // Invalid Basic Auth header; return an authentication challenge below.
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Insurance Reimbursements", charset="UTF-8"',
      "Cache-Control": "no-store"
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
