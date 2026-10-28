// 统一时间源：所有“当前时间”经此获取，测试与 seed 可注入固定时钟（设计文档 §4.4）
let clockFn: () => number = () => Date.now();

export function now(): number {
  return clockFn();
}

/** 仅供测试/seed 注入；传 null 恢复真实时钟 */
export function setClock(fn: (() => number) | null): void {
  clockFn = fn ?? (() => Date.now());
}
