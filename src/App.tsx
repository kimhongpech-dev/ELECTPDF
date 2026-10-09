import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bold,
  Check,
  ChevronLeft,
  FileText,
  FolderOpen,
  Italic,
  LayoutGrid,
  Moon,
  Palette,
  Redo2,
  Settings,
  SplitSquareVertical,
  Sun,
  Type,
  Underline,
} from 'lucide-react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  buildDocumentHtml,
  countTextStats,
  defaultSettings,
  ensureMargins,
  formatFileSize,
  parsePageRanges,
  stripHtml,
} from './lib/document'
import type { AppSettings, DocumentOrientation, PdfPageSize, SplitMode, ThemeMode } from './types'

async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  return pdfjsLib
}

type PageKey = 'create' | 'split' | 'settings' | 'about'

const pageSizes: PdfPageSize[] = ['A4', 'A5', 'Letter', 'Legal', 'Custom']

type ToastState = {
  type: 'success' | 'warning' | 'error'
  message: string
} | null

function PdfPageThumbnail({
  pdfDocument,
  pageNumber,
}: {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const render = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 176 / baseViewport.width })
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Unable to render PDF page.')

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise
      } catch {
        if (!cancelled) setError(true)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        void render()
      }
    }, { rootMargin: '240px' })
    observer.observe(canvas)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [pdfDocument, pageNumber])

  return (
    <div className="mb-2 flex h-36 items-center justify-center overflow-hidden rounded-md bg-slate-50 dark:bg-slate-950">
      {error ? (
        <span className="px-2 text-center text-xs text-red-500">Preview unavailable</span>
      ) : (
        <canvas ref={canvasRef} className="max-h-full max-w-full object-contain shadow-sm" />
      )}
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState<PageKey>('create')
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = window.localStorage.getItem('pdf-mini-tools-settings')
    if (!stored) return defaultSettings

    try {
      const parsed = JSON.parse(stored) as Partial<AppSettings>
      return {
        ...defaultSettings,
        ...parsed,
        margins: { ...defaultSettings.margins, ...(parsed.margins ?? {}) },
      }
    } catch {
      return defaultSettings
    }
  })
  const [editorHtml, setEditorHtml] = useState('')
  const [toast, setToast] = useState<ToastState>(null)
  const [previewData, setPreviewData] = useState<Uint8Array | null>(null)
  const [previewDoc, setPreviewDoc] = useState<PDFDocumentProxy | null>(null)
  const [previewPage, setPreviewPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fitToPage, setFitToPage] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isSavingPdf, setIsSavingPdf] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfMeta, setPdfMeta] = useState<{ pages: number; size: number } | null>(null)
  const [splitPdfDoc, setSplitPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [isDraggingPdf, setIsDraggingPdf] = useState(false)
  const [pageSet, setPageSet] = useState<number[]>([])
  const [selectedPages, setSelectedPages] = useState<number[]>([])
  const [splitMode, setSplitMode] = useState<SplitMode>('selected')
  const [rangeInput, setRangeInput] = useState('1-5')
  const [outputFolder, setOutputFolder] = useState('')
  const [everyN, setEveryN] = useState(5)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pdfLoadIdRef = useRef(0)

  const stats = useMemo(() => countTextStats(editorHtml), [editorHtml])

  useEffect(() => {
    window.localStorage.setItem('pdf-mini-tools-settings', JSON.stringify(settings))
    if (window.pdfMiniApi) {
      void window.pdfMiniApi.saveSettings(settings)
    }
  }, [settings])

  useEffect(() => {
    const preference = settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme
    document.documentElement.classList.toggle('dark', preference === 'dark')
  }, [settings.theme])

  const generatePreview = useCallback(async (rawHtml: string) => {
    if (!window.pdfMiniApi) {
      setPreviewError('PDF preview is unavailable in this app session.')
      return
    }
    if (!stripHtml(rawHtml).trim()) {
      setPreviewError(null)
      setPreviewData(null)
      setPreviewDoc(null)
      return
    }

    setPreviewLoading(true)
    setPreviewError(null)

    try {
      const html = buildDocumentHtml(rawHtml, settings)
      const result = await window.pdfMiniApi.previewPdf({
        html,
        pageSize: settings.defaultPageSize,
        orientation: settings.defaultOrientation,
        margins: ensureMargins(settings.margins),
        header: settings.header,
        footer: settings.footer,
        showPageNumbers: settings.showPageNumbers,
      })

      if (!result.ok || !result.data?.length) {
        throw new Error(result.error || 'The preview PDF was empty.')
      }
      setPreviewData(new Uint8Array(result.data))
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Unable to generate preview.')
    } finally {
      setPreviewLoading(false)
    }
  }, [settings])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const rawHtml = editorRef.current?.innerHTML ?? ''
      if (!stripHtml(rawHtml).trim()) {
        setPreviewData(null)
        setPreviewDoc(null)
        setPreviewError(null)
        return
      }
      void generatePreview(rawHtml)
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [editorHtml, generatePreview])

  useEffect(() => {
    if (!previewData) return
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null
    const load = async () => {
      setPreviewLoading(true)
      try {
        const pdfjsLib = await loadPdfJs()
        if (cancelled) return
        loadingTask = pdfjsLib.getDocument({ data: previewData.slice() })
        const pdfDocument = await loadingTask.promise
        if (!cancelled) {
          setPreviewDoc(pdfDocument)
          setPreviewPage(1)
          setPreviewError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewDoc(null)
          setPreviewError(error instanceof Error ? error.message : 'Unable to render preview.')
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (loadingTask) void loadingTask.destroy()
    }
  }, [previewData])

  useEffect(() => {
    if (!previewDoc || !canvasRef.current) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    const renderPage = async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const page = await previewDoc.getPage(previewPage)
        if (cancelled) return
        const viewport = page.getViewport({ scale: fitToPage ? 1.2 : zoom })
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Unable to create the PDF preview canvas.')
        canvas.width = viewport.width
        canvas.height = viewport.height
        renderTask = page.render({ canvas, canvasContext: context, viewport })
        await renderTask.promise
      } catch (error) {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : 'Unable to render preview page.')
        }
      }
    }

    void renderPage()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [previewDoc, previewPage, fitToPage, zoom])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const applyEditorCommand = (command: string, value?: string) => {
    if (!editorRef.current) return
    editorRef.current.focus()
    document.execCommand(command, false, value)
    setEditorHtml(editorRef.current.innerHTML)
  }

  const setAlignment = (alignment: 'left' | 'center' | 'right') => {
    const map: Record<'left' | 'center' | 'right', string> = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
    }
    applyEditorCommand(map[alignment])
  }

  const savePdf = async () => {
    const content = stripHtml(editorHtml)
    if (!content.trim()) {
      setToast({ type: 'warning', message: 'Add text before saving a PDF.' })
      return
    }

    if (!window.pdfMiniApi) {
      setToast({ type: 'error', message: 'PDF generator is unavailable.' })
      return
    }

    setIsSavingPdf(true)
    try {
      const html = buildDocumentHtml(editorRef.current?.innerHTML ?? '', settings)
      const result = await window.pdfMiniApi.generatePdf({
        html,
        pageSize: settings.defaultPageSize,
        orientation: settings.defaultOrientation,
        margins: ensureMargins(settings.margins),
        header: settings.header,
        footer: settings.footer,
        showPageNumbers: settings.showPageNumbers,
      })

      if (result.canceled) return
      if (!result.ok || !result.path) {
        throw new Error(result.error || 'Unable to create PDF.')
      }

      setToast({ type: 'success', message: 'PDF saved successfully.' })
      if (settings.openOutputFolder) {
        void window.pdfMiniApi.openPath(result.path)
      }
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to create PDF.',
      })
    } finally {
      setIsSavingPdf(false)
    }
  }

  const handlePdfFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setToast({ type: 'warning', message: 'Choose a PDF file to split.' })
      return
    }

    const loadId = ++pdfLoadIdRef.current
    setPdfFile(file)
    setPdfMeta(null)
    setSplitPdfDoc(null)
    setPageSet([])
    setSelectedPages([])
    setPdfLoading(true)

    try {
      const pdfjsLib = await loadPdfJs()
      const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
      if (loadId !== pdfLoadIdRef.current) return
      setPdfMeta({ pages: doc.numPages, size: file.size })
      setSplitPdfDoc(doc)
      setPageSet(Array.from({ length: doc.numPages }, (_, index) => index + 1))
      setSelectedPages([1])
    } catch (error) {
      if (loadId !== pdfLoadIdRef.current) return
      setPdfFile(null)
      setPdfMeta(null)
      setSplitPdfDoc(null)
      setPageSet([])
      setSelectedPages([])
      setToast({
        type: 'error',
        message: error instanceof Error && /password|encrypt/i.test(error.message)
          ? 'This PDF is password-protected and cannot be opened.'
          : 'Unable to open this PDF. It may be damaged or unsupported.',
      })
    } finally {
      if (loadId === pdfLoadIdRef.current) setPdfLoading(false)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void handlePdfFile(file)
  }

  const handlePdfDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingPdf(false)
    const file = event.dataTransfer.files[0]
    if (file) void handlePdfFile(file)
  }

  const togglePageSelection = (pageNumber: number, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedPages((current) =>
        current.includes(pageNumber)
          ? current.filter((item) => item !== pageNumber)
          : [...current, pageNumber],
      )
      return
    }

    if (event.shiftKey) {
      const previous = selectedPages[selectedPages.length - 1] ?? pageNumber
      const start = Math.min(previous, pageNumber)
      const end = Math.max(previous, pageNumber)
      const range = Array.from({ length: end - start + 1 }, (_, index) => start + index)
      setSelectedPages(Array.from(new Set([...selectedPages, ...range])))
      return
    }

    setSelectedPages([pageNumber])
  }

  const splitByMode = async (pdfDoc: import('pdf-lib').PDFDocument, fileName: string) => {
    const { PDFDocument } = await import('pdf-lib')
    const copyPages = async (pages: number[]) => {
      const nextDoc = await PDFDocument.create()
      const copied = await nextDoc.copyPages(pdfDoc, pages.map((pageNumber) => pageNumber - 1))
      copied.forEach((page) => nextDoc.addPage(page))
      return new Uint8Array(await nextDoc.save())
    }

    if (splitMode === 'selected') {
      const selected = selectedPages.length ? selectedPages : pageSet
      return [{ name: `${fileName}_selected.pdf`, bytes: await copyPages(selected) }]
    }

    if (splitMode === 'range') {
      const parsed = parsePageRanges(rangeInput, pdfDoc.getPageCount())
      return [{ name: `${fileName}_range.pdf`, bytes: await copyPages(parsed) }]
    }

    if (splitMode === 'every') {
      const outputs: { name: string; bytes: Uint8Array }[] = []
      for (let page = 1; page <= pdfDoc.getPageCount(); page += 1) {
        outputs.push({
          name: `${fileName}_page_${String(page).padStart(3, '0')}.pdf`,
          bytes: await copyPages([page]),
        })
      }
      return outputs
    }

    const outputs: { name: string; bytes: Uint8Array }[] = []
    for (let index = 1; index <= pdfDoc.getPageCount(); index += everyN) {
      const chunk = Array.from({ length: Math.min(everyN, pdfDoc.getPageCount() - index + 1) }, (_, offset) => index + offset)
      outputs.push({
        name: `${fileName}_part_${String(outputs.length + 1).padStart(3, '0')}.pdf`,
        bytes: await copyPages(chunk),
      })
    }
    return outputs
  }

  const renderSplitPdf = async () => {
    if (!pdfFile) {
      setToast({ type: 'warning', message: 'Select a PDF first.' })
      return
    }

    try {
      const source = await pdfFile.arrayBuffer()
      const { PDFDocument } = await import('pdf-lib')
      const pdfDoc = await PDFDocument.load(source)
      const fallbackFolder = outputFolder || settings.outputFolder
      let finalFolder = fallbackFolder
      if (!finalFolder) {
        const result = await window.pdfMiniApi.selectFolder()
        if (!result.ok || !result.path) {
          setToast({ type: 'warning', message: 'Choose an output folder.' })
          return
        }
        finalFolder = result.path
        setOutputFolder(result.path)
      }

      const fileName = pdfFile.name.replace(/\.pdf$/i, '') || 'document'
      const outputs = await splitByMode(pdfDoc, fileName)
      for (const entry of outputs) {
        await window.pdfMiniApi.saveFile({ path: `${finalFolder}/${entry.name}`, content: Array.from(entry.bytes) })
      }

      setToast({ type: 'success', message: 'PDF split successfully.' })
      if (settings.openOutputFolder) {
        void window.pdfMiniApi.showItem(finalFolder)
      }
    } catch {
      setToast({ type: 'error', message: 'Unable to split this PDF.' })
    }
  }

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: 'System', icon: Palette },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ]

  const themeLabel = settings.theme === 'system' ? 'System' : settings.theme === 'dark' ? 'Dark' : 'Light'

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-screen">
        <aside className="w-[240px] border-r border-slate-200 bg-white/90 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <div className="mb-6">
            <p className="text-xl font-semibold">PDF Mini Tools</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Simple tools for your PDFs</p>
          </div>

          <div className="mb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Tools</p>
            <nav className="space-y-2">
              <button
                type="button"
                onClick={() => setActivePage('create')}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${activePage === 'create' ? 'bg-blue-600 text-white shadow-soft' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
              >
                <FileText size={16} />
                Create PDF
              </button>
              <button
                type="button"
                onClick={() => setActivePage('split')}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${activePage === 'split' ? 'bg-blue-600 text-white shadow-soft' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
              >
                <SplitSquareVertical size={16} />
                Split PDF
              </button>
            </nav>
          </div>

          <div className="space-y-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">App</p>
            <button
              type="button"
              onClick={() => setActivePage('settings')}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${activePage === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            >
              <Settings size={16} />
              Settings
            </button>
            <button
              type="button"
              onClick={() => setActivePage('about')}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${activePage === 'about' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            >
              <Type size={16} />
              About
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto p-5">
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Desktop utility</p>
              <h1 className="mt-1 text-2xl font-semibold">{activePage === 'create' ? 'Create PDF' : activePage === 'split' ? 'Split PDF' : activePage === 'settings' ? 'Settings' : 'About'}</h1>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">{themeLabel}</div>
          </div>

          {activePage === 'create' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Write, format, preview, and export your document.</h2>
                  </div>
                  <button type="button" onClick={savePdf} disabled={isSavingPdf} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
                    {isSavingPdf ? 'Creating PDF…' : 'Save PDF'}
                  </button>
                </div>

                <div className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/30">
                      <button type="button" onClick={() => applyEditorCommand('undo')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Undo"><ChevronLeft size={14} /></button>
                      <button type="button" onClick={() => applyEditorCommand('redo')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Redo"><Redo2 size={14} /></button>
                      <div className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
                      <select value={settings.defaultFont} onChange={(event) => setSettings((current) => ({ ...current, defaultFont: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
                        <option value="Noto Sans Khmer, sans-serif">Noto Sans Khmer</option>
                        <option value="sans-serif">Sans-serif</option>
                        <option value="serif">Serif</option>
                        <option value="monospace">Monospace</option>
                      </select>
                      <input type="number" min={10} max={40} value={settings.defaultFontSize} onChange={(event) => setSettings((current) => ({ ...current, defaultFontSize: Number(event.target.value) || 16 }))} className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
                      <div className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
                      <button type="button" onClick={() => applyEditorCommand('bold')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Bold"><Bold size={14} /></button>
                      <button type="button" onClick={() => applyEditorCommand('italic')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Italic"><Italic size={14} /></button>
                      <button type="button" onClick={() => applyEditorCommand('underline')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Underline"><Underline size={14} /></button>
                      <button type="button" onClick={() => setAlignment('left')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Align left"><Type size={14} /></button>
                      <button type="button" onClick={() => setAlignment('center')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Align center"><LayoutGrid size={14} /></button>
                      <button type="button" onClick={() => setAlignment('right')} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-700" title="Align right"><Type size={14} /></button>
                    </div>

                    <div ref={editorRef} contentEditable suppressContentEditableWarning className="min-h-[360px] rounded-xl border border-slate-200 bg-white p-4 text-base leading-7 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100" onInput={(event) => setEditorHtml(event.currentTarget.innerHTML)} style={{ fontFamily: settings.defaultFont, fontSize: `${settings.defaultFontSize}px` }} data-placeholder="Start writing or paste your text here..." />

                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      <span>{stats.words} words · {stats.characters} characters</span>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/30">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">Document settings</p>
                    </div>

                    <div className="space-y-3">
                      <label className="block text-xs uppercase tracking-[0.2em] text-slate-500">Page</label>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <select value={settings.defaultPageSize} onChange={(event) => setSettings((current) => ({ ...current, defaultPageSize: event.target.value as PdfPageSize }))} className="rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
                          {pageSizes.map((pageSize) => (
                            <option key={pageSize} value={pageSize}>{pageSize}</option>
                          ))}
                        </select>
                        <select value={settings.defaultOrientation} onChange={(event) => setSettings((current) => ({ ...current, defaultOrientation: event.target.value as DocumentOrientation }))} className="rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
                          <option value="portrait">Portrait</option>
                          <option value="landscape">Landscape</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Margins</label>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
                          <div key={key} className="space-y-1">
                            <label className="text-xs capitalize text-slate-500">{key}</label>
                            <input type="number" value={settings.margins[key]} min={0} onChange={(event) => setSettings((current) => ({
                              ...current,
                              margins: { ...current.margins, [key]: Number(event.target.value) || 0 },
                            }))} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900" />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Header & Footer</label>
                      <input value={settings.header} onChange={(event) => setSettings((current) => ({ ...current, header: event.target.value }))} placeholder="Header" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900" />
                      <input value={settings.footer} onChange={(event) => setSettings((current) => ({ ...current, footer: event.target.value }))} placeholder="Footer" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900" />
                      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={settings.showPageNumbers} onChange={(event) => setSettings((current) => ({ ...current, showPageNumbers: event.target.checked }))} />
                        Show page numbers
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">PDF Preview</h3>
                  <div className="flex items-center gap-2 text-sm">
                    <button type="button" onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.1).toFixed(2))))} className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">−</button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button type="button" onClick={() => setZoom((current) => Math.min(2.5, Number((current + 0.1).toFixed(2))))} className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">+</button>
                    <button type="button" onClick={() => setFitToPage((current) => !current)} className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">Fit</button>
                  </div>
                </div>

                {previewDoc ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/30">
                      <button type="button" onClick={() => setPreviewPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">Previous</button>
                      <span className="text-sm">{previewPage} / {previewDoc.numPages}</span>
                      <button type="button" onClick={() => setPreviewPage((current) => Math.min(previewDoc.numPages, current + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">Next</button>
                    </div>
                    <div className="flex justify-center overflow-auto rounded-2xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-950/50">
                      <canvas ref={canvasRef} className="max-w-full rounded-lg border border-slate-300 bg-white shadow-sm dark:border-slate-700" />
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-950/30">
                    <div className="mb-3 rounded-full bg-blue-100 p-4 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                      <FileText size={24} />
                    </div>
                    <p className="text-lg font-medium">Your PDF preview will appear here.</p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Start writing to generate a preview.</p>
                  </div>
                )}

                {previewLoading && <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">Updating preview...</div>}
                {previewError && <div className="mt-3 text-sm text-red-500">{previewError}</div>}
              </div>
            </div>
          )}

          {activePage === 'split' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <div
                      onDragEnter={(event) => {
                        event.preventDefault()
                        setIsDraggingPdf(true)
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setIsDraggingPdf(false)
                        }
                      }}
                      onDrop={handlePdfDrop}
                      className={`flex min-h-[220px] items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${isDraggingPdf ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30'}`}
                    >
                      <div>
                        <div className="mb-3 flex justify-center text-blue-500"><FileText size={32} /></div>
                        <p className="text-lg font-medium">{pdfLoading ? 'Loading PDF pages…' : isDraggingPdf ? 'Release to load PDF' : 'Drop PDF here'}</p>
                        <p className="mt-2 text-sm text-slate-500">{pdfLoading ? 'Preparing page previews' : 'or'}</p>
                        <label className="mt-3 inline-flex cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
                          Choose PDF
                          <input type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />
                        </label>
                      </div>
                    </div>

                    {pdfFile && (
                      <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="font-medium">{pdfFile.name}</p>
                        <div className="mt-2 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                          {pdfMeta ? (
                            <>
                              <span>{formatFileSize(pdfMeta.size)}</span>
                              <span>{pdfMeta.pages} pages</span>
                            </>
                          ) : pdfLoading ? (
                            <span>Loading and reading pages…</span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/30">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Split mode</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {(['selected', 'range', 'every', 'every-n'] as const).map((mode) => (
                          <button key={mode} type="button" onClick={() => setSplitMode(mode)} className={`rounded-xl px-3 py-2 text-sm ${splitMode === mode ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
                            {mode === 'selected' ? 'Selected Pages' : mode === 'range' ? 'Page Range' : mode === 'every' ? 'Every Page' : 'Every N Pages'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {splitMode === 'range' && (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Range</label>
                        <input value={rangeInput} onChange={(event) => setRangeInput(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="1-5, 8, 10-15" />
                      </div>
                    )}

                    {splitMode === 'every-n' && (
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Every N Pages</label>
                        <input type="number" min={1} value={everyN} onChange={(event) => setEveryN(Math.max(1, Number(event.target.value) || 1))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Output folder</label>
                      <div className="flex gap-2">
                        <input value={outputFolder} onChange={(event) => setOutputFolder(event.target.value)} className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="Select a folder" />
                        <button type="button" onClick={async () => {
                          const result = await window.pdfMiniApi.selectFolder()
                          if (result.ok && result.path) setOutputFolder(result.path)
                        }} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"><FolderOpen size={16} /></button>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={settings.openOutputFolder} onChange={(event) => setSettings((current) => ({ ...current, openOutputFolder: event.target.checked }))} />
                      Open output folder after export
                    </label>

                    <button type="button" onClick={renderSplitPdf} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-500">
                      Split PDF
                    </button>
                  </div>
                </div>
              </div>

              {pdfMeta && splitPdfDoc && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Pages</h3>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setSelectedPages(pageSet)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700">Select all</button>
                      <button type="button" onClick={() => setSelectedPages([])} className="rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700">Clear</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {pageSet.map((pageNumber) => (
                      <button key={pageNumber} type="button" onClick={(event) => togglePageSelection(pageNumber, event)} className={`rounded-xl border p-2 text-left ${selectedPages.includes(pageNumber) ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
                        <PdfPageThumbnail pdfDocument={splitPdfDoc} pageNumber={pageNumber} />
                        <div className="text-xs">Page {pageNumber}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activePage === 'settings' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Appearance</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {themeOptions.map(({ value, label, icon: Icon }) => (
                      <button key={value} type="button" onClick={() => setSettings((current) => ({ ...current, theme: value }))} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm ${settings.theme === value ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200' : 'border-slate-200 dark:border-slate-700'}`}>
                        <Icon size={16} /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Output</h3>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={settings.openOutputFolder} onChange={(event) => setSettings((current) => ({ ...current, openOutputFolder: event.target.checked }))} />
                    Open output folder after export
                  </label>
                </div>
              </div>
            </div>
          )}

          {activePage === 'about' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="space-y-4">
                <p className="text-2xl font-semibold">PDF Mini Tools</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Version 1.0.0</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">A lightweight offline PDF utility.</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  <li>Split PDF</li>
                  <li>Text to PDF</li>
                  <li>English + Khmer</li>
                  <li>PDF preview</li>
                  <li>Offline processing</li>
                </ul>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Your files are processed locally on your computer. PDF Mini Tools does not upload your documents.</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-soft dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <Check className="text-green-500" size={16} /> : toast.type === 'warning' ? <AlertCircle className="text-yellow-500" size={16} /> : <AlertCircle className="text-red-500" size={16} />}
            {toast.message}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
