// Each network request gets its own budget. A slow, successful restore may
// span several budgets; only a stalled request forces a retry from the start.
export async function playerRequest<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: () => void = () => {}
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort()
          reject(new DOMException('Recovery cancelled', 'AbortError'))
        }
        if (parent?.aborted) { onAbort(); return }
        parent?.addEventListener('abort', onAbort, { once: true })
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('The game request timed out'))
        }, 8000)
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new DOMException('Recovery cancelled', 'AbortError')
        return request(controller.signal)
      }),
    ])
  } finally {
    clearTimeout(timeout)
    parent?.removeEventListener('abort', onAbort)
  }
}
