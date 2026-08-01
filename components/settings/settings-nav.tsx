import Link from "next/link";

const TABS = [
  { href: "/settings/models", label: "模型與用量" },
  { href: "/settings/prompts", label: "提示詞與回報" },
  { href: "/settings/account", label: "帳號與資料" },
];

/** 設定頁共用的子導覽。current 傳入目前頁面的 href。 */
export function SettingsNav({ current }: { current: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`rounded-full border px-3 py-1 text-sm ${
            current === tab.href
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 text-slate-600 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
