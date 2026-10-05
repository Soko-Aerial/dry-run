const headers = { 'Cache-Control': 'no-store' }

export async function proxyMavlink(request: Request, path: 'telemetry' | 'mission') {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers })
  }
  try {
    const response = await fetch(`http://127.0.0.1:8765/${path}`, {
      method: path === 'mission' ? 'POST' : 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(path === 'mission' ? 25000 : 2000),
    })
    return Response.json(await response.json(), { status: response.status, headers })
  } catch {
    return Response.json({ error: path === 'mission'
      ? 'Mission download unavailable. Check the local MAVLink bridge and retry.'
      : 'MAVLink bridge unavailable. Start it with pnpm mavlink.' }, { status: 503, headers })
  }
}
