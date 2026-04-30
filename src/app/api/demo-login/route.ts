import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("demoLoggedIn", "true", {
    path: "/",
    maxAge: 86400,
    httpOnly: false,
  });
  return response;
}