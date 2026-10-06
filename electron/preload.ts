import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DownloadedMission, Telemetry } from '../lib/mavlink'

type OpenedFile = { name: string; text: string }

contextBridge.exposeInMainWorld('dryRun', {
  mapboxToken: ipcRenderer.sendSync('mapbox-token') as string,
  setTheme: (theme: 'system' | 'light' | 'dark') => ipcRenderer.send('theme', theme),
  /** The file the app was launched with, then any opened while running. Returns an unsubscribe. */
  onOpenFile(callback: (file: OpenedFile) => void) {
    const listener = (_: IpcRendererEvent, file: OpenedFile) => callback(file)
    ipcRenderer.on('open-file', listener)
    ipcRenderer.invoke('open-file:launch').then((file: OpenedFile | null) => file && callback(file))
    return () => void ipcRenderer.off('open-file', listener)
  },
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
