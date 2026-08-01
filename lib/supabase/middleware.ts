import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/** 需要登入才能存取的路徑前綴。 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/sources",
  "/review",
  "/knowledge",
  "/entities",
  "/relations",
  "/search",
  "/ask",
  "/verify",
  "/generate",
  "/export",
  "/history",
  "/settings",
];
// 注意：/api/export 不放在這裡。API 由 Route Handler 自行回 401，
// 走 middleware 會導向登入頁的 HTML，對下載請求沒有意義。

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * 於 middleware 中刷新 Supabase session，並保護需登入的路徑。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // 尚未設定 Supabase 時：需要登入的路徑導回首頁看設定指引。
  //
  // 這種情況最常見於 Vercel 只把環境變數加到 Production，
  // Preview Deployment 沒有值。若放行，頁面會在讀取登入狀態時整頁失敗，
  // 使用者只看得到一組 Digest。導回首頁至少說得出原因。
  if (!isSupabaseConfigured()) {
    if (isProtectedPath(request.nextUrl.pathname)) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      home.searchParams.set("setup", "required");
      return NextResponse.redirect(home);
    }
    return response;
  }

  const env = getPublicEnv();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}
