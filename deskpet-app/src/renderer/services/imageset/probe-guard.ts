/**
 * 换图探针守卫：每次目标变化都签发新令牌，只有最新令牌的回调可以提交结果。
 *
 * 之前的写法在“目标等于当前图”时提前 return，没有作废在途探针，
 * 于是 A → 慢 B → A 时，B 的 onload 仍会通过校验并把画面切到 B（DP-013）。
 * 把这段时序逻辑抽出来，既能修好也能单独测。
 */
export interface ProbeGuard {
  /** 签发新令牌：调用后此前所有在途回调全部失效 */
  next(): number
  /** 作废所有在途回调（卸载、切包、提交首帧时调用） */
  invalidate(): void
  /** 某个回调是否仍是最新令牌 */
  isCurrent(token: number): boolean
}

export function createProbeGuard(): ProbeGuard {
  let token = 0
  return {
    next: () => ++token,
    invalidate: () => { token++ },
    isCurrent: (candidate: number) => candidate === token,
  }
}
