import { useEffect, useState } from 'react'
import type { Telemetry } from '@/lib/mavlink'

export function useMavlink() {
  const [enabled, setEnabled] = useState(false)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const { mavlink } = window.dryRun
    let active = true
    const unsubscribe = mavlink.onTelemetry((data) => {
      setTelemetry(data)
      setError(null)
    })
    mavlink.connect().then((message) => {
      if (active && message) setError(message)
    })
    return () => {
      active = false
      unsubscribe()
      mavlink.disconnect()
    }
  }, [enabled])

  function toggle() {
    setTelemetry(null)
    setError(null)
    setEnabled((value) => !value)
  }

  return { enabled, telemetry, error, toggle }
}
