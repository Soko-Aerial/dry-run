import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string }> }

async function modelPath({ params }: Context) {
  const { id } = await params
  return /^[0-9a-f-]{36}\.glb$/.test(id) ? join(tmpdir(), 'dry-run-models', id) : null
}

export async function GET(_request: Request, context: Context) {
  const path = await modelPath(context)
  if (!path) return new Response('Not found', { status: 404 })
  try {
    const bytes = await readFile(path)
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, no-store' },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

export async function DELETE(_request: Request, context: Context) {
  const path = await modelPath(context)
  if (!path) return new Response('Not found', { status: 404 })
  try { await unlink(path) } catch { /* Already removed. */ }
  return new Response(null, { status: 204 })
}
