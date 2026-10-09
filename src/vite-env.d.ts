/// <reference types="vite/client" />

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

export {}
