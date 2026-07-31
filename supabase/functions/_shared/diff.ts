import type { ParsedBlock, VersionDiff } from "./types.ts";

export interface StoredBlock {
  paragraphId: string;
  contentHash: string;
}

/**
 * 比對新舊版本的段落，找出實際變更範圍（工作單第 16 節）。
 *
 * 規則：
 * - 內容雜湊相同 → 未變動（即使段落編號位移）
 * - 舊有雜湊消失、同編號出現新雜湊 → changed
 * - 只在新版出現 → added
 * - 只在舊版出現 → removed
 *
 * 後續只需重新處理 added 與 changed 的段落。
 */
export function diffVersions(
  previous: StoredBlock[],
  next: ParsedBlock[],
): VersionDiff {
  const previousHashes = new Map<string, string[]>();
  for (const block of previous) {
    const list = previousHashes.get(block.contentHash) ?? [];
    list.push(block.paragraphId);
    previousHashes.set(block.contentHash, list);
  }

  const previousById = new Map(previous.map((b) => [b.paragraphId, b.contentHash]));
  const nextHashes = new Set(next.map((b) => b.contentHash));

  const added: string[] = [];
  const changed: string[] = [];
  let unchangedCount = 0;

  const consumed = new Map(previousHashes);

  for (const block of next) {
    const matches = consumed.get(block.contentHash);
    if (matches && matches.length > 0) {
      matches.shift();
      if (matches.length === 0) consumed.delete(block.contentHash);
      unchangedCount += 1;
      continue;
    }

    // 同一個段落編號存在但內容不同 → 視為修改而非新增。
    if (previousById.has(block.paragraphId)) {
      changed.push(block.paragraphId);
    } else {
      added.push(block.paragraphId);
    }
  }

  const removed = previous
    .filter((block) => !nextHashes.has(block.contentHash))
    .map((block) => block.paragraphId)
    .filter((id) => !changed.includes(id));

  return {
    added,
    removed,
    changed,
    unchangedCount,
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}
