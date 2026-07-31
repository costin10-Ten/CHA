/**
 * 模型抽象層。
 *
 * 所有 provider 只透過 fetch 與 Web 標準 API 實作，
 * 因此 Deno（Edge Function）與 Vitest（測試）都能執行同一份程式碼。
 * 測試與 CI 一律使用 MockProvider，不會呼叫任何付費 API。
 */

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 要求模型輸出符合此 JSON Schema 的物件。 */
  jsonSchema?: JsonSchema;
}

export interface LlmResponse {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/** 粗略估算 token 數：中文約 1.5 字／token，英文約 4 字元／token。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}
