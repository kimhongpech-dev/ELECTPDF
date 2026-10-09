import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pdfMiniApi', {
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('app:save-settings', settings),
  generatePdf: (payload: unknown) => ipcRenderer.invoke('pdf:generate', payload),
  previewPdf: (payload: unknown) => ipcRenderer.invoke('pdf:preview', payload),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  saveFile: (payload: unknown) => ipcRenderer.invoke('fs:write-file', payload),
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
  showItem: (path: string) => ipcRenderer.invoke('shell:show-item', path),
  promptSave: (options: unknown) => ipcRenderer.invoke('dialog:save-file', options),
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
})

declare global {
  interface Window {
    pdfMiniApi: {
      getSettings: () => Promise<unknown>
      saveSettings: (settings: unknown) => Promise<boolean>
      generatePdf: (payload: unknown) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
      previewPdf: (payload: unknown) => Promise<{ ok: boolean; data?: number[]; error?: string }>
      selectFolder: () => Promise<{ ok: boolean; path?: string }>
      saveFile: (payload: unknown) => Promise<{ ok: boolean }>
      openPath: (path: string) => Promise<string>
      showItem: (path: string) => Promise<boolean>
      promptSave: (options: unknown) => Promise<{ ok: boolean; path?: string }>
      readFile: (path: string) => Promise<{ ok: boolean; data?: number[]; error?: string }>
    }
  }
}
