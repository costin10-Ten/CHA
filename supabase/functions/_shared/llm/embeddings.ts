/**
 * Embedding 抽象層。
 * 與生成模型一樣提供 mock 與 OpenAI 兩種實作，維度固定 1536，
 * 與 embedding_records.embedding 的欄位定義一致。
 */

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/** 32-bit FNV-1a，供 Mock 產生確定性向量。 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalize(vector: number[]): number[] {
  const length = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );
  if (length === 0) return vector;
  return vector.map((value) => value / length);
}

/**
 * Mock Embedding：把字元 bigram 雜湊進固定維度後正規化。
 *
 * 不具語意，但同樣的文字一定得到同樣的向量，且用字重疊的句子相似度較高，
 * 足以在不呼叫付費 API 的情況下驗證索引、增量更新與相似度搜尋。
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(readonly model: string = "mock-embedding-1") {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      const normalized = text.replace(/\s+/g, "");

      for (let index = 0; index < normalized.length; index += 1) {
        const unigram = normalized[index];
        const bigram = normalized.slice(index, index + 2);
        vector[hash32(unigram) % this.dimensions] += 1;
        if (bigram.length === 2) {
          vector[hash32(bigram) % this.dimensions] += 2;
        }
      }

      return normalize(vector);
    });
  }
}

/** OpenAI 相容的 embeddings API。 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: EmbeddingConfig) {
    if (!config.apiKey) throw new Error("OpenAI embedding provider 缺少 API key");
    this.apiKey = config.apiKey;
    this.model = config.model || "text-embedding-3-small";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Embedding API 失敗（HTTP ${response.status}）：${detail.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };

    const sorted = (payload.data ?? []).sort((a, b) => a.index - b.index);
    if (sorted.length !== texts.length) {
      throw new Error("Embedding 回應數量與輸入不符");
    }

    return sorted.map((item) => item.embedding);
  }
}

export function createEmbeddingProvider(
  config: EmbeddingConfig,
): EmbeddingProvider {
  const provider = (config.provider ?? "mock").toLowerCase();

  switch (provider) {
    case "openai":
      return new OpenAiEmbeddingProvider(config);
    case "mock":
      return new MockEmbeddingProvider(config.model || undefined);
    default:
      throw new Error(
        `未知的 embedding provider：${provider}（可用 mock、openai）`,
      );
  }
}

/** 餘弦相似度，供測試與本機驗證使用。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("向量維度不一致");
  let dot = 0;
  let lengthA = 0;
  let lengthB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    lengthA += a[index] * a[index];
    lengthB += b[index] * b[index];
  }
  if (lengthA === 0 || lengthB === 0) return 0;
  return dot / (Math.sqrt(lengthA) * Math.sqrt(lengthB));
}
