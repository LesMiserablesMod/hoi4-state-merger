import type { ModWorkspace, PdxAssignment, PdxBlock, SourceFile, StateRecord } from '../types'
import { assignments, blockAtoms, blockValue, parsePdx } from './pdx'
import { readBinaryFile, readTextFile, scanTextFiles } from './fileSystem'
import { parseStateFile } from './stateParser'

function stateFiles(files: Map<string, SourceFile>): SourceFile[] {
  return [...files.values()].filter((file) => /^history\/states\/.*\.txt$/i.test(file.path))
}

function parseStrategicRegions(files: Map<string, SourceFile>): Map<number, number> {
  const result = new Map<number, number>()
  const regionFiles = [...files.values()].filter((file) => /^map\/strategicregions\/.*\.txt$/i.test(file.path))
  for (const file of regionFiles) {
    const root = parsePdx(file.text)
    const regions: PdxAssignment[] = []
    const collect = (block: PdxBlock) => {
      for (const item of assignments(block)) {
        if (item.key === 'strategic_region' && item.value.kind === 'block') regions.push(item)
      }
    }
    collect(root)
    for (const region of regions) {
      if (region.value.kind !== 'block') continue
      const idAssignment = assignments(region.value, 'id')[0]
      const id = Number(idAssignment?.value.kind === 'atom' ? idAssignment.value.value : NaN)
      if (!Number.isInteger(id)) continue
      for (const province of blockAtoms(blockValue(region.value, 'provinces')).map(Number)) {
        if (Number.isInteger(province)) result.set(province, id)
      }
    }
  }
  return result
}

function attachRegions(states: StateRecord[], provinceToRegion: Map<number, number>): void {
  for (const state of states) {
    state.strategicRegionIds = [...new Set(state.provinceIds
      .map((province) => provinceToRegion.get(province))
      .filter((id): id is number => id !== undefined))].toSorted((a, b) => a - b)
  }
}

export async function loadWorkspace(root: FileSystemDirectoryHandle): Promise<ModWorkspace> {
  const files = await scanTextFiles(root)
  const states = stateFiles(files).flatMap(parseStateFile).toSorted((a, b) => a.id - b.id)
  const provinceToState = new Map<number, number>()
  for (const state of states) {
    for (const province of state.provinceIds) provinceToState.set(province, state.id)
  }
  const provinceToRegion = parseStrategicRegions(files)
  attachRegions(states, provinceToRegion)
  const definitionFile = files.get('map/definition.csv') ?? await readTextFile(root, 'map/definition.csv')
  return {
    root,
    name: root.name,
    states,
    files,
    provinceToState,
    provinceToRegion,
    definitionText: definitionFile?.text,
    provincesBmp: await readBinaryFile(root, 'map/provinces.bmp'),
  }
}
