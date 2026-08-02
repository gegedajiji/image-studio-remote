import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  success: { label: "成功", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  failed: { label: "失败", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  pending: { label: "进行中", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
};

export default function AdminGenerations() {
  const [status, setStatus] = useState<"all" | "pending" | "success" | "failed">("all");
  const listQuery = trpc.admin.generations.useQuery({ status, limit: 100 });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold">生图历史</h2>
          <p className="text-sm text-slate-500">全平台用户的生成记录</p>
        </div>
        <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="success">成功</TabsTrigger>
            <TabsTrigger value="failed">失败</TabsTrigger>
            <TabsTrigger value="pending">进行中</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {listQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-white/70 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">图片</th>
                  <th className="px-4 py-3 font-medium">提示词</th>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">模型 / 尺寸</th>
                  <th className="px-4 py-3 font-medium">费用</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {(listQuery.data ?? []).map((g) => {
                  const meta = STATUS_META[g.status] ?? STATUS_META.pending;
                  return (
                    <tr key={g.id} className="border-b border-slate-200/60 last:border-0 align-top">
                      <td className="px-4 py-3">
                        {g.imageUrl && g.status === "success" ? (
                          <a href={g.imageUrl} target="_blank" rel="noreferrer">
                            <img
                              src={g.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-14 w-14 rounded-lg object-cover border border-slate-200"
                            />
                          </a>
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100/70 text-slate-400">
                            <ImageOff className="h-5 w-5" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <p className="text-slate-600 text-xs line-clamp-3">{g.prompt}</p>
                        {g.status === "failed" && g.errorMsg && (
                          <p className="mt-1 text-xs text-red-400/80 line-clamp-2">{g.errorMsg}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {g.userName ?? `#${g.userId}`}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        <span className="font-mono">{g.model}</span>
                        <br />
                        {g.width}×{g.height}
                      </td>
                      <td className="px-4 py-3 font-mono text-amber-300">{g.cost}</td>
                      <td className="px-4 py-3">
                        <Badge className={cn("border", meta.cls)}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(g.createdAt).toLocaleString("zh-CN")}
                      </td>
                    </tr>
                  );
                })}
                {listQuery.data?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      暂无记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
