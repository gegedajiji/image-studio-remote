import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { SiteLayout } from "@/components/SiteLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  KeyRound,
  Copy,
  Check,
  Terminal,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="code-block overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <Terminal className="h-3.5 w-3.5" />
          {title}
        </span>
        <button onClick={copy} className="text-slate-500 hover:text-slate-700 transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-slate-600">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function ApiDocs() {
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";

  const curlExample = `curl -X POST ${origin}/api/v1/images/generations \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "月光下的古老森林，萤火虫飞舞，电影感光影",
    "negative_prompt": "模糊，变形",
    "model": "dream-v1",
    "size": "1024x1024"
  }'`;

  const pythonExample = `import requests

resp = requests.post(
    "${origin}/api/v1/images/generations",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json",
    },
    json={
        "prompt": "月光下的古老森林，萤火虫飞舞，电影感光影",
        "negative_prompt": "模糊，变形",
        "model": "dream-v1",
        "size": "1024x1024",
    },
    timeout=180,
)
print(resp.json())`;

  const jsExample = `const resp = await fetch("${origin}/api/v1/images/generations", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "月光下的古老森林，萤火虫飞舞，电影感光影",
    negative_prompt: "模糊，变形",
    model: "dream-v1",
    size: "1024x1024",
  }),
});
const data = await resp.json();
console.log(data.data[0].url);`;

  const successResponse = `{
  "id": 1024,
  "model": "dream-v1",
  "size": "1024x1024",
  "cost": 10,
  "data": [
    { "url": "https://.../generated-image.png" }
  ]
}`;

  const paramRows = [
    ["prompt", "string", true, t("docs.p1d")],
    ["negative_prompt", "string", false, t("docs.p2d")],
    ["model", "string", false, t("docs.p3d")],
    ["size", "string", false, t("docs.p4d")],
  ] as const;

  const errorRows = [
    ["400", t("docs.e400")],
    ["401", t("docs.e401")],
    ["402", t("docs.e402")],
    ["403", t("docs.e403")],
    ["500", t("docs.e500")],
    ["503", t("docs.e503")],
  ];

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12">
        {/* 头部 */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15">
            <BookOpen className="h-6 w-6 text-violet-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{t("docs.title")}</h1>
            <p className="text-slate-500 text-sm mt-1">{t("docs.subtitle")}</p>
          </div>
        </div>

        {/* 快速开始 */}
        <section className="glass-card rounded-2xl p-6 mt-8">
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <KeyRound className="h-5 w-5 text-amber-500" />
            {t("docs.quickStart")}
          </h2>
          <ol className="mt-4 space-y-3 text-sm text-slate-600">
            {[t("docs.step1"), t("docs.step2"), t("docs.step3")].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-600">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <Button
            className="mt-5 bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 text-white border-0"
            onClick={() => navigate(isAuthenticated ? "/settings" : "/login")}
          >
            {t("docs.getKey")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>

        {/* 接口说明 */}
        <section className="mt-8">
          <h2 className="text-xl font-bold mb-4 text-slate-900">{t("docs.genTitle")}</h2>
          <div className="glass-card rounded-2xl p-6 space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/40 font-mono">POST</Badge>
              <code className="text-sm text-slate-700 font-mono">/api/v1/images/generations</code>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-600 mb-2">{t("docs.headers")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-4 font-medium">{t("docs.field")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("docs.value")}</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600">
                    <tr className="border-b border-slate-200/60">
                      <td className="py-2.5 pr-4 font-mono text-xs">Authorization</td>
                      <td className="py-2.5 font-mono text-xs">Bearer YOUR_API_KEY</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-xs">Content-Type</td>
                      <td className="py-2.5 font-mono text-xs">application/json</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-600 mb-2">{t("docs.params")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-4 font-medium">{t("docs.param")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("docs.type")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("docs.required")}</th>
                      <th className="pb-2 font-medium">{t("docs.desc")}</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600">
                    {paramRows.map(([name, type, required, desc]) => (
                      <tr key={name} className="border-b border-slate-200/60">
                        <td className="py-2.5 pr-4 font-mono text-xs text-amber-600">{name}</td>
                        <td className="py-2.5 pr-4 font-mono text-xs">{type}</td>
                        <td className="py-2.5 pr-4">
                          <Badge className={required ? "bg-red-500/15 text-red-600 border-red-500/40" : "bg-slate-100 text-slate-500 border-slate-300"}>
                            {required ? t("docs.yes") : t("docs.no")}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-slate-500 text-xs">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-600 mb-2">{t("docs.response")}</h3>
              <CodeBlock title="200 OK" code={successResponse} />
            </div>

            <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
              <div className="text-sm text-amber-700">
                {t("docs.billingNote")}
              </div>
            </div>
          </div>
        </section>

        {/* 代码示例 */}
        <section className="mt-8 space-y-5">
          <h2 className="text-xl font-bold text-slate-900">{t("docs.examples")}</h2>
          <CodeBlock title="cURL" code={curlExample} />
          <CodeBlock title="Python" code={pythonExample} />
          <CodeBlock title="JavaScript / Node.js" code={jsExample} />
        </section>

        {/* 错误码 */}
        <section className="mt-8">
          <h2 className="text-xl font-bold mb-4 text-slate-900">{t("docs.errors")}</h2>
          <div className="glass-card rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-white/70 text-left text-slate-500">
                  <th className="px-5 py-3 font-medium">{t("docs.statusCode")}</th>
                  <th className="px-5 py-3 font-medium">{t("docs.desc")}</th>
                </tr>
              </thead>
              <tbody className="text-slate-600">
                {errorRows.map(([code, desc]) => (
                  <tr key={code} className="border-b border-slate-200/60 last:border-0">
                    <td className="px-5 py-3 font-mono text-amber-600">{code}</td>
                    <td className="px-5 py-3 text-slate-500">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
