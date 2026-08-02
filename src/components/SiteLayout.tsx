import { Link, NavLink, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sparkles,
  Image,
  Images,
  BookOpen,
  Home,
  Coins,
  Settings,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Shapes,
  Globe,
  Check,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ParticleField } from "@/components/effects/ParticleField";
import { CursorGlow } from "@/components/effects/CursorGlow";
import { TrailParticles } from "@/components/effects/TrailParticles";
import { BurstLayer } from "@/components/effects/BurstLayer";
import { BackgroundManager } from "@/components/effects/BackgroundManager";

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const profileQuery = trpc.user.profile.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  const quota = profileQuery.data?.quota ?? user?.quota ?? 0;

  const NAV_ITEMS = [
    { to: "/", label: t("nav.home"), icon: Home },
    { to: "/workspace", label: t("nav.workspace"), icon: Image },
    { to: "/canvas", label: t("nav.canvas"), icon: Shapes },
    { to: "/community", label: t("nav.community"), icon: Images },
    { to: "/docs", label: t("nav.docs"), icon: BookOpen },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const langSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-500 hover:text-slate-800 hover:border-slate-300 hover:shadow-[0_0_14px_rgba(240,183,90,0.35)] transition-all"
          title={t("lang.zh") + " / " + t("lang.en")}
        >
          <Globe className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 bg-white border-slate-200">
        {(["zh", "en"] as const).map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => setLang(l)}
            className={cn(
              "cursor-pointer flex items-center justify-between",
              lang === l && "text-amber-600 font-semibold",
            )}
          >
            {t(`lang.${l}`)}
            {lang === l && <Check className="h-4 w-4 text-amber-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="min-h-screen bg-white text-slate-800 flex flex-col relative">
      {/* 全局氛围层：动态背景 → 粒子网络 → 光标光晕 → 轨迹粒子 → 爆发粒子 */}
      <BackgroundManager />
      <ParticleField
        className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
        density={0.00003}
        maxCount={60}
        linkDistance={110}
        speed={0.22}
      />
      <CursorGlow />
      <TrailParticles />
      <BurstLayer />

      {/* 顶部导航 */}
      <header
        className={cn(
          "sticky top-0 z-50 border-b backdrop-blur-xl transition-all duration-300",
          scrolled
            ? "border-slate-200 bg-white/92 shadow-[0_10px_36px_rgba(100,116,139,0.14)]"
            : "border-slate-200/60 bg-white/65",
        )}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-amber-400 to-emerald-400 shadow-lg shadow-sky-400/30 group-hover:shadow-amber-400/50 transition-all duration-300 group-hover:scale-105">
                <Sparkles className="h-5 w-5 text-white transition-transform duration-500 group-hover:rotate-90" />
                <div className="absolute -inset-1 rounded-2xl bg-amber-300/25 blur-md opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-base font-bold tracking-tight">幻镜 AI</span>
                <span className="text-[10px] text-slate-500 tracking-widest">MIRAGE STUDIO</span>
              </div>
            </Link>

            {/* 桌面导航 */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "relative flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-300",
                      isActive
                        ? "bg-sky-500/10 text-sky-600 after:absolute after:-bottom-[13px] after:left-1/2 after:h-[2px] after:w-8 after:-translate-x-1/2 after:rounded-full after:bg-gradient-to-r after:from-amber-400 after:to-emerald-400 after:shadow-[0_0_10px_rgba(240,183,90,0.8)]"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/70",
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {langSwitcher}
              {isAuthenticated ? (
                <>
                  <button
                    onClick={() => navigate("/settings")}
                    className="hidden sm:flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold text-amber-600 hover:bg-amber-500/20 transition-colors"
                    title={t("nav.quota")}
                  >
                    <Coins className="h-4 w-4" />
                    {quota}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="rounded-full ring-2 ring-slate-300 hover:ring-violet-400 transition-all">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={user?.avatar ?? undefined} />
                          <AvatarFallback className="bg-violet-500 text-white text-sm">
                            {(user?.name ?? "U").slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-white border-slate-200">
                      <div className="px-2 py-1.5">
                        <p className="text-sm font-medium text-slate-800">{user?.name ?? "User"}</p>
                        <p className="text-xs text-slate-500">{user?.email ?? ""}</p>
                      </div>
                      <DropdownMenuSeparator className="bg-slate-100" />
                      <DropdownMenuItem onClick={() => navigate("/settings")} className="cursor-pointer">
                        <Settings className="mr-2 h-4 w-4" /> {t("nav.settings")}
                      </DropdownMenuItem>
                      {user?.role === "admin" && (
                        <DropdownMenuItem onClick={() => navigate("/admin")} className="cursor-pointer">
                          <ShieldCheck className="mr-2 h-4 w-4" /> {t("nav.admin")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator className="bg-slate-100" />
                      <DropdownMenuItem onClick={() => logout()} className="cursor-pointer text-red-500">
                        <LogOut className="mr-2 h-4 w-4" /> {t("nav.logout")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 hover:from-sky-400 hover:via-amber-300 hover:to-emerald-300 text-white border-0 shadow-[0_0_16px_rgba(240,183,90,0.35)]"
                  onClick={() => navigate("/login")}
                >
                  {t("nav.login")}
                </Button>
              )}
              <button
                className="md:hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* 移动端导航 */}
          {mobileOpen && (
            <nav className="md:hidden border-t border-slate-200 py-2 space-y-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
                      isActive ? "bg-sky-500/10 text-sky-600" : "text-slate-500",
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="flex-1 relative z-10">{children}</main>

      {/* 页脚 */}
      <footer className="relative z-10 border-t border-slate-200/80 py-8 mt-auto bg-white/65 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Sparkles className="h-4 w-4 text-amber-400" />
            {t("footer.slogan")}
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link to="/docs" className="hover:text-slate-700 transition-colors">{t("footer.api")}</Link>
            <Link to="/community" className="hover:text-slate-700 transition-colors">{t("footer.community")}</Link>
            <Link to="/workspace" className="hover:text-slate-700 transition-colors">{t("footer.start")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
