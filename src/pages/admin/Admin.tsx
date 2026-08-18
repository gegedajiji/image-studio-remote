import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { SiteLayout } from "@/components/SiteLayout";
import {
  LayoutDashboard,
  Server,
  Users,
  Tags,
  Ticket,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AdminDashboard from "./AdminDashboard";
import AdminUpstreams from "./AdminUpstreams";
import AdminUsers from "./AdminUsers";
import AdminPricing from "./AdminPricing";
import AdminCards from "./AdminCards";

const SECTION_DEFS = [
  { key: "dashboard", icon: LayoutDashboard },
  { key: "upstreams", icon: Server },
  { key: "users", icon: Users },
  { key: "pricing", icon: Tags },
  { key: "cards", icon: Ticket },
] as const;

type SectionKey = (typeof SECTION_DEFS)[number]["key"];

export default function Admin() {
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const [section, setSection] = useState<SectionKey>("dashboard");

  if (isLoading) {
    return (
      <SiteLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      </SiteLayout>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (user.role !== "admin") {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-400 mb-4" />
          <h1 className="text-2xl font-bold text-slate-900">{t("admin.noAccess")}</h1>
          <p className="mt-2 text-slate-500">{t("admin.noAccessSub")}</p>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold mb-6 text-slate-900">{t("admin.title")}</h1>
        <div className="flex flex-col md:flex-row gap-6">
          {/* 侧边菜单 */}
          <aside className="w-full md:w-52 shrink-0">
            <nav className="glass-card rounded-2xl p-2 flex md:flex-col gap-1 overflow-x-auto md:sticky md:top-24">
              {SECTION_DEFS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                    section === s.key
                      ? "bg-sky-500/12 text-sky-600"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/70",
                  )}
                >
                  <s.icon className="h-4 w-4" />
                  {t(`admin.${s.key}`)}
                </button>
              ))}
            </nav>
          </aside>

          {/* 内容区 */}
          <div className="flex-1 min-w-0">
            {section === "dashboard" && <AdminDashboard />}
            {section === "upstreams" && <AdminUpstreams />}
            {section === "users" && <AdminUsers />}
            {section === "pricing" && <AdminPricing />}
            {section === "cards" && <AdminCards />}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
