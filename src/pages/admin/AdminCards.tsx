import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, Copy, Ban, RotateCcw, Ticket, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  unused: { label: "未使用", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  redeemed: { label: "已兑换", cls: "bg-zinc-700/60 text-slate-600 border-zinc-600" },
  disabled: { label: "已禁用", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
};

export default function AdminCards() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"all" | "unused" | "redeemed" | "disabled">("all");
  const listQuery = trpc.admin.cards.list.useQuery({ status, limit: 200 });

  const [genOpen, setGenOpen] = useState(false);
  const [count, setCount] = useState(10);
  const [credits, setCredits] = useState(100);
  const [remark, setRemark] = useState("");
  const [lastBatch, setLastBatch] = useState<{ batchNo: string; codes: string[] } | null>(null);

  const generateMutation = trpc.admin.cards.generate.useMutation({
    onSuccess: (res) => {
      toast.success(`已生成 ${res.codes.length} 张卡密`);
      setLastBatch(res);
      setGenOpen(false);
      utils.admin.cards.list.invalidate();
      utils.admin.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setStatusMutation = trpc.admin.cards.setStatus.useMutation({
    onSuccess: () => {
      toast.success("已更新");
      utils.admin.cards.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const copyAll = (codes: string[]) => {
    navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("已复制全部卡密"));
  };

  const exportTxt = (batch: { batchNo: string; codes: string[] }) => {
    const blob = new Blob([batch.codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `卡密-${batch.batchNo}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold">卡密管理</h2>
          <p className="text-sm text-slate-500">批量生成充值卡密，用户兑换后获得生图额度</p>
        </div>
        <Button
          className="bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white border-0"
          onClick={() => setGenOpen(true)}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          生成卡密
        </Button>
      </div>

      {/* 最新批次结果 */}
      {lastBatch && (
        <div className="glass-card rounded-2xl p-5 mb-5 border-emerald-500/30">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-emerald-400" />
              <span className="font-semibold text-emerald-300">
                批次 {lastBatch.batchNo} · {lastBatch.codes.length} 张
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-slate-300"
                onClick={() => copyAll(lastBatch.codes)}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                复制全部
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-300"
                onClick={() => exportTxt(lastBatch)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                导出 TXT
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLastBatch(null)}>
                收起
              </Button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-xl bg-white border border-slate-200 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 font-mono text-xs text-slate-600">
              {lastBatch.codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)} className="mb-4">
        <TabsList className="bg-white border border-slate-200">
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="unused">未使用</TabsTrigger>
          <TabsTrigger value="redeemed">已兑换</TabsTrigger>
          <TabsTrigger value="disabled">已禁用</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white/70 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">卡密</th>
                <th className="px-4 py-3 font-medium">面值</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">批次</th>
                <th className="px-4 py-3 font-medium">兑换用户</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(listQuery.data ?? []).map((card) => {
                const meta = STATUS_META[card.status] ?? STATUS_META.unused;
                return (
                  <tr key={card.id} className="border-b border-slate-200/60 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{card.code}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                        {card.credits} 积分
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn("border", meta.cls)}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{card.batchNo ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {card.redeemedByName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(card.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(card.code);
                            toast.success("已复制");
                          }}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          title="复制"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        {card.status === "unused" && (
                          <button
                            onClick={() => setStatusMutation.mutate({ id: card.id, status: "disabled" })}
                            className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                            title="禁用"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                        {card.status === "disabled" && (
                          <button
                            onClick={() => setStatusMutation.mutate({ id: card.id, status: "unused" })}
                            className="rounded-lg p-2 text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-400"
                            title="恢复"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {listQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    暂无卡密
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 生成卡密对话框 */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-cyan-400" />
              批量生成卡密
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>数量</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={count}
                  onChange={(e) => setCount(Math.min(200, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="bg-white border-slate-300"
                />
              </div>
              <div className="grid gap-2">
                <Label>单张面值（积分）</Label>
                <Input
                  type="number"
                  min={1}
                  value={credits}
                  onChange={(e) => setCredits(Math.max(1, parseInt(e.target.value) || 1))}
                  className="bg-white border-slate-300"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>备注（可选）</Label>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="例如：五一活动批次"
                className="bg-white border-slate-300"
              />
            </div>
            <p className="text-xs text-slate-500">
              将生成 {count} 张卡密，每张可兑换 {credits} 积分，总计 {count * credits} 积分
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-300" onClick={() => setGenOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white border-0"
              disabled={generateMutation.isPending}
              onClick={() =>
                generateMutation.mutate({ count, credits, remark: remark || undefined })
              }
            >
              {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
