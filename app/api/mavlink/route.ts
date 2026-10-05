import { streamMavlink } from '@/lib/mavlink-server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return streamMavlink(request)
}
