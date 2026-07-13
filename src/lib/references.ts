import type {
  BuildingsAudit, BuildingsLineIssue, BuildingsMappingAudit, PdxAtom, PdxBlock, ReferenceHit,
} from '../types'
import { applyReplacements, parsePdx, type Replacement } from './pdx'

const STATE_VALUE_KEYS = new Set([
  'capital', 'set_capital', 'state', 'target_state', 'state_id', 'transfer_state',
  'add_state_core', 'remove_state_core', 'add_state_claim', 'remove_state_claim',
  'owns_state', 'controls_state', 'has_full_control_of_state',
  'force_link_ownership_to', 'goto_state',
])

const NON_STATE_ID_KEYS = new Set([
  'set_state_owner', 'set_state_controller', 'is_core_of', 'is_claimed_by',
  'set_state_owner_to', 'set_state_controller_to', 'set_state_category',
  'set_state_name', 'reset_state_name', 'set_state_flag', 'clr_state_flag',
  'has_state_flag', 'modify_state_flag', 'add_state_modifier', 'remove_state_modifier',
  'has_state_modifier', 'state_event', 'state_population', 'num_of_owned_states',
  'add_core_of', 'remove_core_of', 'add_claim_by', 'remove_claim_by',
  'add_claim_of', 'remove_claim_of',
])

// Some PDX collections encode a State ID as the assignment key instead of the
// value. Keep this allow-list deliberately narrow: numeric keys under e.g.
// history > buildings are Province IDs and must not be rewritten.
const STATE_ID_KEY_PARENT_CONTEXTS = new Set([
  'air_wings',
])

const NON_STATE_ID_KEY_PARENT_CONTEXTS = new Set([
  'buildings',
  'provinces',
  'victory_points',
  'random_list',
])

const NON_SCRIPT_PATHS = [
  /^map\//i,
  /(^|\/)localisation\//i,
]

function isPdxScript(path: string): boolean {
  return /\.(txt|mod)$/i.test(path) && !NON_SCRIPT_PATHS.some((pattern) => pattern.test(path))
}

function lineNumber(text: string, index: number): number {
  let count = 1
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) count += 1
  return count
}

function lineRange(text: string, index: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const next = text.indexOf('\n', index)
  return { start, end: next < 0 ? text.length : next }
}

function lineWithReplacement(text: string, start: number, end: number, replacement: string): {
  before: string
  after: string
} {
  const range = lineRange(text, start)
  return {
    before: text.slice(range.start, range.end).trim(),
    after: `${text.slice(range.start, start)}${replacement}${text.slice(end, range.end)}`.trim(),
  }
}

interface Candidate {
  start: number
  end: number
  oldId: number
  newId: number
  keyPath: string
  rule: string
  status: ReferenceHit['status']
  replacement?: string
}

function exactInteger(text: string, atom: PdxAtom): number | undefined {
  const raw = text.slice(atom.start, atom.end)
  return /^\d+$/.test(raw) ? Number(raw) : undefined
}

function exactIntegerAssignmentKey(text: string, keyStart: number, key: string): number | undefined {
  const raw = text.slice(keyStart, keyStart + key.length)
  return /^\d+$/.test(raw) ? Number(raw) : undefined
}

export function rewriteStateReferences(
  path: string,
  text: string,
  idMap: Map<number, number>,
): { text: string; hits: ReferenceHit[] } {
  if (idMap.size === 0 || !isPdxScript(path)) return { text, hits: [] }
  const candidates: Candidate[] = []
  const root = parsePdx(text)

  const addMapped = (
    start: number,
    end: number,
    oldId: number,
    keyPath: string,
    rule: string,
    prefix = '',
  ) => {
    const newId = idMap.get(oldId)
    if (newId === undefined || newId === oldId) return
    candidates.push({
      start,
      end,
      oldId,
      newId,
      keyPath,
      rule,
      status: 'updated',
      replacement: `${prefix}${newId}`,
    })
  }

  const visit = (block: PdxBlock, parents: string[]) => {
    for (const item of block.items) {
      if (item.kind === 'assignment') {
        const key = item.key.toLowerCase()
        const keyPath = [...parents, item.key].join(' > ')
        if (item.value.kind === 'block') {
          const parentContext = parents.at(-1)?.toLowerCase()
          const oldId = exactIntegerAssignmentKey(text, item.keyStart, item.key)
          if (parentContext && oldId !== undefined && idMap.has(oldId)) {
            if (STATE_ID_KEY_PARENT_CONTEXTS.has(parentContext)) {
              addMapped(
                item.keyStart,
                item.keyStart + item.key.length,
                oldId,
                keyPath,
                `${parents.at(-1)} State ID 数字键`,
              )
            } else if (!NON_STATE_ID_KEY_PARENT_CONTEXTS.has(parentContext)) {
              candidates.push({
                start: item.keyStart,
                end: item.keyStart + item.key.length,
                oldId,
                newId: idMap.get(oldId)!,
                keyPath,
                rule: `未分类数字块键；可能是旧式 State scope，也可能是权重或其他 ID`,
                status: 'review',
              })
            }
          }
          visit(item.value, [...parents, item.key])
          continue
        }
        const oldId = exactInteger(text, item.value)
        if (oldId === undefined || !idMap.has(oldId)) continue
        if (STATE_VALUE_KEYS.has(key)) {
          addMapped(item.value.start, item.value.end, oldId, keyPath, `State 变量 ${item.key}`)
        } else if (key.includes('state') && !NON_STATE_ID_KEYS.has(key)) {
          candidates.push({
            start: item.value.start,
            end: item.value.end,
            oldId,
            newId: idMap.get(oldId)!,
            keyPath,
            rule: `未注册的 State 风格变量 ${item.key}`,
            status: 'review',
          })
        }
        continue
      }

      const raw = text.slice(item.start, item.end)
      const match = raw.match(/^state:(\d+)$/i)
      if (!match) continue
      const oldId = Number(match[1])
      addMapped(item.start, item.end, oldId, [...parents, 'state scope'].join(' > '), 'state:<ID> scope', 'state:')
    }
  }

  visit(root, [])
  const replacements: Replacement[] = candidates
    .filter((candidate) => candidate.replacement !== undefined)
    .map((candidate) => ({ start: candidate.start, end: candidate.end, text: candidate.replacement! }))
  const result = applyReplacements(text, replacements)
  const hits = candidates.map((candidate): ReferenceHit => {
    const lines = lineWithReplacement(
      text,
      candidate.start,
      candidate.end,
      candidate.replacement ?? text.slice(candidate.start, candidate.end),
    )
    return {
      path,
      line: lineNumber(text, candidate.start),
      before: lines.before,
      after: candidate.status === 'updated' ? lines.after : undefined,
      status: candidate.status,
      keyPath: candidate.keyPath,
      rule: candidate.rule,
      oldId: candidate.oldId,
      newId: candidate.newId,
    }
  })
  return { text: result, hits }
}

