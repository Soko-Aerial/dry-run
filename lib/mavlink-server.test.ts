import assert from 'node:assert/strict'
import { proxyMavlink, streamMavlink } from './mavlink-server'

const originalFetch = globalThis.fetch
const request = () => new Request('http://localhost:3001/api/mavlink')
try {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  const forbidden = await streamMavlink(new Request(request(), { headers: { Origin: 'https://elsewhere.test' } }))
  assert.equal(forbidden.status, 403)
  const outage = await streamMavlink(request())
  assert.equal(outage.headers.get('content-type'), 'text/event-stream')
  assert.match(await outage.text(), /retry: 2000\nevent: bridge-error\ndata:/)

  let cancelled = false
  let upstreamSignal: AbortSignal | undefined
  const bytes = new TextEncoder().encode('retry: 2000\n\ndata: {"connected":true}\n\n')
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8765/telemetry')
    upstreamSignal = init?.signal as AbortSignal
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes) },
      cancel() { cancelled = true },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const stream = await streamMavlink(request())
  const reader = stream.body!.getReader()
  assert.deepEqual((await reader.read()).value, bytes, 'SSE frames must pass through unchanged')
  await reader.cancel()
  assert.equal(cancelled, true, 'browser cancellation must cancel the upstream body')
  assert.equal(upstreamSignal?.aborted, true)

  // A connected but silent bridge must not leave stale telemetry indefinitely.
  globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  const silent = await streamMavlink(request())
  await assert.rejects(silent.body!.getReader().read(), /aborted/)

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8765/mission')
    assert.equal(init?.method, 'POST')
    return Response.json({ items: [] })
  }
  assert.deepEqual(await (await proxyMavlink(request(), 'mission')).json(), { items: [] })
  console.log('ok — SSE forwarding, origin rejection, bridge outage, cancellation, silence timeout, mission POST')
} finally {
  globalThis.fetch = originalFetch
}
