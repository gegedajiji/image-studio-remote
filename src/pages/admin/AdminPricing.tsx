import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ModelPricing } from "@contracts/types";

type FormState = {
  id?: number;
  model: string;
  label: string;
  width: number;
  height: number;
  price: number;
  enabled: boolean;
};

const EMPTY: FormState = {
  model: "dream-v1",
  label: "",
  width: 1024,
  height: 1024,
  price: 10,
  enabled: true,
};

export default function AdminPricing() {
  const utils = trpc.useUtils();
  const listQuery = trpc.admin.pricing.list.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<ModelPricing | null>(null);

  const invalidate = () => {
    utils.admin.pricing.list.invalidate();
    utils.generation.pricing.invalidate();
  };

  const createMutation = trpc.admin.pricing.create.useMutation({
    onSuccess: () => {
      toast.success("价格项已创建");
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.admin.pricing.update.useMutation({
    onSuccess: () => {
      toast.success("已保存");
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeMutation = trpc.admin.pricing.remove.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (p: ModelPricing) => {
    setForm({
      id: p.id,
      model: p.model,
      label: p.label,
      width: p.width,
      height: p.height,
      price: p.price,
      enabled: p.enabled,
    });
    setOpen(true);
  };

  const submit = () => {
    if (!form.model.trim() || !form.label.trim()) {
      toast.error("请填写模型与显示名称");
      return;
    }
    if (form.id) {
      updateMutation.mutate({
        id: form.id,
        label: form.label,
        width: form.width,
        height: form.height,
        price: form.price,
        enabled: form.enabled,
      });
    } else {
      createMutation.mutate({
        model: form.model,
        label: form.label,
        width: form.width,
        height: form.height,
        price: form.price,
      });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">生图价格</h2>
          <p className="text-sm text-slate-500">按模型与尺寸配置每次生成的积分价格</p>
        </div>
        <Button
          className="bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white border-0"
          onClick={() => {
            setForm(EMPTY);
            setOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          新增价格项
        </Button>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white/70 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">显示名称</th>
                <th className="px-4 py-3 font-medium">模型</th>
                <th className="px-4 py-3 font-medium">尺寸</th>
                <th className="px-4 py-3 font-medium">价格</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(listQuery.data ?? []).map((p) => (
                <tr key={p.id} className="border-b border-slate-200/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-700">{p.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.model}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {p.width}×{p.height}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                      {p.price} 积分
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={p.enabled}
                      onCheckedChange={(checked) =>
                        updateMutation.mutate({
                          id: p.id,
                          label: p.label,
                          width: p.width,
                          height: p.height,
                          price: p.price,
                          enabled: checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {listQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    暂无价格配置
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑对话框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "编辑价格项" : "新增价格项"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!form.id && (
              <div className="grid gap-2">
                <Label>模型标识</Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="与上游配置的模型一致"
                  className="bg-white border-slate-300 font-mono"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label>显示名称</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：梦幻 v1 · 方形 1024×1024"
                className="bg-white border-slate-300"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>宽</Label>
                <Input
                  type="number"
                  value={form.width}
                  onChange={(e) => setForm({ ...form, width: parseInt(e.target.value) || 1024 })}
                  className="bg-white border-slate-300"
                />
              </div>
              <div className="grid gap-2">
                <Label>高</Label>
                <Input
                  type="number"
                  value={form.height}
                  onChange={(e) => setForm({ ...form, height: parseInt(e.target.value) || 1024 })}
                  className="bg-white border-slate-300"
                />
              </div>
              <div className="grid gap-2">
                <Label>价格（积分）</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="bg-white border-slate-300"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-300" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white border-0"
              disabled={saving}
              onClick={submit}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除价格项</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            确定删除「{deleteTarget?.label}」吗？用户将无法再选择该配置生成图片。
          </p>
          <DialogFooter>
            <Button variant="outline" className="border-slate-300" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-500 text-white"
              disabled={removeMutation.isPending}
              onClick={() => deleteTarget && removeMutation.mutate({ id: deleteTarget.id })}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
