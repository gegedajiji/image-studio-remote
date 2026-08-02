import { useEffect, useRef } from "react";

type ParticleFieldProps = {
  className?: string;
  /** 每平方像素的粒子密度 */
  density?: number;
  maxCount?: number;
  interactive?: boolean;
  linkDistance?: number;
  speed?: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  a: number;
};

/**
 * 交互式粒子网络（Plexus 效果）
 * - 粒子自由漂移，近距粒子间绘制连线
 * - 鼠标靠近时粒子被轻微吸引并与鼠标连线
 */
export function ParticleField({
  className = "",
  density = 0.00008,
  maxCount = 120,
  interactive = true,
  linkDistance = 130,
  speed = 0.35,
}: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let rect = canvas.getBoundingClientRect();
    const mouse = { x: -9999, y: -9999 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const seed = () => {
      const count = Math.min(maxCount, Math.floor(w * h * density));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        r: Math.random() * 1.8 + 0.6,
        // 金 / 薄荷 / 冰蓝 / 薰衣草（明亮背景可见）
        hue: [42, 155, 200, 258][Math.floor(Math.random() * 4)] + Math.random() * 20 - 10,
        a: 0.35 + Math.random() * 0.45,
      }));
    };

    const measure = () => {
      rect = canvas.getBoundingClientRect();
    };

    const resize = () => {
      measure();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        if (interactive) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 160 * 160 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = ((160 - d) / 160) * 0.02;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.vy *= 0.99;
        if (Math.abs(p.vx) < 0.05) p.vx += (Math.random() - 0.5) * 0.012;
        if (Math.abs(p.vy) < 0.05) p.vy += (Math.random() - 0.5) * 0.012;

        if (p.x < -20) p.x = w + 20;
        else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        else if (p.y > h + 20) p.y = -20;
      }

      // 粒子间连线
      const ld2 = linkDistance * linkDistance;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < ld2) {
            const alpha = (1 - Math.sqrt(d2) / linkDistance) * 0.26;
            ctx.strokeStyle = `hsla(205, 85%, 60%, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
        // 鼠标连线
        if (interactive) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 170 * 170) {
            const alpha = (1 - Math.sqrt(d2) / 170) * 0.4;
            ctx.strokeStyle = `hsla(46, 90%, 55%, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }

      // 粒子本体
      for (const p of particles) {
        ctx.fillStyle = `hsla(${p.hue}, 85%, 62%, ${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };

    resize();
    tick();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", measure, { passive: true });
    if (interactive) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseout", onLeave);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
    };
  }, [density, maxCount, interactive, linkDistance, speed]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
