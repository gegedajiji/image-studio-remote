/** 极光渐变背景：多团柔光缓慢漂移 */
export function AuroraBackground({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div className="aurora-blob left-[8%] top-[-12%] h-[420px] w-[420px] bg-violet-600/25" />
      <div
        className="aurora-blob right-[4%] top-[18%] h-[380px] w-[380px] bg-fuchsia-600/20"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="aurora-blob bottom-[-18%] left-[32%] h-[460px] w-[460px] bg-indigo-600/20"
        style={{ animationDelay: "-12s" }}
      />
    </div>
  );
}
