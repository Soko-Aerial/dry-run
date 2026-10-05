import { proxyMavlink } from '@/lib/mavlink-server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return proxyMavlink(request, 'mission')
}
