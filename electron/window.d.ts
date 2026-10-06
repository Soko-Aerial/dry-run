// Exposed by electron/preload.ts.
interface Window {
  dryRun: {
    mapboxToken: string
    /** Applies the app theme to native UI, including the window buttons over the header. */
    setTheme(theme: 'system' | 'light' | 'dark'): void
    /** Calls back with the launch file, then files opened while running. Returns an unsubscribe. */
    onOpenFile(callback: (file: { name: string; text: string }) => void): () => void
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
