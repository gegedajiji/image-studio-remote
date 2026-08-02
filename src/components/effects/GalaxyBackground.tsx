import { useEffect, useRef } from "react";

type Star = {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  hue: number;
  alpha: number;
  armOffset: number;
};

type TwinkleStar = {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  hue: number;
};

/**
 * 程序化「缓慢旋转的晶体星系」动态背景（明亮版）：
 * 冰蓝螺旋星系臂 + 金色闪烁星野 + 酷白冰蓝深空渐变，实时渲染。
 */
export function GalaxyBackground({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    let twinkles: TwinkleStar[] = [];
    let angle = 0;
    let last = performance.now();
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.66;

    const build = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * scale);
      canvas.height = Math.floor(h * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      const maxR = Math.hypot(w, h) * 0.42;
      const armCount = 3;
      stars = Array.from({ length: 560 }, () => {
        const arm = Math.floor(Math.random() * armCount);
        const t = Math.pow(Math.random(), 0.72);
        return {
          angle: (arm * Math.PI * 2) / armCount + t * 3.4,
          radius: t * maxR + 8,
          speed: 0.000045 + Math.random() * 0.00004,
          size: 0.4 + Math.random() * 1.6,
          // 冰蓝 / 薰衣草 / 少量金色
          hue: Math.random() < 0.18 ? 44 + Math.random() * 10 : 205 + Math.random() * 55,
          alpha: 0.2 + Math.random() * 0.5,
          armOffset: (Math.random() - 0.5) * 0.55,
        };
      });
      twinkles = Array.from({ length: 140 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.4,
        hue: Math.random() < 0.3 ? 45 : 210 + Math.random() * 40,
      }));
    };

    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      angle += dt * 0.000016;

      // 酷白冰蓝底色
      const bg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.85);
      bg.addColorStop(0, "#f4f9ff");
      bg.addColorStop(0.45, "#eef4ff");
      bg.addColorStop(1, "#f7f5ff");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h * 0.42;

      // 星系核心辉光（冰蓝）
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.34);
      core.addColorStop(0, "rgba(125, 211, 252, 0.28)");
      core.addColorStop(0.3, "rgba(165, 180, 252, 0.12)");
      core.addColorStop(1, "rgba(165, 180, 252, 0)");
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);

      // 螺旋星臂
      const rot = angle;
      for (const s of stars) {
        const a = s.angle + s.armOffset + rot * (1 + 18 / (s.radius + 40));
        const x = cx + Math.cos(a) * s.radius;
        const y = cy + Math.sin(a) * s.radius * 0.62;
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
        ctx.fillStyle = `hsla(${s.hue}, 85%, 62%, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 闪烁星野
      const t = now / 1000;
      for (const s of twinkles) {
        const a = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = `hsla(${s.hue}, 85%, 60%, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };

    build();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", build);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", build);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
