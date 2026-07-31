/**
 * 從瀏覽器呼叫 Edge Function 時，supabase-js 會帶自訂標頭（authorization、apikey…），
 * 因此瀏覽器會先送 OPTIONS preflight。
 * 沒有正確回應 preflight 的話，實際的 POST 根本不會送出。
 */

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

/** preflight 直接回 204。 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
