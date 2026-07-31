/** 以 Web Crypto 計算 SHA-256，回傳小寫十六進位字串。 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 計算內容雜湊前先正規化，避免只有空白或換行差異就被當成新版本：
 * 統一換行、移除行尾空白、壓縮連續空行、去除頭尾空白。
 */
export function normalizeForHash(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function contentHash(input: string): Promise<string> {
  return sha256Hex(normalizeForHash(input));
}
