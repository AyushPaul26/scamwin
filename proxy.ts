import { NextResponse } from "next/server";
import { auth0, isAuthConfigured } from "./lib/auth0";

export async function proxy(request: Request) {
  if (!isAuthConfigured()) {
    if (new URL(request.url).pathname.startsWith('/auth/')) return NextResponse.redirect(new URL('/sign-in?setup=required', request.url));
    return NextResponse.next();
  }
  const authResponse = await auth0.middleware(request);
  return authResponse;
}

export const config = {
  matcher: [
    "/((?!healthz$|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
