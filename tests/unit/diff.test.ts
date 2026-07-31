// @vitest-environment node
import { describe, expect, it } from "vitest";

import { diffVersions, type StoredBlock } from "@shared/diff.ts";
import { parseDocument } from "@shared/parse.ts";
import type { ParsedBlock } from "@shared/types.ts";

async function blocksOf(raw: string): Promise<ParsedBlock[]> {
  const parsed = await parseDocument({ kind: "text", raw });
  return parsed.blocks;
}

function stored(blocks: ParsedBlock[]): StoredBlock[] {
  return blocks.map((block) => ({
    paragraphId: block.paragraphId,
    contentHash: block.contentHash,
  }));
}

describe("diffVersions", () => {
  it("內容完全相同時沒有變更", async () => {
    const blocks = await blocksOf("第一段。\n\n第二段。");
    const diff = diffVersions(stored(blocks), blocks);

    expect(diff.hasChanges).toBe(false);
    expect(diff.unchangedCount).toBe(2);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("只修改一段時只標記該段", async () => {
    const previous = await blocksOf("第一段。\n\n第二段。\n\n第三段。");
    const next = await blocksOf("第一段。\n\n第二段改寫。\n\n第三段。");

    const diff = diffVersions(stored(previous), next);

    expect(diff.changed).toEqual(["P-002"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchangedCount).toBe(2);
    expect(diff.hasChanges).toBe(true);
  });

  it("新增段落標記為 added", async () => {
    const previous = await blocksOf("第一段。\n\n第二段。");
    const next = await blocksOf("第一段。\n\n第二段。\n\n第三段。");

    const diff = diffVersions(stored(previous), next);

    expect(diff.added).toEqual(["P-003"]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchangedCount).toBe(2);
  });

  it("刪除段落標記為 removed", async () => {
    const previous = await blocksOf("第一段。\n\n第二段。\n\n第三段。");
    const next = await blocksOf("第一段。\n\n第三段。");

    const diff = diffVersions(stored(previous), next);

    // removed 記的是「舊版中消失的段落編號」：被刪掉的是舊版的 P-002。
    expect(diff.removed).toEqual(["P-002"]);
    expect(diff.unchangedCount).toBe(2);
  });

  it("段落位移但內容不變時視為未變更", async () => {
    const previous = await blocksOf("第一段。\n\n第二段。");
    const next = await blocksOf("新的開頭段。\n\n第一段。\n\n第二段。");

    const diff = diffVersions(stored(previous), next);

    expect(diff.unchangedCount).toBe(2);
    // 位移後的新內容出現在既有編號上，因此記為 changed，而非重新處理全部段落。
    expect(diff.changed.length + diff.added.length).toBe(1);
  });
});
