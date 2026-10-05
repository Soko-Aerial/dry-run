// Exposed by electron/preload.ts.
interface Window {
  dryRun: {
    mapboxToken: string
    mavlink: {
      /** Resolves to an error message, or null once listening. */
      connect(): Promise<string | null>
      disconnect(): Promise<void>
      downloadMission(): Promise<{ mission: import('../lib/mavlink').DownloadedMission } | { error: string }>
      /** Returns an unsubscribe function. */
      onTelemetry(callback: (telemetry: import('../lib/mavlink').Telemetry) => void): () => void
    }
  }
}
