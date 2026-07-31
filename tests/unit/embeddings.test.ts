// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  MockEmbeddingProvider,
  cosineSimilarity,
  createEmbeddingProvider,
} from "@shared/llm/embeddings.ts";

describe("createEmbeddingProvider", () => {
  it("預設使用 mock，測試不會呼叫付費 API", () => {
    expect(createEmbeddingProvider({}).name).toBe("mock");
  });

  it("未知 provider 明確報錯", () => {
    expect(() => createEmbeddingProvider({ provider: "cohere" })).toThrowError(
      /未知的 embedding provider/,
    );
  });

  it("openai provider 缺少 key 時報錯", () => {
    expect(() => createEmbeddingProvider({ provider: "openai" })).toThrowError(
      /缺少 API key/,
    );
  });
});

describe("MockEmbeddingProvider", () => {
  const provider = new MockEmbeddingProvider();

  it("維度與資料表定義一致", async () => {
    const [vector] = await provider.embed(["氫氟酸具有腐蝕性。"]);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("同樣的文字得到同樣的向量", async () => {
    const [a] = await provider.embed(["甲基汞會累積於大型魚類。"]);
    const [b] = await provider.embed(["甲基汞會累積於大型魚類。"]);
    expect(a).toEqual(b);
  });

  it("向量已正規化（長度為 1）", async () => {
    const [vector] = await provider.embed(["蘇丹紅禁止用於食品。"]);
    const length = Math.sqrt(vector.reduce((total, v) => total + v * v, 0));
    expect(length).toBeCloseTo(1, 5);
  });

  it("一次可處理多筆並保持順序", async () => {
    const vectors = await provider.embed(["第一句。", "第二句。", "第三句。"]);
    expect(vectors).toHaveLength(3);
    const [first] = await provider.embed(["第一句。"]);
    expect(vectors[0]).toEqual(first);
  });

  it("用字重疊的句子相似度高於無關句子", async () => {
    const [related, sameTopic, unrelated] = await provider.embed([
      "甲基汞會累積於大型魚類。",
      "甲基汞會累積於鮪魚等大型魚類體內。",
      "颱風假由地方政府宣布。",
    ]);

    expect(cosineSimilarity(related, sameTopic)).toBeGreaterThan(
      cosineSimilarity(related, unrelated),
    );
  });
});

describe("cosineSimilarity", () => {
  it("相同向量為 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("正交向量為 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("零向量回傳 0 而不是 NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("維度不一致時報錯", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrowError(/維度不一致/);
  });
});
