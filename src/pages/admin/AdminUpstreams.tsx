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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Server, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Upstream } from "@contracts/types";

type FormState = {
  id?: number;
  name: string;
  provider: "demo" | "openai";
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  provider: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
  priority: 0,
  enabled: true,
};

export default function AdminUpstreams() {
  const utils = trpc.useUtils();
  const listQuery = trpc.admin.upstreams.list.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Upstream | null>(null);

  const invalidate = () => utils.admin.upstreams.list.invalidate();

  const createMutation = trpc.admin.upstreams.create.useMutation({
    onSuccess: () => {
      toast.success("上游已创建");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.admin.upstreams.update.useMutation({
    onSuccess: () => {
      toast.success("上游已保存");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleMutation = trpc.admin.upstreams.toggle.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const removeMutation = trpc.admin.upstreams.remove.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (u: Upstream) => {
    setForm({
      id: u.id,
      name: u.name,
      provider: u.provider,
      baseUrl: u.baseUrl ?? "",
      apiKey: u.apiKey ?? "",
      model: u.model,
      priority: u.priority,
      enabled: u.enabled,
    });
    setDialogOpen(true);
  };

  const submit = () => {
    if (!form.name.trim() || !form.model.trim()) {
      toast.error("请填写名称与模型标识");
      return;
    }
    if (form.id) {
      updateMutation.mutate({
        id: form.id,
        name: form.name,
        provider: form.provider,
        baseUrl: form.baseUrl || undefined,
        apiKey: form.apiKey || undefined,
        model: form.model,
        priority: form.priority,
        enabled: form.enabled,
      });
    } else {
      createMutation.mutate({
        name: form.name,
        provider: form.provider,
        baseUrl: form.baseUrl || undefined,
        apiKey: form.apiKey || undefined,
        model: form.model,
        priority: form.priority,
      });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">模型上游</h2>
          <p className="text-sm text-slate-500">配置生图模型的 API 上游，生图请求将按优先级路由到启用的上游</p>
        </div>
        <Button
          className="bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white border-0"
          onClick={() => {
            setForm(EMPTY_FORM);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          新增上游
        </Button>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white/70 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">模型标识</th>
                <th className="px-4 py-3 font-medium">Base URL</th>
                <th className="px-4 py-3 font-medium">优先级</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(listQuery.data ?? []).map((u) => (
                <tr key={u.id} className="border-b border-slate-200/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-700">{u.name}</td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        u.provider === "demo"
                          ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
                          : "bg-cyan-500/12 text-cyan-300 border-violet-500/30"
                      }
                    >
                      {u.provider === "demo" ? "内置演示" : "OpenAI 兼容"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{u.model}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-[220px] truncate">
                    {u.baseUrl ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.priority}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={u.enabled}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: u.id, enabled: checked })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
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
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    暂无上游配置
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-cyan-400" />
              {form.id ? "编辑上游" : "新增上游"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：主站模型 / 备用通道"
                className="bg-white border-slate-300"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>类型</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v) => setForm({ ...form, provider: v as "demo" | "openai" })}
                >
                  <SelectTrigger className="bg-white border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    <SelectItem value="demo">内置演示（无需 API）</SelectItem>
                    <SelectItem value="openai">OpenAI 兼容接口</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>优先级（越大越优先）</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                  className="bg-white border-slate-300"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>模型标识（需与价格表中的模型一致）</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="例如：dream-v1 / dall-e-3 / flux-pro"
                className="bg-white border-slate-300 font-mono"
              />
            </div>
            {form.provider === "openai" && (
              <>
                <div className="grid gap-2">
                  <Label>Base URL</Label>
                  <Input
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="bg-white border-slate-300 font-mono"
                  />
                  <p className="text-xs text-slate-400">将请求 {`{Base URL}`}/images/generations</p>
                </div>
                <div className="grid gap-2">
                  <Label>API Key</Label>
                  <Input
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="bg-white border-slate-300 font-mono"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-300" onClick={() => setDialogOpen(false)}>
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
            <DialogTitle>删除上游</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            确定删除上游「{deleteTarget?.name}」吗？删除后使用该模型的生图请求将切换到其他可用上游。
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
