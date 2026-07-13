import { strToU8, zipSync } from 'fflate'
import type { FilePatch, MergePlan, SourceFile } from '../types'

const TEXT_EXTENSIONS = new Set(['.txt', '.yml', '.yaml', '.csv', '.mod', '.gui', '.gfx', '.asset'])

function extension(path: string): string {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index).toLowerCase() : ''
}

export async function readTextFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<SourceFile | undefined> {
  try {
    const handle = await getFileHandle(root, path)
    const file = await handle.getFile()
    return { path, text: await file.text(), handle }
  } catch {
    return undefined
  }
}

export async function readBinaryFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<ArrayBuffer | undefined> {
  try {
    const handle = await getFileHandle(root, path)
    return await (await handle.getFile()).arrayBuffer()
  } catch {
    return undefined
  }
}

export async function getFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(Boolean)
  let directory = root
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part, { create })
  }
  return directory.getFileHandle(parts.at(-1)!, { create })
}

export async function removePath(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean)
  let directory = root
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
  await directory.removeEntry(parts.at(-1)!)
}

export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  const handle = await getFileHandle(root, path, true)
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

async function walk(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  output: Array<{ path: string; handle: FileSystemFileHandle }>,
): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      if (name === '.git' || name === 'node_modules' || name.startsWith('.hoi4-state-merger')) continue
      await walk(handle as FileSystemDirectoryHandle, path, output)
    } else if (TEXT_EXTENSIONS.has(extension(path))) {
      output.push({ path, handle: handle as FileSystemFileHandle })
    }
  }
}

export async function scanTextFiles(root: FileSystemDirectoryHandle): Promise<Map<string, SourceFile>> {
  const handles: Array<{ path: string; handle: FileSystemFileHandle }> = []
  await walk(root, '', handles)
  const files = new Map<string, SourceFile>()
  const concurrency = 24
  for (let index = 0; index < handles.length; index += concurrency) {
    const batch = handles.slice(index, index + concurrency)
    const loaded = await Promise.all(batch.map(async ({ path, handle }) => {
      const file = await handle.getFile()
      return { path, text: await file.text(), handle }
    }))
    for (const file of loaded) files.set(file.path, file)
  }
  return files
}

function reportPayload(plan: MergePlan, modName: string) {
  return {
    createdAt: new Date().toISOString(),
    modName,
    keeper: { before: plan.keeperId, after: plan.keeperFinalId },
    sources: plan.sourceIds,
    stateIdMap: [...plan.idMap.entries()].map(([before, after]) => ({ before, after })),
    result: {
      provinces: plan.totalProvinces,
      manpower: plan.resultManpower,
      resources: plan.resultResources,
      buildings: plan.resultBuildings,
    },
    conflicts: plan.conflicts,
    buildingsAudit: plan.buildingsAudit,
    files: plan.patches.map(({ path, action, summary }) => ({ path, action, summary })),
    references: plan.references,
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportMergeReport(plan: MergePlan, modName: string): void {
  const safeName = modName.replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(
    new Blob([JSON.stringify(reportPayload(plan, modName), null, 2)], { type: 'application/json' }),
    `${safeName}-state-merge-report.json`,
  )
}

export async function saveBackupZip(plan: MergePlan, modName: string): Promise<boolean> {
  const payload: Record<string, Uint8Array> = {}
  for (const patch of plan.patches) payload[patch.path] = strToU8(patch.before)
  payload['merge-report.json'] = strToU8(JSON.stringify(reportPayload(plan, modName), null, 2))
  payload['state-id-map.csv'] = strToU8([
    'before,after',
    ...[...plan.idMap.entries()].map(([before, after]) => `${before},${after}`),
  ].join('\n'))
  const archive = zipSync(payload, { level: 6 })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const suggestedName = `${modName}-state-merge-backup-${timestamp}.zip`
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'ZIP backup', accept: { 'application/zip': ['.zip'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(new Blob([archive], { type: 'application/zip' }))
      await writable.close()
      return true
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return false
      throw error
    }
  }
  downloadBlob(new Blob([archive], { type: 'application/zip' }), suggestedName)
  return true
}

export async function applyPatches(root: FileSystemDirectoryHandle, patches: FilePatch[]): Promise<void> {
  for (const patch of patches) {
    const current = await readTextFile(root, patch.path)
    if (!current || current.text !== patch.before) {
      throw new Error(`Dry Run 后文件已变化，请重扫后再试：${patch.path}`)
    }
  }

  const touched: FilePatch[] = []
  try {
    for (const patch of patches) {
      touched.push(patch)
      if (patch.action === 'delete') await removePath(root, patch.path)
      else await writeTextFile(root, patch.path, patch.after ?? '')
    }
  } catch (error) {
    try {
      await restorePatches(root, touched)
    } catch (rollbackError) {
      throw new Error(
        `写入失败且自动回滚未完成：${error instanceof Error ? error.message : String(error)}；`
        + `回滚错误：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      )
    }
    throw new Error(`写入失败，已自动回滚：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function restorePatches(root: FileSystemDirectoryHandle, patches: FilePatch[]): Promise<void> {
  for (const patch of patches.toReversed()) await writeTextFile(root, patch.path, patch.before)
}
