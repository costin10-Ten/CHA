import { Badge } from "@/components/ui/badge";
import {
  PROPOSITION_TYPE_CLASS,
  PROPOSITION_TYPE_LABEL,
  UNCATEGORIZED_LABEL,
} from "@/lib/facts/labels";
import type { PropositionType } from "@/lib/supabase/types";

/**
 * 原子命題的分類標籤。
 *
 * 分類可複選，所以這裡一律畫成一組標籤而不是單一欄位。
 * 空陣列畫成「未分類」而不是留白——留白看起來像資料掉了。
 */
export function TypeBadges({
  types,
  className,
}: {
  types: PropositionType[];
  className?: string;
}) {
  if (types.length === 0) {
    return (
      <Badge className={`bg-slate-100 text-slate-500 ${className ?? ""}`}>
        {UNCATEGORIZED_LABEL}
      </Badge>
    );
  }

  return (
    <>
      {types.map((type) => (
        <Badge
          key={type}
          className={`${PROPOSITION_TYPE_CLASS[type] ?? "bg-slate-100 text-slate-700"} ${className ?? ""}`}
        >
          {PROPOSITION_TYPE_LABEL[type] ?? type}
        </Badge>
      ))}
    </>
  );
}
