export type ThemeMode = 'system' | 'light' | 'dark'
export type PdfPageSize = 'A4' | 'A5' | 'Letter' | 'Legal' | 'Custom'
export type DocumentOrientation = 'portrait' | 'landscape'

export type SplitMode = 'selected' | 'range' | 'every' | 'every-n'

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface AppSettings {
  theme: ThemeMode
  defaultPageSize: PdfPageSize
  defaultOrientation: DocumentOrientation
  defaultFont: string
  defaultFontSize: number
  margins: Margins
  header: string
  footer: string
  showPageNumbers: boolean
  outputFolder: string
  openOutputFolder: boolean
}

export interface PdfGenerationOptions {
  html: string
  pageSize: PdfPageSize
  orientation: DocumentOrientation
  margins: Margins
  header: string
  footer: string
  showPageNumbers: boolean
}

export interface SaveFileRequest {
  path: string
  content: number[]
}