interface BuildingsRow {
  line: number
  raw: string
  prefix: string
  stateId: number
  suffix: string
}

function parseBuildingsRow(raw: string, line: number): BuildingsRow | undefined {
  const match = raw.match(/^(\uFEFF?\s*)(\d+)(\s*;.*)$/)
  if (!match) return undefined
  return { line, raw, prefix: match[1], stateId: Number(match[2]), suffix: match[3] }
}

function issue(row: BuildingsRow, expectedStateId?: number): BuildingsLineIssue {
  return { line: row.line, text: row.raw.trim(), stateId: row.stateId, expectedStateId }
}

export function rewriteBuildingsFile(
  text: string,
  idMap: Map<number, number>,
  validBeforeStateIds = new Set<number>(),
  validAfterStateIds = new Set<number>(),
  selectedStateIds = new Set<number>(),
): { text: string; hits: ReferenceHit[]; audit: BuildingsAudit } {
  const unparsedLines: BuildingsLineIssue[] = []
  const invalidBeforeStateLines: BuildingsLineIssue[] = []
  const invalidAfterStateLines: BuildingsLineIssue[] = []
  const mismatchedLines: BuildingsLineIssue[] = []
  const suffixMismatchLines: BuildingsLineIssue[] = []
  const hits: ReferenceHit[] = []
  const mappingCounts = new Map<string, BuildingsMappingAudit>()
  let totalRows = 0
  let parsedRows = 0
  let changedRows = 0
  let selectedRows = 0
  let physicalLine = 1

  const rewritten = text.split(/(\r\n|\n|\r)/).map((part) => {
    if (/^(?:\r\n|\n|\r)$/.test(part)) {
      physicalLine += 1
      return part
    }
    const trimmed = part.trim()
    if (!trimmed || trimmed.startsWith('#')) return part
    totalRows += 1
    const beforeRow = parseBuildingsRow(part, physicalLine)
    if (!beforeRow) {
      unparsedLines.push({ line: physicalLine, text: trimmed })
      return part
    }
    parsedRows += 1
    if (selectedStateIds.has(beforeRow.stateId)) selectedRows += 1
    if (validBeforeStateIds.size > 0 && !validBeforeStateIds.has(beforeRow.stateId)) {
      invalidBeforeStateLines.push(issue(beforeRow))
    }

    const expectedStateId = idMap.get(beforeRow.stateId) ?? beforeRow.stateId
    const afterRaw = expectedStateId === beforeRow.stateId
      ? part
      : `${beforeRow.prefix}${expectedStateId}${beforeRow.suffix}`
    const afterRow = parseBuildingsRow(afterRaw, physicalLine)
    if (!afterRow || afterRow.stateId !== expectedStateId) {
      mismatchedLines.push(issue(beforeRow, expectedStateId))
    }
    if (!afterRow || afterRow.suffix !== beforeRow.suffix) {
      suffixMismatchLines.push(issue(beforeRow, expectedStateId))
    }
    if (validAfterStateIds.size > 0 && !validAfterStateIds.has(expectedStateId)) {
      invalidAfterStateLines.push(issue(beforeRow, expectedStateId))
    }
    if (expectedStateId !== beforeRow.stateId) {
      changedRows += 1
      const mappingKey = `${beforeRow.stateId}:${expectedStateId}`
      const mapping = mappingCounts.get(mappingKey) ?? {
        before: beforeRow.stateId, after: expectedStateId, rows: 0,
      }
      mapping.rows += 1
      mappingCounts.set(mappingKey, mapping)
      hits.push({
        path: 'map/buildings.txt',
        line: physicalLine,
        before: beforeRow.raw.trim(),
        after: afterRaw.trim(),
        status: 'updated',
        keyPath: 'map/buildings.txt > 第 1 列 State ID',
        rule: '建筑与港口定位器 State ID',
        oldId: beforeRow.stateId,
        newId: expectedStateId,
      })
    }
    return afterRaw
  }).join('')

  return {
    text: rewritten,
    hits,
    audit: {
      present: true,
      totalRows,
      parsedRows,
      changedRows,
      selectedRows,
      unparsedLines,
      invalidBeforeStateLines,
      invalidAfterStateLines,
      mismatchedLines,
      suffixMismatchLines,
      mappings: [...mappingCounts.values()],
    },
  }
}

export function remapBuildingsFile(text: string, idMap: Map<number, number>): string {
  return rewriteBuildingsFile(text, idMap).text
}
