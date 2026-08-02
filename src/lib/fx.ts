/** 全局特效事件总线：任何组件都可以触发粒子爆发 */

export type BurstOptions = {
  x: number;
  y: number;
  count?: number;
  /** 色相范围，默认青→品红 */
  hueMin?: number;
  hueMax?: number;
  /** 初速度 */
  power?: number;
  /** 粒子生命（帧） */
  life?: number;
  size?: number;
};

export const FX_BURST_EVENT = "mirage:burst";

export function burst(opts: BurstOptions) {
  window.dispatchEvent(new CustomEvent<BurstOptions>(FX_BURST_EVENT, { detail: opts }));
}

/** 在元素中心（或边缘随机点）触发爆发 */
export function burstAtElement(el: Element | null, opts?: Partial<BurstOptions>) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width * (0.2 + Math.random() * 0.6);
  const y = rect.top + rect.height * (0.2 + Math.random() * 0.6);
  burst({ x, y, ...opts });
}
