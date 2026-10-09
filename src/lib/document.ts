import type { AppSettings, Margins, PdfPageSize } from '../types'

export const defaultSettings: AppSettings = {
  theme: 'system',
  defaultPageSize: 'A4',
  defaultOrientation: 'portrait',
  defaultFont: 'Noto Sans Khmer, sans-serif',
  defaultFontSize: 16,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  header: '',
  footer: '[ PDF Mini Tools ]',
  showPageNumbers: false,
  outputFolder: '',
  openOutputFolder: true,
}

export const pageSizes: Record<PdfPageSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
  Custom: { width: 210, height: 297 },
}

export function stripHtml(rawHtml: string): string {
  const temp = document.createElement('div')
  temp.innerHTML = rawHtml
  return temp.textContent ?? temp.innerText ?? ''
}

export function countTextStats(rawHtml: string): { words: number; characters: number } {
  const text = stripHtml(rawHtml).replace(/\s+/g, ' ').trim()
  const words = text ? text.split(/\s+/).length : 0
  const characters = text.length
  return { words, characters }
}

export function parsePageRanges(input: string, pageCount: number): number[] {
  const normalized = input.replace(/\s+/g, '').replace(/,$/, '')

  if (!normalized) {
    throw new Error('Please enter a page range.')
  }

  const results: number[] = []
  const segments = normalized.split(',')

  for (const segment of segments) {
    if (!segment) {
      throw new Error('One or more ranges are invalid.')
    }

    const rangeMatch = segment.match(/^(\d+)(?:-(\d+))?$/)
    if (!rangeMatch) {
      throw new Error(`Invalid page selector: ${segment}`)
    }

    const start = Number(rangeMatch[1])
    const end = rangeMatch[2] ? Number(rangeMatch[2]) : start

    if (start <= 0 || end <= 0 || start > pageCount || end > pageCount) {
      throw new Error(`Page number out of range: ${segment}`)
    }

    if (start > end) {
      throw new Error(`Reversed range: ${segment}`)
    }

    for (let page = start; page <= end; page += 1) {
      results.push(page)
    }
  }

  return [...new Set(results)]
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function buildDocumentHtml(documentHtml: string, settings: AppSettings): string {
  const page = pageSizes[settings.defaultPageSize]
  const orientation = settings.defaultOrientation
  const widthMm = orientation === 'landscape' ? page.height : page.width
  const heightMm = orientation === 'landscape' ? page.width : page.height

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          @font-face {
            font-family: 'Noto Sans Khmer';
            src: url('file:///resources/fonts/NotoSansKhmer-Regular.ttf') format('truetype');
            font-weight: 400;
          }
          @font-face {
            font-family: 'Noto Sans Khmer';
            src: url('file:///resources/fonts/NotoSansKhmer-Bold.ttf') format('truetype');
            font-weight: 700;
          }
          @page {
            size: ${widthMm}mm ${heightMm}mm;
            margin: ${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm;
          }
          html, body {
            margin: 0;
            padding: 0;
            background: white;
            color: #111827;
            font-family: ${settings.defaultFont};
          }
          body {
            line-height: 1.7;
            font-size: ${settings.defaultFontSize}px;
          }
          p { margin: 0 0 0.6em 0; }
          strong, b { font-weight: 700; }
          em, i { font-style: italic; }
          u { text-decoration: underline; }
          .header, .footer { width: 100%; text-align: center; font-size: 11px; color: #374151; }
          .header { margin-bottom: 8mm; }
          .footer { margin-top: 8mm; }
        </style>
      </head>
      <body>
        ${settings.header ? `<div class="header">${settings.header}</div>` : ''}
        <div>${documentHtml || '<p></p>'}</div>
        ${settings.footer || settings.showPageNumbers ? `<div class="footer">${settings.footer}</div>` : ''}
      </body>
    </html>
  `
}

export function clampMargin(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0
  return Number(value.toFixed(2))
}

export function ensureMargins(margins: Margins): Margins {
  return {
    top: clampMargin(margins.top),
    right: clampMargin(margins.right),
    bottom: clampMargin(margins.bottom),
    left: clampMargin(margins.left),
  }
}
