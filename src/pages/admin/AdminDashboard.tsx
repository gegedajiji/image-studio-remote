import { trpc } from "@/providers/trpc";
import { Users, Image, Ticket, Coins, CheckCircle2, KeyRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminDashboard() {
  const statsQuery = trpc.admin.stats.useQuery();

  const items = [
    { icon: Users, label: "注册用户", value: statsQuery.data?.userCount, color: "text-cyan-400 bg-violet-500/15" },
    { icon: Image, label: "生图总数", value: statsQuery.data?.generationCount, color: "text-fuchsia-400 bg-fuchsia-500/15" },
    { icon: CheckCircle2, label: "成功次数", value: statsQuery.data?.successCount, color: "text-emerald-400 bg-emerald-500/15" },
    { icon: Coins, label: "已消耗积分", value: statsQuery.data?.creditsSpent, color: "text-amber-400 bg-amber-500/15" },
    { icon: Ticket, label: "卡密总数", value: statsQuery.data?.cardCount, color: "text-sky-400 bg-sky-500/15" },
    { icon: KeyRound, label: "未使用卡密", value: statsQuery.data?.unusedCardCount, color: "text-rose-400 bg-rose-500/15" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <div key={item.label} className="glass-card rounded-2xl p-5">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.color}`}>
              <item.icon className="h-5 w-5" />
            </div>
            {statsQuery.isLoading ? (
              <Skeleton className="mt-4 h-8 w-20 bg-slate-100" />
            ) : (
              <div className="mt-3 text-3xl font-extrabold text-slate-800">
                {item.value ?? 0}
              </div>
            )}
            <div className="mt-1 text-sm text-slate-500">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-2xl p-6 mt-6">
        <h3 className="font-semibold text-slate-800 mb-3">快捷指引</h3>
        <ul className="space-y-2 text-sm text-slate-500">
          <li>· 在「模型上游」中配置 OpenAI 兼容接口，或启用内置演示上游即刻体验</li>
          <li>· 在「生图价格」中维护不同模型 / 尺寸的扣费标准</li>
          <li>· 在「卡密管理」中批量生成充值卡密，用户可在「账号设置」中兑换额度</li>
          <li>· 在「用户管理」中调整用户额度、封禁 / 解封账号、设置管理员</li>
          <li>· 在「生图历史」中查看全平台生成记录与失败原因</li>
        </ul>
      </div>
    </div>
  );
}
