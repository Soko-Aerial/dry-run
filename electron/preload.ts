import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dryRun', {
  mapboxToken: ipcRenderer.sendSync('mapbox-token') as string,
})
