import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { PORTAL_COOKIE } from "@/lib/portal/security";
export function proxy(request:NextRequest){const path=request.nextUrl.pathname;if(path.startsWith("/portal")){if(path==="/portal/login"||path==="/portal/activate")return NextResponse.next();if(!request.cookies.has(PORTAL_COOKIE))return NextResponse.redirect(new URL("/portal/login",request.url));return NextResponse.next()}if(path.startsWith("/api/portal/")||path==="/login")return NextResponse.next();if(!request.cookies.has(SESSION_COOKIE_NAME))return NextResponse.redirect(new URL("/login",request.url));return NextResponse.next()}
export const config={matcher:["/((?!api/health|api/signatures/webhook|_next/static|_next/image|favicon.ico).*)"]};
