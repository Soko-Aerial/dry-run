/** Mapbox GL JS needs a public (pk.) token in the browser. */
export const dynamic = 'force-dynamic'

export async function GET() {
  const token = process.env.MAPBOX_TOKEN
  if (!token?.startsWith('pk.')) {
    return new Response('public Mapbox token unavailable', { status: 404 })
  }
  return Response.json({ token }, { headers: { 'cache-control': 'private, no-store' } })
}
