/** Native approval orchestration; no network, process launch, or renderer-owned consent. */
export interface PythonRuntimeCandidate {
  id: string
  pythonPath: string
  sourceUrl: string
}

interface ApprovalOptions<Event> {
  isTrustedSender: (event: Event) => boolean
  getCandidate: () => PythonRuntimeCandidate | null
  approve: (id: string) => boolean
  confirm: (candidate: PythonRuntimeCandidate, event: Event) => Promise<boolean>
}

export function createRuntimeApproval<Event>(options: ApprovalOptions<Event>) {
  let pending = false
  return async (event: Event, id: unknown): Promise<boolean> => {
    if (pending || typeof id !== 'string' || !options.isTrustedSender(event)) return false
    const current = options.getCandidate()
    if (!current || current.id !== id) return false
    const snapshot = { ...current }
    pending = true
    try {
      if (!await options.confirm(snapshot, event) || !options.isTrustedSender(event)) return false
      const latest = options.getCandidate()
      if (!latest || latest.id !== snapshot.id || latest.pythonPath !== snapshot.pythonPath ||
          latest.sourceUrl !== snapshot.sourceUrl) return false
      return options.approve(snapshot.id)
    } finally {
      pending = false
    }
  }
}
