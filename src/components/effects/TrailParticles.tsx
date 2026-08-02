import { useEffect, useRef } from "react";

type TrailParticle = {
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
 * 鼠标轨迹粒子流：光标划过时留下一条发光的粒子尾迹，
 * 如同在数字空间中雕刻。空闲时自动休眠。
 */
export function TrailParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: TrailParticle[] = [];
    let raf = 0;
    let lastX = -1;
    let lastY = -1;
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
        p.vx *= 0.96;
        p.vy *= 0.96;
        const t = p.life / p.maxLife;
        const alpha = t * 0.85;
        ctx.fillStyle = `hsla(${p.hue}, 90%, 58%, ${alpha})`;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 55%, ${alpha})`;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.3 + t * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const spawn = (x: number, y: number, dx: number, dy: number) => {
      const dist = Math.hypot(dx, dy);
      const n = Math.min(4, Math.max(1, Math.floor(dist / 8)));
      for (let i = 0; i < n; i++) {
        const maxLife = 34 + Math.random() * 26;
        particles.push({
          x: x + (Math.random() - 0.5) * 8,
          y: y + (Math.random() - 0.5) * 8,
          vx: -dx * 0.04 + (Math.random() - 0.5) * 0.8,
          vy: -dy * 0.04 + (Math.random() - 0.5) * 0.8,
          r: 0.8 + Math.random() * 2.2,
          hue: [42, 155, 205, 258][Math.floor(Math.random() * 4)] + Math.random() * 16 - 8, // 金/薄荷/冰蓝/薰衣草
          life: maxLife,
          maxLife,
        });
      }
      if (particles.length > 400) particles = particles.slice(-400);
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      if (lastX >= 0) spawn(e.clientX, e.clientY, e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[3] h-full w-full"
    />
  );
}
