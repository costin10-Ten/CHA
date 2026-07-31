import {
  estimateTokens,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ProviderConfig,
} from "./types.ts";

const ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic Messages API。 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) throw new Error("Anthropic provider 缺少 API key");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(
      /\/$/,
      "",
    );
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();

    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        system: system || undefined,
        messages,
        temperature: request.temperature ?? 0,
        max_tokens: request.maxTokens ?? 4000,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Anthropic API 失敗（HTTP ${response.status}）：${detail.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    return {
      text,
      model: this.model,
      provider: this.name,
      inputTokens:
        payload.usage?.input_tokens ??
        estimateTokens(request.messages.map((m) => m.content).join("\n")),
      outputTokens: payload.usage?.output_tokens ?? estimateTokens(text),
      latencyMs: Date.now() - started,
    };
  }
}
