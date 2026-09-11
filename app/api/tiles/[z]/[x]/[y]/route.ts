import { NextRequest } from 'next/server'

/**
 * Mapbox terrain proxy. Uses mapbox-terrain-dem-v1: mapbox.terrain-rgb has had
 * no data updates since December 2021. Both encode identically and returned
 * byte-identical tiles at z12/14/15 when checked, so this is a free upgrade.
 * Data is authored to zoom 14; higher zooms only interpolate. Exists purely to keep the token off the client.
 * Returns 404 with {synthetic:true} when no token is configured, which is the
 * client's cue to generate terrain locally so the app is developable offline.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const token = process.env.MAPBOX_TOKEN
  if (!token) {
    return Response.json({ synthetic: true }, { status: 404 })
  }

  const { z, x, y } = await params
  if (![z, x, y].every((v) => /^\d+$/.test(v))) {
    return new Response('bad tile', { status: 400 })
  }

  const url = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${x}/${y}@2x.pngraw?access_token=${token}`
  const upstream = await fetch(url, { next: { revalidate: 86400 } })
  if (!upstream.ok) {
    return new Response('tile unavailable', { status: upstream.status })
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'image/png',
      // ponytail: terrain does not change. Cache hard.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
