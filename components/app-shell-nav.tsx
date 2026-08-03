"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

/**
 * 判斷目前在哪一頁。
 *
 * 用前綴比對，但要求下一個字元是 `/`，否則 `/pkb` 會把 `/pkbxxx` 也算進來。
 * `/pkb` 與 `/pkb/import` 都會命中時，取最長的那一個——
 * 否則進到子頁時父項也亮著，看不出實際位置。
 */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  const matches = hrefs.filter(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.length > a.length ? b : a));
}

function NavLinks({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const current = activeHref(
    pathname,
    groups.flatMap((group) => group.items.map((item) => item.href)),
  );

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-2.5 pb-1 text-xs font-semibold tracking-wide text-slate-400">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={current === item.href ? "page" : undefined}
                  className={`block rounded px-2.5 py-1.5 text-sm ${
                    current === item.href
                      ? "bg-slate-900 font-medium text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * 導覽列。
 *
 * 桌機：固定在左側的側邊欄。項目已經超過二十個，橫向排一列會擠成一團，
 *       分組標題也沒地方放。
 * 手機：右上角按鈕開啟的抽屜，從右側滑出——單手拿手機時右上角最好按。
 */
export function AppNav({
  groups,
  signOut,
}: {
  groups: NavGroup[];
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 換頁後把抽屜關掉，否則點完連結它會留在畫面上。
  useEffect(() => setOpen(false), [pathname]);

  // 抽屜開著時鎖住背景捲動，不然滑動會穿透到底下的頁面。
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Esc 關閉：抽屜是暫時性的介面，鍵盤要有退路。
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* 桌機：左側側邊欄 */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="border-b border-slate-100 px-4 py-4">
            <p className="text-sm font-semibold text-slate-900">CHA</p>
            <p className="text-xs text-slate-500">知識庫與風險溝通</p>
          </div>
          <nav aria-label="主導覽" className="flex-1 overflow-y-auto px-2 py-4">
            <NavLinks groups={groups} pathname={pathname} />
          </nav>
          <div className="border-t border-slate-100 p-3">{signOut}</div>
        </div>
      </aside>

      {/* 手機：頂端列 + 右側抽屜 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">CHA</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            選單
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="關閉選單"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-900/40"
          />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-900">選單</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                關閉
              </button>
            </div>
            <nav aria-label="主導覽" className="flex-1 overflow-y-auto px-2 py-4">
              <NavLinks
                groups={groups}
                pathname={pathname}
                onNavigate={() => setOpen(false)}
              />
            </nav>
            <div className="border-t border-slate-100 p-3">{signOut}</div>
          </div>
        </div>
      )}
    </>
  );
}
