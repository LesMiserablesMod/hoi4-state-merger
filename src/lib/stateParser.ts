import type { PdxAssignment, PdxBlock, SourceFile, StateRecord } from '../types'
import { assignments, atomValue, blockAtoms, blockValue, parsePdx } from './pdx'

const DATE_KEY = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/
const ALLOWED_HISTORY_KEYS = new Set([
  'owner', 'controller', 'add_core_of', 'remove_core_of', 'add_claim_by', 'remove_claim_by',
  'add_claim_of', 'remove_claim_of', 'buildings', 'victory_points', 'set_demilitarized_zone',
  'set_state_category', 'set_state_name',
])

function numericAssignments(block?: PdxBlock): Record<string, number> {
  const result: Record<string, number> = {}
  if (!block) return result
  for (const item of assignments(block)) {
    if (item.value.kind !== 'atom') continue
    const number = Number(item.value.value)
    if (Number.isFinite(number)) result[item.key] = (result[item.key] ?? 0) + number
  }
  return result
}

function parseVictoryPoints(history?: PdxBlock): Record<number, number> {
  const result: Record<number, number> = {}
  if (!history) return result
  for (const item of assignments(history, 'victory_points')) {
    if (item.value.kind !== 'block') continue
    const atoms = blockAtoms(item.value)
    for (let index = 0; index + 1 < atoms.length; index += 2) {
      const province = Number(atoms[index])
      const value = Number(atoms[index + 1])
      if (Number.isInteger(province) && Number.isFinite(value)) result[province] = value
    }
  }
  return result
}

function parseBuildings(source: string, history?: PdxBlock): {
  stateBuildings: Record<string, number>
  provinceBuildingBlocks: Record<number, string>
} {
  const stateBuildings: Record<string, number> = {}
  const provinceBuildingBlocks: Record<number, string> = {}
  if (!history) return { stateBuildings, provinceBuildingBlocks }
  for (const item of assignments(history, 'buildings')) {
    if (item.value.kind !== 'block') continue
    for (const building of assignments(item.value)) {
      if (building.value.kind === 'atom') {
        const value = Number(building.value.value)
        if (Number.isFinite(value)) stateBuildings[building.key] = (stateBuildings[building.key] ?? 0) + value
      } else if (/^\d+$/.test(building.key)) {
        provinceBuildingBlocks[Number(building.key)] = source.slice(building.start, building.end)
      }
    }
  }
  return { stateBuildings, provinceBuildingBlocks }
}

function historyTags(history: PdxBlock | undefined, keys: string[]): string[] {
  if (!history) return []
  const values: string[] = []
  for (const key of keys) {
    for (const item of assignments(history, key)) {
      if (item.value.kind === 'atom') values.push(item.value.value)
    }
  }
  return [...new Set(values)].toSorted()
}

function parseStateAssignment(file: SourceFile, stateAssignment: PdxAssignment): StateRecord | undefined {
  if (stateAssignment.value.kind !== 'block') return undefined
  const stateBlock = stateAssignment.value
  const id = Number(atomValue(stateBlock, 'id'))
  if (!Number.isInteger(id)) return undefined
  const history = blockValue(stateBlock, 'history')
  const provinces = blockAtoms(blockValue(stateBlock, 'provinces')).map(Number).filter(Number.isInteger)
  const historyItems = history ? assignments(history) : []
  const unknownHistoryKeys = historyItems
    .filter((item) => !ALLOWED_HISTORY_KEYS.has(item.key) && !DATE_KEY.test(item.key))
    .map((item) => item.key)
  for (const date of historyItems.filter((item) => DATE_KEY.test(item.key) && item.value.kind === 'block')) {
    const dateBlock = date.value as PdxBlock
    unknownHistoryKeys.push(...assignments(dateBlock)
      .filter((item) => !ALLOWED_HISTORY_KEYS.has(item.key))
      .map((item) => `${date.key}:${item.key}`))
  }
  const buildings = parseBuildings(file.text, history)
  return {
    id,
    name: atomValue(stateBlock, 'name') ?? `STATE_${id}`,
    file,
    stateAssignment,
    stateBlock,
    provinceIds: provinces,
    manpower: Number(atomValue(stateBlock, 'manpower') ?? 0),
    resources: numericAssignments(blockValue(stateBlock, 'resources')),
    localSupplies: Number(atomValue(stateBlock, 'local_supplies') ?? 0),
    category: atomValue(stateBlock, 'state_category') ?? 'unknown',
    owner: history ? atomValue(history, 'owner') : undefined,
    controller: history ? atomValue(history, 'controller') : undefined,
    cores: historyTags(history, ['add_core_of']),
    claims: historyTags(history, ['add_claim_by', 'add_claim_of']),
    victoryPoints: parseVictoryPoints(history),
    stateBuildings: buildings.stateBuildings,
    provinceBuildingBlocks: buildings.provinceBuildingBlocks,
    strategicRegionIds: [],
    historyHasDates: historyItems.some((item) => DATE_KEY.test(item.key)),
    unknownHistoryKeys: [...new Set(unknownHistoryKeys)],
  }
}

export function parseStateFile(file: SourceFile): StateRecord[] {
  const root = parsePdx(file.text)
  return assignments(root, 'state')
    .map((assignment) => parseStateAssignment(file, assignment))
    .filter((state): state is StateRecord => Boolean(state))
}

export function politicalSignature(state: StateRecord): string {
  return JSON.stringify({
    owner: state.owner ?? null,
    controller: state.controller ?? null,
    cores: state.cores,
    claims: state.claims,
  })
}
