import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Search, Pencil, Loader2, Coins } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@contracts/types";

export default function AdminUsers() {
  const utils = trpc.useUtils();
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const listQuery = trpc.admin.users.list.useQuery({ keyword: search || undefined, limit: 100 });
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [quota, setQuota] = useState(0);
  const [status, setStatus] = useState<"active" | "banned">("active");
  const [role, setRole] = useState<"user" | "admin">("user");

  const updateMutation = trpc.admin.users.update.useMutation({
    onSuccess: () => {
      toast.success("用户已更新");
      setEditTarget(null);
      utils.admin.users.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (u: User) => {
    setEditTarget(u);
    setQuota(u.quota);
    setStatus(u.status);
    setRole(u.role);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold">用户管理</h2>
          <p className="text-sm text-slate-500">管理用户额度、账号状态与角色权限</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSearch(keyword)}
              placeholder="搜索用户名 / 邮箱"
              className="pl-9 bg-white border-slate-300 w-56"
            />
          </div>
          <Button variant="outline" className="border-slate-300" onClick={() => setSearch(keyword)}>
            搜索
          </Button>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white/70 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">额度</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(listQuery.data ?? []).map((u) => (
                <tr key={u.id} className="border-b border-slate-200/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={u.avatar ?? undefined} />
                        <AvatarFallback className="bg-violet-600 text-xs text-white">
                          {(u.name ?? "U").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700 truncate">{u.name ?? "未命名"}</div>
                        <div className="text-xs text-slate-500 truncate">{u.email ?? `#${u.id}`}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        u.role === "admin"
                          ? "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30"
                          : "bg-slate-100 text-slate-500 border-slate-300"
                      }
                    >
                      {u.role === "admin" ? "管理员" : "用户"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 font-mono text-amber-300">
                      <Coins className="h-3.5 w-3.5" />
                      {u.quota}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        u.status === "active"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : "bg-red-500/15 text-red-300 border-red-500/30"
                      }
                    >
                      {u.status === "active" ? "正常" : "已禁用"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(u.createdAt).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(u)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {listQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    未找到匹配用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑用户 */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑用户 · {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>额度（积分）</Label>
              <Input
                type="number"
                min={0}
                value={quota}
                onChange={(e) => setQuota(Math.max(0, parseInt(e.target.value) || 0))}
                className="bg-white border-slate-300 font-mono"
              />
              <p className="text-xs text-slate-400">
                当前 {editTarget?.quota}，调整差额将记入额度流水
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>账号状态</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "active" | "banned")}>
                  <SelectTrigger className="bg-white border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    <SelectItem value="active">正常</SelectItem>
                    <SelectItem value="banned">禁用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>角色</Label>
                <Select value={role} onValueChange={(v) => setRole(v as "user" | "admin")}>
                  <SelectTrigger className="bg-white border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    <SelectItem value="user">用户</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-300" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button
              className="bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white border-0"
              disabled={updateMutation.isPending}
              onClick={() =>
                editTarget &&
                updateMutation.mutate({ id: editTarget.id, quota, status, role })
              }
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
