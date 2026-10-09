import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const rootDir = path.resolve(__dirname, '..')

let mainWindow: BrowserWindow | null = null

async function renderPdf(html: string, options: Record<string, unknown>) {
  const fontsDirectory = path.join(rootDir, 'resources', 'fonts')
  const regularFont = fs.readFileSync(path.join(fontsDirectory, 'NotoSansKhmer-Regular.ttf')).toString('base64')
  const boldFont = fs.readFileSync(path.join(fontsDirectory, 'NotoSansKhmer-Bold.ttf')).toString('base64')
  const htmlWithFonts = html
    .replace('file:///resources/fonts/NotoSansKhmer-Regular.ttf', `data:font/ttf;base64,${regularFont}`)
    .replace('file:///resources/fonts/NotoSansKhmer-Bold.ttf', `data:font/ttf;base64,${boldFont}`)

  const tempWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  try {
    await tempWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlWithFonts)}`)
    await tempWindow.webContents.executeJavaScript('document.fonts.ready.then(() => true)')

    const chosenPageSize = typeof options.pageSize === 'string' ? options.pageSize : 'A4'
    const landscape = options.orientation === 'landscape'
    const pageSize: 'A4' | 'A5' | 'Letter' | 'Legal' =
      chosenPageSize === 'A5' || chosenPageSize === 'Letter' || chosenPageSize === 'Legal'
        ? chosenPageSize
        : 'A4'
    const pdf = await tempWindow.webContents.printToPDF({
      printBackground: true,
      landscape,
      pageSize,
      preferCSSPageSize: true,
    })

    if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw new Error('PDF generation returned an invalid document.')
    }
    return pdf
  } finally {
    if (!tempWindow.isDestroyed()) tempWindow.close()
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    icon: path.join(isDev ? rootDir : process.resourcesPath, isDev ? 'resources/icon.png' : 'icon.png'),
    backgroundColor: '#0b1220',
    title: 'PDF Mini Tools',
    webPreferences: {
      preload: path.join(rootDir, 'dist-electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173')
  } else {
    void mainWindow.loadFile(path.join(rootDir, 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('app:get-settings', async () => {
  const settingPath = path.join(app.getPath('userData'), 'settings.json')
  try {
    return JSON.parse(fs.readFileSync(settingPath, 'utf8'))
  } catch {
    return {}
  }
})

ipcMain.handle('app:save-settings', async (_event, settings) => {
  const settingPath = path.join(app.getPath('userData'), 'settings.json')
  fs.writeFileSync(settingPath, JSON.stringify(settings, null, 2), 'utf8')
  return true
})

ipcMain.handle('pdf:generate', async (_event, payload: { html?: string } & Record<string, unknown>) => {
  try {
    if (typeof payload?.html !== 'string' || !payload.html.trim()) {
      throw new Error('There is no document content to export.')
    }

    const result = await dialog.showSaveDialog({
      title: 'Save PDF',
      defaultPath: 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }

    const pdf = await renderPdf(payload.html, payload)
    await fs.promises.writeFile(result.filePath, pdf)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to create PDF.' }
  }
})

ipcMain.handle('pdf:preview', async (_event, payload: { html?: string } & Record<string, unknown>) => {
  try {
    if (typeof payload?.html !== 'string' || !payload.html.trim()) {
      throw new Error('There is no document content to preview.')
    }

    const pdf = await renderPdf(payload.html, payload)
    return { ok: true, data: Array.from(pdf) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to generate preview.' }
  }
})

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths.length) {
    return { ok: false }
  }
  return { ok: true, path: result.filePaths[0] }
})

ipcMain.handle('fs:write-file', async (_event, payload) => {
  const { path: filePath, content } = payload as { path: string; content: number[] }
  fs.writeFileSync(filePath, Buffer.from(content))
  return { ok: true }
})

ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
  const result = await shell.openPath(targetPath)
  return result
})

ipcMain.handle('shell:show-item', async (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath)
  return true
})

ipcMain.handle('dialog:save-file', async (_event, options) => {
  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultPath ?? 'output.pdf',
    filters: options.filters ?? [{ name: 'File', extensions: ['pdf'] }],
  })

  if (result.canceled || !result.filePath) {
    return { ok: false }
  }

  return { ok: true, path: result.filePath }
})

ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath)
    return { ok: true, data: Array.from(buffer) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to read file.' }
  }
})
