'use client'

import { useEffect, useState } from 'react'
import type { Telemetry } from '@/lib/mavlink'

export function useMavlink() {
  const [enabled, setEnabled] = useState(false)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let controller: AbortController
    async function poll() {
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const response = await fetch('/api/mavlink', { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'MAVLink connection unavailable.')
        if (active) {
          setTelemetry(data)
          setError(null)
        }
      } catch (e) {
        if (active) {
          setTelemetry(null)
          setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'MAVLink connection timed out.')
        }
      } finally {
        clearTimeout(timeout)
        if (active) timer = setTimeout(poll, 500)
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
      controller?.abort()
    }
  }, [enabled])

  function toggle() {
    setTelemetry(null)
    setError(null)
    setEnabled((value) => !value)
  }

  return { enabled, telemetry, error, toggle }
}
