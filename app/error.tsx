"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 頁面層級的錯誤邊界。
 *
 * 沒有這個檔案時，伺服器端例外只會顯示
 * 「Application error: a server-side exception has occurred」加一組 Digest，
 * 使用者無從判斷是環境變數沒設、migration 沒套用，還是程式有問題。
 * 這裡把 Digest 與最常見的原因一起列出來，至少能自己先排除兩種情況。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">這個頁面載入失敗</h1>

        <p className="mt-2 text-sm text-slate-600">
          伺服器端發生例外。詳細訊息在 Vercel 的 Logs（Deployment → Runtime
          Logs），這裡只顯示可以對照的識別碼。
        </p>

        {error.digest && (
          <p className="mt-4 rounded-md border border-slate-200 bg-white p-3 font-mono text-sm text-slate-800">
            Digest: {error.digest}
          </p>
        )}

        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">最常見的兩個原因</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium">環境變數只加到 Production</span>：
              Vercel → Settings → Environment Variables，確認每個變數的 Environments
              也勾了 Preview，改完重新部署。
            </li>
            <li>
              <span className="font-medium">資料庫還沒套用最新的 migration</span>：
              到 GitHub Actions 確認「Supabase Migrations」這個 workflow 是綠燈。
            </li>
          </ol>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            重試
          </button>
          <Link
            href="/"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
          >
            回首頁
          </Link>
        </div>
      </div>
    </main>
  );
}
