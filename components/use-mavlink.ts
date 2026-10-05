'use client'

import { useEffect, useState } from 'react'
import type { Telemetry } from '@/lib/mavlink'

export function useMavlink() {
  const [enabled, setEnabled] = useState(false)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const source = new EventSource('/api/mavlink')
    let timeout: ReturnType<typeof setTimeout>
    function unavailable(message: string) {
      clearTimeout(timeout)
      setTelemetry(null)
      setError(message)
    }
    source.onmessage = (event) => {
      try {
        const data: Telemetry = JSON.parse(event.data)
        setTelemetry(data)
        setError(null)
        clearTimeout(timeout)
        // Hide cached telemetry if the browser's connection stalls without an error event.
        timeout = setTimeout(() => unavailable('MAVLink telemetry stream timed out.'), 4000)
      } catch {
        unavailable('Invalid MAVLink telemetry received.')
      }
    }
    source.addEventListener('bridge-error', (event) => {
      try {
        unavailable(JSON.parse((event as MessageEvent).data).error)
      } catch {
        unavailable('MAVLink bridge unavailable. Start it with pnpm mavlink.')
      }
    })
    source.onerror = () => {
      clearTimeout(timeout)
      setTelemetry(null)
      setError((current) => current ?? 'MAVLink stream disconnected. Reconnecting…')
    }
    return () => {
      clearTimeout(timeout)
      source.close()
    }
  }, [enabled])

  function toggle() {
    setTelemetry(null)
    setError(null)
    setEnabled((value) => !value)
  }

  return { enabled, telemetry, error, toggle }
}
