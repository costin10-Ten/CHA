import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sources", label: "來源" },
  { href: "/review", label: "候選事實" },
  { href: "/knowledge", label: "正式事實" },
  { href: "/entities", label: "實體" },
  { href: "/relations", label: "關聯" },
  { href: "/search", label: "搜尋" },
  { href: "/ask", label: "問答" },
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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
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
