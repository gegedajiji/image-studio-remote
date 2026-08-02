import { useEffect, useRef } from "react";
import { FX_BURST_EVENT, type BurstOptions } from "@/lib/fx";

type BurstParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  life: number;
  maxLife: number;
};

/**
 * 全局爆发粒子层：监听 fx 事件，在指定坐标绽放粒子。
 * 空闲时完全休眠（无 rAF）。
 */
export function BurstLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: BurstParticle[] = [];
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.life--;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.965;
        p.vy *= 0.965;
        p.vy += 0.015; // 微重力
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = `hsla(${p.hue}, 90%, 58%, ${alpha})`;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 55%, ${alpha})`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.5 + alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };

    const onBurst = (e: Event) => {
      const d = (e as CustomEvent<BurstOptions>).detail;
      const count = d.count ?? 16;
      const hueMin = d.hueMin ?? 40;
      const hueMax = d.hueMax ?? 270;
      const power = d.power ?? 3.2;
      const maxLife = d.life ?? 48;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.3 + Math.random() * 0.7) * power;
        particles.push({
          x: d.x,
          y: d.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.4,
          r: (d.size ?? 2) * (0.5 + Math.random()),
          hue: hueMin + Math.random() * (hueMax - hueMin),
          life: maxLife * (0.6 + Math.random() * 0.4),
          maxLife,
        });
      }
      if (particles.length > 600) particles = particles.slice(-600);
      if (!raf) raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener(FX_BURST_EVENT, onBurst);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener(FX_BURST_EVENT, onBurst);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[4] h-full w-full"
    />
  );
}
