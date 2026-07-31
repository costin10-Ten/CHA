import { AnthropicProvider } from "./anthropic.ts";
import { MockProvider } from "./mock.ts";
import { OpenAiProvider } from "./openai.ts";
import type { LlmProvider, ProviderConfig } from "./types.ts";

export const DEFAULT_MODELS: Record<string, string> = {
  mock: "mock-extractor-1",
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
};

/**
 * 依設定建立 provider。
 * 未指定或指定 mock 時一律回傳 MockProvider —— 測試與 CI 不會呼叫付費 API。
 */
export function createProvider(config: Partial<ProviderConfig>): LlmProvider {
  const provider = (config.provider ?? "mock").toLowerCase();
  const model = config.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.mock;

  switch (provider) {
    case "openai":
      return new OpenAiProvider({
        ...config,
        provider,
        model,
        apiKey: config.apiKey,
      });
    case "anthropic":
      return new AnthropicProvider({
        ...config,
        provider,
        model,
        apiKey: config.apiKey,
      });
    case "mock":
      return new MockProvider(model);
    default:
      throw new Error(
        `未知的 LLM_PROVIDER：${provider}（可用 mock、openai、anthropic）`,
      );
  }
}
