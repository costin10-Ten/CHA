import { AppNav, type NavGroup } from "@/components/app-shell-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * 導覽分組，順序即工作流程：
 * 匯入 → 審核與知識 → 使用（搜尋、問答、素材）→ 維運（匯出、設定），
 * 最後是獨立的個人原子知識庫。
 */
const NAV_GROUPS: NavGroup[] = [
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
      { href: "/review", label: "候選原子命題" },
      { href: "/knowledge", label: "正式原子命題" },
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
  {
    label: "個人原子知識庫",
    items: [
      { href: "/pkb", label: "知識庫" },
      { href: "/pkb/import", label: "匯入" },
      { href: "/pkb/search", label: "搜尋" },
      { href: "/pkb/export", label: "匯出給 LLM" },
      { href: "/pkb/trash", label: "垃圾桶" },
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
    <div className="min-h-screen bg-slate-50 lg:flex">
      <AppNav groups={NAV_GROUPS} signOut={<SignOutButton />} />

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold break-words text-slate-900">
                {title}
              </h1>
              {description && (
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  {description}
                </p>
              )}
            </div>
            {actions}
          </div>

          <div className="mt-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
