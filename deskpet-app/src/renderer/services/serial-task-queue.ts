/**
 * 串行任务队列（纯逻辑，无 Vue / DOM / Electron，可直接用纯对象测试）。
 *
 * 用途：端侧语音合成必须按「消息到达顺序」执行。MaiBot 常把一段回复拆成连续
 * 2~3 条短消息先后发出，若对每条 output:text:done 都并发发起合成，短句会先
 * 合成完先入队，导致播放顺序颠倒。本队列保证前一个任务 settle 后才开始下一个，
 * 入队顺序即执行顺序；播放层（useWebSocket 的 playAudio）本身还有一层音频队列，
 * 两者叠加后既不会乱序也不会互相打断。
 *
 * invalidate() 用于断线/重连：作废尚未开始与尚未完成的任务，避免旧连接迟到的
 * 合成结果插进新会话。
 *
 * 把这段时序逻辑抽出来，既能修好也能单独测（同 DP-013 的 probe-guard 思路）。
 */
export interface SerialTaskQueue {
  /**
   * 排队一个任务，按入队顺序依次执行。
   * task 收到 isStale()：返回 true 表示队列已被 invalidate，任务应尽早放弃
   * （await 之后再检查一次，避免把过期结果投递出去）。
   */
  push(task: (isStale: () => boolean) => void | Promise<void>): void
  /** 作废所有在途与排队任务（断线、重连、切换配置时调用） */
  invalidate(): void
}

export function createSerialTaskQueue(onError?: (err: unknown) => void): SerialTaskQueue {
  /** 队尾 Promise：新任务总是接在它后面，从而天然串行 */
  let tail: Promise<void> = Promise.resolve()
  /** 代次：invalidate() 自增，用于让旧批次任务整体失效 */
  let generation = 0

  return {
    push(task) {
      const generationAtPush = generation
      const isStale = () => generationAtPush !== generation
      tail = tail
        .then(() => {
          if (isStale()) return
          return task(isStale)
        })
        .catch((err) => {
          // 单个任务失败不阻断后续任务
          onError?.(err)
        })
    },
    invalidate() {
      generation++
    },
  }
}