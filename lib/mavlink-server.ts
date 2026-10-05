const headers = { 'Cache-Control': 'no-store' }
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store, no-transform',
  'X-Accel-Buffering': 'no',
}

function forbidden(request: Request) {
  const origin = request.headers.get('origin')
  return origin && origin !== new URL(request.url).origin
}

export async function streamMavlink(request: Request) {
  if (forbidden(request)) return Response.json({ error: 'Forbidden' }, { status: 403, headers })
  const abort = new AbortController()
  const onAbort = () => abort.abort()
  request.signal.addEventListener('abort', onAbort, { once: true })
  if (request.signal.aborted) abort.abort()
  let timer = setTimeout(onAbort, 2000)
  function cleanup() {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', onAbort)
    abort.abort()
  }
  try {
    const response = await fetch('http://127.0.0.1:8765/telemetry', {
      cache: 'no-store', signal: abort.signal,
    })
    clearTimeout(timer)
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
      await response.body?.cancel()
      throw new Error('Invalid bridge stream')
    }
    const reader = response.body.getReader()
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Time out a silent upstream without imposing a lifetime limit on healthy streams.
        timer = setTimeout(onAbort, 3000)
        try {
          const { value, done } = await reader.read()
          clearTimeout(timer)
          if (done) {
            cleanup()
            controller.close()
          } else {
            controller.enqueue(value)
          }
        } catch (error) {
          cleanup()
          controller.error(error)
        }
      },
      async cancel() {
        cleanup()
        await reader.cancel().catch(() => {})
      },
    }), { headers: streamHeaders })
  } catch {
    cleanup()
    // A valid SSE response followed by EOF lets EventSource retry even if the bridge is down.
    return new Response('retry: 2000\nevent: bridge-error\ndata: ' + JSON.stringify({
      error: 'MAVLink bridge unavailable. Start it with pnpm mavlink.',
    }) + '\n\n', { headers: streamHeaders })
  }
}

export async function proxyMavlink(request: Request, path: 'mission') {
  if (forbidden(request)) return Response.json({ error: 'Forbidden' }, { status: 403, headers })
  try {
    const response = await fetch(`http://127.0.0.1:8765/${path}`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
    })
    return Response.json(await response.json(), { status: response.status, headers })
  } catch {
    return Response.json({ error: 'Mission download unavailable. Check the local MAVLink bridge and retry.' }, { status: 503, headers })
  }
}
