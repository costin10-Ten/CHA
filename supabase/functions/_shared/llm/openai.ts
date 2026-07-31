import {
  estimateTokens,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ProviderConfig,
} from "./types.ts";

/** OpenAI 相容 API（可用 baseUrl 指向任何相容服務）。 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) throw new Error("OpenAI provider 缺少 API key");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();

    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.maxTokens ?? 4000,
    };

    if (request.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          strict: false,
          schema: request.jsonSchema.schema,
        },
      };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `OpenAI API 失敗（HTTP ${response.status}）：${detail.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = payload.choices?.[0]?.message?.content ?? "";

    return {
      text,
      model: this.model,
      provider: this.name,
      inputTokens:
        payload.usage?.prompt_tokens ??
        estimateTokens(request.messages.map((m) => m.content).join("\n")),
      outputTokens: payload.usage?.completion_tokens ?? estimateTokens(text),
      latencyMs: Date.now() - started,
    };
  }
}
