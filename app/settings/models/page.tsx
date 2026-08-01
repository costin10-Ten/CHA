import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { SettingsNav } from "@/components/settings/settings-nav";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getModelUsage } from "@/lib/settings/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "模型與用量" };
export const dynamic = "force-dynamic";

/**
 * 模型設定只顯示「目前生效的設定」，不顯示也不接受金鑰輸入。
 * 金鑰只存在於伺服器環境變數，永遠不會送到瀏覽器。
 */
function currentConfig() {
  const provider = process.env.LLM_PROVIDER ?? "mock";
  const embeddingProvider =
    process.env.EMBEDDING_PROVIDER ?? process.env.LLM_PROVIDER ?? "mock";

  return {
    provider,
    model: process.env.LLM_MODEL || "（使用 provider 預設）",
    embeddingProvider,
    embeddingModel: process.env.EMBEDDING_MODEL || "（使用 provider 預設）",
    // 只回報「有沒有設定」，不回報內容。
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasCronSecret: Boolean(process.env.CRON_SECRET),
  };
}

export default async function ModelSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/settings/models");

  const config = currentConfig();
  const usage = await getModelUsage().catch(() => []);
  const isMock = config.provider === "mock";

  const totals = usage.reduce(
    (sum, item) => ({
      runs: sum.runs + item.runs,
      inputTokens: sum.inputTokens + item.inputTokens,
      outputTokens: sum.outputTokens + item.outputTokens,
      failures: sum.failures + item.failures,
    }),
    { runs: 0, inputTokens: 0, outputTokens: 0, failures: 0 },
  );

  return (
    <AppShell
      title="模型與用量"
      description="目前生效的模型設定與 API 用量。金鑰只存在於伺服器環境變數，不會出現在這個頁面。"
    >
      <SettingsNav current="/settings/models" />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>目前設定</CardTitle>
            <CardDescription>
              由部署環境的環境變數決定。要更換模型請到 Vercel
              修改環境變數後重新部署。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Row label="生成 Provider">
                <span className="flex items-center gap-2">
                  {config.provider}
                  {isMock && (
                    <Badge className="bg-slate-100 text-slate-700">
                      不呼叫外部 API
                    </Badge>
                  )}
                </span>
              </Row>
              <Row label="生成模型">{config.model}</Row>
              <Row label="Embedding Provider">{config.embeddingProvider}</Row>
              <Row label="Embedding 模型">{config.embeddingModel}</Row>
              <Row label="OPENAI_API_KEY">
                <KeyState present={config.hasOpenAiKey} />
              </Row>
              <Row label="ANTHROPIC_API_KEY">
                <KeyState present={config.hasAnthropicKey} />
              </Row>
              <Row label="CRON_SECRET">
                <KeyState present={config.hasCronSecret} />
              </Row>
            </dl>

            {isMock && (
              <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                目前使用 Mock Provider：抽取、問答與素材產製都不會呼叫付費 API，
                輸出是依證據包產生的確定性內容。 要改用真實模型，設定{" "}
                <code>LLM_PROVIDER</code>（<code>openai</code> 或{" "}
                <code>anthropic</code>）與對應金鑰後重新部署。
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>用量統計</CardTitle>
            <CardDescription>
              最近 1000 次模型呼叫，依 provider 與模型分組。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usage.length === 0 ? (
              <p className="text-sm text-slate-500">
                還沒有模型呼叫紀錄。執行一次抽取或問答後就會出現。
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="py-2 pr-3">Provider／模型</th>
                      <th className="py-2 pr-3 text-right">呼叫次數</th>
                      <th className="py-2 pr-3 text-right">輸入 tokens</th>
                      <th className="py-2 pr-3 text-right">輸出 tokens</th>
                      <th className="py-2 text-right">失敗</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((item) => (
                      <tr
                        key={`${item.provider}-${item.model}`}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="py-2 pr-3 text-slate-900">
                          {item.provider}／{item.model}
                        </td>
                        <td className="py-2 pr-3 text-right">{item.runs}</td>
                        <td className="py-2 pr-3 text-right">
                          {item.inputTokens.toLocaleString("zh-TW")}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {item.outputTokens.toLocaleString("zh-TW")}
                        </td>
                        <td className="py-2 text-right">
                          {item.failures > 0 ? (
                            <span className="text-red-700">{item.failures}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 font-medium">
                      <td className="py-2 pr-3">合計</td>
                      <td className="py-2 pr-3 text-right">{totals.runs}</td>
                      <td className="py-2 pr-3 text-right">
                        {totals.inputTokens.toLocaleString("zh-TW")}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {totals.outputTokens.toLocaleString("zh-TW")}
                      </td>
                      <td className="py-2 text-right">{totals.failures}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-slate-200 px-3 py-2">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function KeyState({ present }: { present: boolean }) {
  return present ? (
    <Badge className="bg-emerald-100 text-emerald-800">已設定</Badge>
  ) : (
    <Badge className="bg-slate-100 text-slate-600">未設定</Badge>
  );
}
