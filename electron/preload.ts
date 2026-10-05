import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DownloadedMission, Telemetry } from '../lib/mavlink'

contextBridge.exposeInMainWorld('dryRun', {
  mapboxToken: ipcRenderer.sendSync('mapbox-token') as string,
  mavlink: {
    connect: () => ipcRenderer.invoke('mavlink:connect') as Promise<string | null>,
    disconnect: () => ipcRenderer.invoke('mavlink:disconnect') as Promise<void>,
    downloadMission: () =>
      ipcRenderer.invoke('mavlink:mission') as Promise<{ mission: DownloadedMission } | { error: string }>,
    onTelemetry(callback: (telemetry: Telemetry) => void) {
      const listener = (_: IpcRendererEvent, telemetry: Telemetry) => callback(telemetry)
      ipcRenderer.on('mavlink:telemetry', listener)
      return () => void ipcRenderer.off('mavlink:telemetry', listener)
    },
  },
})
