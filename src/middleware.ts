import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
 
const PROTECTED_PREFIXES = ["/dashboard", "/gallery", "/profile"];
 
export default async function middleware(req: NextRequest) {
  const { nextUrl } = req;
  const isProtected = PROTECTED_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));
 
  if (!isProtected) {
    return NextResponse.next();
  }
 
  // Демо-режим — проверяем куки
  const isDemoLoggedIn = req.cookies.get("demoLoggedIn")?.value === "true";
  if (isDemoLoggedIn) {
    return NextResponse.next();
  }
 
  // NextAuth сессия — проверяем JWT токен
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });
 
  if (token) {
    return NextResponse.next();
  }
 
  // Если не залогинен — редирект на логин
  const loginUrl = new URL("/login", nextUrl.origin);
  loginUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
 
  return NextResponse.redirect(loginUrl);
}
 
export const config = {
  matcher: ["/dashboard/:path*", "/gallery/:path*", "/profile/:path*"],
};
