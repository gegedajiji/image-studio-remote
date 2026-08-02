import { useEffect, useState } from "react";
import { GalaxyBackground } from "./GalaxyBackground";
import { Orbit, Sun, Gem, Share2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export type BgMode = "galaxy" | "photon" | "crystal" | "neural";

const MODES: { key: BgMode; label: string; labelEn: string; icon: typeof Orbit }[] = [
  { key: "galaxy", label: "晶体星系", labelEn: "Crystal Galaxy", icon: Orbit },
  { key: "photon", label: "光子星云", labelEn: "Photon Nebula", icon: Sun },
  { key: "crystal", label: "晶体结构", labelEn: "Crystal Structure", icon: Gem },
  { key: "neural", label: "神经网络", labelEn: "Neural Network", icon: Share2 },
];

const STORAGE_KEY = "mirage-bg-mode";

/**
 * 动态背景管理器（明亮版）：
 * - galaxy：程序化实时渲染的旋转晶体星系
 * - photon / crystal / neural：AI 生成的高分明亮科幻图像 + 脉动辉光
 */
export function BackgroundManager() {
  const [mode, setMode] = useState<BgMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (MODES.some((m) => m.key === saved) ? saved : "galaxy") as BgMode;
  });
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return (
    <>
      {/* 背景层 */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        {mode === "galaxy" && <GalaxyBackground className="h-full w-full" />}
        {mode !== "galaxy" && (
          <>
            <div
              className="bg-image-pulse absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(/bg/${mode}.jpg)` }}
            />
            {/* 明亮压光层，保证可读性 */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/55 via-white/40 to-white/65" />
          </>
        )}
        {mode === "galaxy" && (
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/40" />
        )}
      </div>

      {/* 背景切换坞 */}
      <div className="fixed bottom-5 left-5 z-40 hidden items-center gap-1.5 sm:flex">
        <button
          onClick={() => setDockOpen(!dockOpen)}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300",
            dockOpen
              ? "border-sky-400/60 bg-sky-100/80 text-sky-600 shadow-[0_0_14px_rgba(56,189,248,0.35)]"
              : "border-slate-300/80 bg-white/70 text-slate-500 hover:text-sky-600 hover:border-sky-400/50 shadow-sm",
          )}
          title="切换动态背景 / Switch background"
        >
          <Layers className="h-4.5 w-4.5" />
        </button>
        <div
          className={cn(
            "flex items-center gap-1.5 overflow-hidden rounded-full border border-slate-300/70 bg-white/75 backdrop-blur-md shadow-sm transition-all duration-300",
            dockOpen ? "max-w-xs px-1.5 py-1 opacity-100" : "max-w-0 px-0 py-0 opacity-0 border-transparent",
          )}
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              title={`${m.label} · ${m.labelEn}`}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200",
                mode === m.key
                  ? "bg-sky-100 text-sky-600 shadow-[0_0_12px_rgba(56,189,248,0.4)]"
                  : "text-slate-400 hover:text-slate-700 hover:bg-slate-100",
              )}
            >
              <m.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
