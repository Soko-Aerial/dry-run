import { proxyMavlink } from '@/lib/mavlink-server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return proxyMavlink(request, 'telemetry')
}
