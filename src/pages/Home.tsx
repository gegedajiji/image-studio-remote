import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { SiteLayout } from "@/components/SiteLayout";
import { Button } from "@/components/ui/button";
import { ParticleField } from "@/components/effects/ParticleField";
import { AuroraBackground } from "@/components/effects/AuroraBackground";
import { Reveal } from "@/components/effects/Reveal";
import { SpotlightCard } from "@/components/effects/SpotlightCard";
import { Magnetic } from "@/components/effects/Magnetic";
import { Typewriter } from "@/components/effects/Typewriter";
import {
  Sparkles,
  Zap,
  Code2,
  Coins,
  Users,
  ArrowRight,
  Wand2,
  Image as ImageIcon,
  ShieldCheck,
  Layers,
  ChevronDown,
  MousePointer2,
} from "lucide-react";
import { burstAtElement } from "@/lib/fx";

const FEATURE_ICONS = [Wand2, Coins, Code2, Users, ShieldCheck, Zap];

function GalleryCard({ seed, label }: { seed: string; label: string }) {
  return (
    <Link
      to="/community"
      className="group relative block h-44 w-72 shrink-0 overflow-hidden rounded-2xl border border-slate-200 transition-colors hover:border-sky-400/70"
    >
      <img
        src={`https://picsum.photos/seed/${seed}/576/352`}
        alt={label}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-white/95 via-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
        <span className="text-sm font-medium text-slate-800">{label}</span>
      </div>
      <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/0 group-hover:ring-sky-400/40 transition-all duration-300" />
    </Link>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const pricingQuery = trpc.generation.pricing.useQuery();

  const features = FEATURE_ICONS.map((icon, i) => ({
    icon,
    title: t(`home.f${i + 1}t`),
    desc: t(`home.f${i + 1}d`),
  }));
  const promptIdeas = [1, 2, 3, 4, 5].map((i) => t(`home.idea${i}`));
  const galleryRow1 = [1, 2, 3, 4, 5, 6].map((i) => ({
    seed: ["aurora-city", "neon-samurai", "dream-forest", "cyber-ocean", "sky-whale", "ink-mountain"][i - 1],
    label: t(`home.g${i}`),
  }));
  const galleryRow2 = [7, 8, 9, 10, 11, 12].map((i) => ({
    seed: ["mist-temple", "galaxy-girl", "retro-train", "crystal-cave", "desert-mirage", "paper-crane"][i - 7],
    label: t(`home.g${i}`),
  }));

  return (
    <SiteLayout>
      {/* ============ Hero ============ */}
      <section className="relative overflow-hidden">
        <div className="hero-grid-bg absolute inset-0" />
        <AuroraBackground />
        <ParticleField
          className="absolute inset-0 h-full w-full"
          density={0.00009}
          maxCount={130}
          linkDistance={140}
          speed={0.4}
        />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-sky-300/25 blur-[120px] pointer-events-none" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 pt-24 pb-24 text-center">
          <div
            className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-amber-400/50 bg-amber-400/10 px-4 py-1.5 text-sm text-amber-600 mb-8 backdrop-blur-sm shadow-[0_0_20px_rgba(240,183,90,0.18)]"
            style={{ animationDelay: "0.05s" }}
          >
            <Sparkles className="h-4 w-4 animate-float" />
            {t("home.badge")}
          </div>

          <h1
            className="animate-fade-up text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight text-slate-900"
            style={{ animationDelay: "0.15s" }}
          >
            {t("home.title1")}
            <br />
            <span className="gradient-text-animated">{t("home.title2")}</span>
          </h1>

          <p
            className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg text-slate-500"
            style={{ animationDelay: "0.25s" }}
          >
            {t("home.subtitle")}
          </p>

          {/* 打字机灵感条（全息显示器） */}
          <div
            className="animate-fade-up holo-panel mx-auto mt-9 flex max-w-xl items-center gap-3 rounded-xl px-5 py-3.5 text-left shadow-[0_0_44px_rgba(125,211,252,0.25)]"
            style={{ animationDelay: "0.35s" }}
          >
            <span className="holo-corner holo-corner-tl" />
            <span className="holo-corner holo-corner-tr" />
            <span className="holo-corner holo-corner-bl" />
            <span className="holo-corner holo-corner-br" />
            <MousePointer2 className="h-4 w-4 shrink-0 text-sky-500" />
            <div className="min-w-0 flex-1 truncate text-sm text-slate-600 font-mono tracking-wide">
              <Typewriter phrases={promptIdeas} />
            </div>
            <button
              onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
              className="shrink-0 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-600 hover:bg-sky-500/25 transition-colors"
            >
              {t("home.tryIdea")}
            </button>
          </div>

          <div
            className="animate-fade-up mt-10 flex items-center justify-center gap-4"
            style={{ animationDelay: "0.45s" }}
          >
            <Magnetic>
              <button
                className="energy-core-btn inline-flex h-12 items-center rounded-xl bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 px-8 text-base font-semibold text-white transition-transform hover:scale-[1.03] active:scale-95"
                onMouseEnter={(e) => burstAtElement(e.currentTarget, { count: 14, power: 2.6 })}
                onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
              >
                <Wand2 className="mr-2 h-5 w-5" />
                {t("home.ctaStart")}
              </button>
            </Magnetic>
            <Magnetic>
              <Button
                size="lg"
                variant="outline"
                className="border-slate-300 bg-white/70 text-slate-600 hover:bg-sky-50 hover:border-sky-400/60 hover:text-sky-600 text-base px-8 h-12 backdrop-blur-sm"
                onClick={() => navigate("/community")}
              >
                {t("home.ctaCommunity")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Magnetic>
          </div>

          {/* 能量光束 */}
          <div className="animate-fade-up mx-auto mt-12 max-w-md" style={{ animationDelay: "0.5s" }}>
            <div className="energy-beam" />
          </div>

          {/* 数据条 */}
          <div
            className="animate-fade-up mx-auto mt-16 grid max-w-3xl grid-cols-3 gap-4"
            style={{ animationDelay: "0.55s" }}
          >
            {[
              { icon: ImageIcon, label: t("home.stat1l"), value: t("home.stat1v") },
              { icon: Layers, label: t("home.stat2l"), value: t("home.stat2v") },
              { icon: Code2, label: t("home.stat3l"), value: t("home.stat3v") },
            ].map((s) => (
              <div
                key={s.label}
                className="glass-card rounded-2xl px-4 py-5 transition-all duration-300 hover:border-sky-400/50 hover:-translate-y-1"
              >
                <s.icon className="mx-auto h-5 w-5 text-sky-500 mb-2" />
                <div className="text-sm font-semibold text-slate-800">{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-16 flex justify-center">
            <ChevronDown className="h-6 w-6 text-slate-400 animate-scroll-hint" />
          </div>
        </div>
      </section>

      {/* ============ 特性 ============ */}
      <section className="relative mx-auto max-w-7xl px-4 sm:px-6 py-24">
        <Reveal>
          <h2 className="text-center text-3xl font-bold text-slate-900">
            {t("home.featuresTitle1")}
            <span className="gradient-text-animated">{t("home.featuresTitle2")}</span>
          </h2>
          <p className="text-center text-slate-500 mt-3">{t("home.featuresSub")}</p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i * 80}>
              <SpotlightCard className="glass-card rounded-2xl p-6 h-full hover:bg-white/90 transition-colors group">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/15 text-amber-500 transition-all duration-300 group-hover:bg-amber-400/30 group-hover:scale-110 group-hover:rotate-3">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-800">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============ 无限滚动画廊 ============ */}
      <section className="relative py-24 overflow-hidden">
        <Reveal>
          <h2 className="text-center text-3xl font-bold px-4 text-slate-900">
            {t("home.galleryTitle1")}{" "}
            <span className="gradient-text-animated">{t("home.galleryTitle2")}</span>
          </h2>
          <p className="text-center text-slate-500 mt-3 px-4">{t("home.gallerySub")}</p>
        </Reveal>
        <Reveal delay={150}>
          <div className="mt-12 space-y-4">
            <div className="marquee">
              <div className="marquee-track py-1">
                {[...galleryRow1, ...galleryRow1].map((item, i) => (
                  <GalleryCard key={`r1-${i}`} seed={`${item.seed}-${i >= galleryRow1.length ? "b" : "a"}`} label={item.label} />
                ))}
              </div>
            </div>
            <div className="marquee">
              <div className="marquee-track marquee-reverse py-1">
                {[...galleryRow2, ...galleryRow2].map((item, i) => (
                  <GalleryCard key={`r2-${i}`} seed={`${item.seed}-${i >= galleryRow2.length ? "b" : "a"}`} label={item.label} />
                ))}
              </div>
            </div>
          </div>
        </Reveal>
        <Reveal delay={250}>
          <div className="text-center mt-10">
            <Link
              to="/community"
              className="text-amber-600 hover:text-amber-500 text-sm font-medium inline-flex items-center gap-1 transition-colors"
            >
              {t("home.galleryMore")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ============ 价格 ============ */}
      <section className="relative mx-auto max-w-7xl px-4 sm:px-6 py-24">
        <Reveal>
          <h2 className="text-center text-3xl font-bold text-slate-900">
            {t("home.pricingTitle1")}{" "}
            <span className="gradient-text-animated">{t("home.pricingTitle2")}</span>
          </h2>
          <p className="text-center text-slate-500 mt-3">{t("home.pricingSub")}</p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {(pricingQuery.data ?? []).map((p, i) => (
            <Reveal key={p.id} delay={i * 90}>
              <SpotlightCard className="glass-card rounded-2xl p-6 text-center h-full">
                <div className="text-sm font-medium text-slate-500">{p.label}</div>
                <div className="mt-4 flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-extrabold text-slate-900">{p.price}</span>
                  <span className="text-sm text-slate-500">{t("home.perImage")}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {p.width} × {p.height}
                </div>
                <Button
                  className="mt-5 w-full bg-slate-100 hover:bg-gradient-to-r hover:from-sky-500 hover:via-amber-400 hover:to-emerald-400 text-slate-700 hover:text-white transition-all duration-300"
                  onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
                >
                  {t("home.startGenerate")}
                </Button>
              </SpotlightCard>
            </Reveal>
          ))}
          {pricingQuery.isLoading && (
            <div className="col-span-full text-center text-slate-500 py-8">{t("home.loadingPricing")}</div>
          )}
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-amber-300/50 bg-gradient-to-br from-sky-100/80 via-amber-50/90 to-emerald-100/70 px-8 py-16 text-center">
            <AuroraBackground className="opacity-60" />
            <div className="relative z-10">
              <h2 className="text-3xl font-bold text-slate-900">{t("home.ctaFinalTitle")}</h2>
              <p className="mt-3 text-slate-500">{t("home.ctaFinalSub")}</p>
              <Magnetic className="mt-8">
                <button
                  className="energy-core-btn inline-flex h-12 items-center rounded-xl bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 px-10 text-base font-semibold text-white transition-transform hover:scale-[1.03] active:scale-95"
                  onMouseEnter={(e) => burstAtElement(e.currentTarget, { count: 14, power: 2.6 })}
                  onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
                >
                  <Sparkles className="mr-2 h-5 w-5" />
                  {t("home.ctaFinalBtn")}
                </button>
              </Magnetic>
            </div>
          </div>
        </Reveal>
      </section>
    </SiteLayout>
  );
}
