import { useEffect, useRef } from "react";

type Star = {
  /** 起始极角 / 半径比例（相对半对角线） */
  angle: number;
  radiusK: number;
  /** 贝塞尔控制点偏移 */
  ctrlX: number;
  ctrlY: number;
  /** 汇聚目标点（相对中心的小偏移） */
  targetX: number;
  targetY: number;
  /** 生命周期进度 0..1 */
  t: number;
  /** 速度（每秒推进的进度） */
  speed: number;
  size: number;
  hue: number;
  sat: number;
  /** 重生延迟 */
  delay: number;
};

const PALETTE = [
  { hue: 210, sat: 90 },  // 冰蓝
  { hue: 210, sat: 90 },
  { hue: 200, sat: 70 },
  { hue: 46, sat: 90 },   // 柔金
  { hue: 160, sat: 60 },  // 薄荷
  { hue: 262, sat: 70 },  // 薰衣草
];

function easeInCubic(x: number) {
  return x * x * x;
}

/**
 * 白色星光汇聚：大量星尘从面板四周边缘沿弧线缓慢向中心凝聚，
 * 越靠近中心越亮，最终在中心形成呼吸光球。
 * 用于生成等待态，配合 animate-materialize 完成「凝聚成图」叙事。
 */
export function ConvergingStars({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let stars: Star[] = [];
    let last = performance.now();

    const spawn = (initial = false): Star => {
      const p = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      return {
        angle: Math.random() * Math.PI * 2,
        radiusK: 0.62 + Math.random() * 0.4,
        ctrlX: (Math.random() - 0.5) * 0.7,
        ctrlY: (Math.random() - 0.5) * 0.7,
        targetX: (Math.random() - 0.5) * 0.22,
        targetY: (Math.random() - 0.5) * 0.26,
        t: initial ? Math.random() : 0,
        speed: (0.11 + Math.random() * 0.15) * (reduced ? 0.4 : 1),
        size: 1.1 + Math.random() * 1.9,
        hue: p.hue,
        sat: p.sat,
        delay: 0,
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(90, Math.min(210, Math.floor((w * h) / 4200)));
      stars = Array.from({ length: count }, () => spawn(true));
    };

    const drawStar = (x: number, y: number, r: number, alpha: number, hue: number, sat: number) => {
      // 彩色光晕
      const glowR = r * 6;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      glow.addColorStop(0, `hsla(${hue}, ${sat}%, 72%, ${alpha * 0.8})`);
      glow.addColorStop(0.45, `hsla(${hue}, ${sat}%, 80%, ${alpha * 0.16})`);
      glow.addColorStop(1, `hsla(${hue}, ${sat}%, 88%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 白色星核
      ctx.fillStyle = `hsla(0, 0%, 100%, ${Math.min(1, alpha * 1.15)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // 十字星芒
      const spike = r * 4.6;
      const grad = ctx.createLinearGradient(x - spike, y, x + spike, y);
      grad.addColorStop(0, "hsla(0,0%,100%,0)");
      grad.addColorStop(0.5, `hsla(0,0%,100%,${alpha * 0.85})`);
      grad.addColorStop(1, "hsla(0,0%,100%,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(0.6, r * 0.32);
      ctx.beginPath();
      ctx.moveTo(x - spike, y);
      ctx.lineTo(x + spike, y);
      ctx.moveTo(x, y - spike);
      ctx.lineTo(x, y + spike);
      ctx.stroke();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // 拖尾淡出
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.115)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const cx = w / 2;
      const cy = h / 2;
      const halfDiag = Math.hypot(cx, cy);
      const time = now / 1000;

      // 中心呼吸光球（星光汇聚的终点）
      const breathe = 0.82 + Math.sin(time * 1.6) * 0.18;
      const coreR = Math.min(w, h) * 0.085 * breathe;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.2);
      core.addColorStop(0, `hsla(0, 0%, 100%, ${0.5 * breathe})`);
      core.addColorStop(0.25, `hsla(205, 95%, 86%, ${0.32 * breathe})`);
      core.addColorStop(0.6, `hsla(215, 90%, 88%, ${0.12 * breathe})`);
      core.addColorStop(1, "hsla(215, 90%, 92%, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 3.2, 0, Math.PI * 2);
      ctx.fill();

      for (const s of stars) {
        if (s.delay > 0) {
          s.delay -= dt;
          continue;
        }
        s.t += s.speed * dt;
        if (s.t >= 1) {
          // 到达中心：闪烁重生
          Object.assign(s, spawn());
          s.delay = Math.random() * 1.6;
          continue;
        }

        const e = easeInCubic(s.t);
        // 起点（面板边缘外）
        const sx = cx + Math.cos(s.angle) * halfDiag * s.radiusK;
        const sy = cy + Math.sin(s.angle) * halfDiag * s.radiusK;
        // 终点（中心附近）
        const tx = cx + s.targetX * w;
        const ty = cy + s.targetY * h;
        // 控制点（弧线弯曲）
        const mx = (sx + tx) / 2 + s.ctrlX * w * 0.35;
        const my = (sy + ty) / 2 + s.ctrlY * h * 0.35;
        // 二次贝塞尔
        const q = 1 - e;
        const x = q * q * sx + 2 * q * e * mx + e * e * tx;
        const y = q * q * sy + 2 * q * e * my + e * e * ty;

        // 越靠近中心越亮越大；起点处淡入
        const fadeIn = Math.min(1, s.t / 0.12);
        const approach = 0.42 + 0.58 * e;
        const twinkle = 0.82 + 0.18 * Math.sin(time * 5 + s.angle * 7);
        const alpha = fadeIn * approach * twinkle;
        const r = s.size * (0.7 + 0.9 * e);

        drawStar(x, y, r, alpha, s.hue, s.sat);
      }

      raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block" }}
      aria-hidden
    />
  );
}
