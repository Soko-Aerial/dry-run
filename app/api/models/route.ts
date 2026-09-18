import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return new Response('Forbidden', { status: 403 })
  }
  const length = Number(request.headers.get('content-length'))
  if (length > 50 * 1024 * 1024) {
    return new Response('Model must be at most 50 MB.', { status: 413 })
  }
  const bytes = await request.arrayBuffer()
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) {
    return new Response('Model must be between 1 byte and 50 MB.', { status: 413 })
  }
  const directory = join(tmpdir(), 'dry-run-models')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  await writeFile(join(directory, `${id}.glb`), Buffer.from(bytes), { flag: 'wx', mode: 0o600 })
  return Response.json({ url: `/api/models/${id}.glb` }, { headers: { 'Cache-Control': 'private, no-store' } })
}
