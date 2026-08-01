import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * 導覽列分三組，順序即工作流程：
 * 匯入 → 審核與知識 → 使用（搜尋、問答、素材）→ 維運（匯出、設定）。
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "匯入",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/sources", label: "來源" },
      { href: "/import", label: "匯入包" },
    ],
  },
  {
    label: "知識",
    items: [
      { href: "/review", label: "候選事實" },
      { href: "/knowledge", label: "正式事實" },
      { href: "/entities", label: "實體" },
      { href: "/relations", label: "關聯" },
    ],
  },
  {
    label: "使用",
    items: [
      { href: "/search", label: "搜尋" },
      { href: "/ask", label: "問答" },
      { href: "/verify", label: "驗證" },
      { href: "/generate", label: "素材" },
    ],
  },
  {
    label: "維運",
    items: [
      { href: "/export", label: "匯出" },
      { href: "/history", label: "歷程" },
      { href: "/settings/models", label: "設定" },
    ],
  },
];

/** 登入後頁面的共用外框：導覽列 + 內容區。 */
export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          {/*
           * 手機上導覽列橫向捲動而不是折成三行：
           * 折行會把內容推到畫面外，捲動則維持單行且不影響版面高度。
           */}
          <nav className="-mx-1 flex flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden">
            {NAV_GROUPS.map((group, index) => (
              <span key={group.label} className="flex items-center gap-1">
                {index > 0 && (
                  <span
                    aria-hidden
                    className="mx-1 hidden h-4 w-px shrink-0 bg-slate-200 sm:block"
                  />
                )}
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </span>
            ))}
          </nav>
          <div className="shrink-0">
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold break-words text-slate-900">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
            )}
          </div>
          {actions}
        </div>

        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
