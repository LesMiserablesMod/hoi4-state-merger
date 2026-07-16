export type Severity = 'block' | 'warning' | 'info'

export interface SourceFile {
  path: string
  text: string
  handle: FileSystemFileHandle
}

export interface PdxAtom {
  kind: 'atom'
  value: string
  start: number
  end: number
}

export interface PdxBlock {
  kind: 'block'
  start: number
  end: number
  openStart: number
  closeStart: number
  items: Array<PdxAssignment | PdxAtom>
}

export interface PdxAssignment {
  kind: 'assignment'
  key: string
  start: number
  end: number
  keyStart: number
  value: PdxAtom | PdxBlock
}

export interface StateRecord {
  id: number
  name: string
  file: SourceFile
  stateAssignment: PdxAssignment
  stateBlock: PdxBlock
  provinceIds: number[]
  manpower: number
  resources: Record<string, number>
  localSupplies: number
  category: string
  owner?: string
  controller?: string
  cores: string[]
  claims: string[]
  victoryPoints: Record<number, number>
  stateBuildings: Record<string, number>
  provinceBuildingBlocks: Record<number, string>
  strategicRegionIds: number[]
  historyHasDates: boolean
  unknownHistoryKeys: string[]
}

export interface ModWorkspace {
  root: FileSystemDirectoryHandle
  name: string
  states: StateRecord[]
  files: Map<string, SourceFile>
  provinceToState: Map<number, number>
  provinceToRegion: Map<number, number>
  definitionText?: string
  provincesBmp?: ArrayBuffer
}

export interface MergePolicies {
  category: 'strict' | 'keeper'
  infrastructure: 'max' | 'sum'
  otherStateBuildings: 'sum' | 'max'
}

export interface MergeConflict {
  id: string
  severity: Severity
  title: string
  detail: string
  stateIds?: number[]
}

export interface FilePatch {
  path: string
  action: 'modify' | 'delete'
  before: string
  after?: string
  summary: string
}

export interface ReferenceHit {
  path: string
  line: number
  before: string
  after?: string
  status: 'updated' | 'review'
  keyPath?: string
  rule?: string
  oldId?: number
  newId?: number
}

export interface BuildingsLineIssue {
  line: number
  text: string
  stateId?: number
  expectedStateId?: number
}

export interface BuildingsMappingAudit {
  before: number
  after: number
  rows: number
}

export interface BuildingsAudit {
  present: boolean
  totalRows: number
  parsedRows: number
  changedRows: number
  selectedRows: number
  selectedAirBaseLocatorRows: number
  finalKeeperAirBaseLocatorRows: number
  removedAirBaseLocatorLines: BuildingsLineIssue[]
  preexistingDuplicateAirBaseLocatorLines: BuildingsLineIssue[]
  duplicateAirBaseLocatorLines: BuildingsLineIssue[]
  unparsedLines: BuildingsLineIssue[]
  invalidBeforeStateLines: BuildingsLineIssue[]
  invalidAfterStateLines: BuildingsLineIssue[]
  mismatchedLines: BuildingsLineIssue[]
  suffixMismatchLines: BuildingsLineIssue[]
  mappings: BuildingsMappingAudit[]
}

export interface MergePlan {
  keeperId: number
  keeperFinalId: number
  sourceIds: number[]
  idMap: Map<number, number>
  conflicts: MergeConflict[]
  patches: FilePatch[]
  references: ReferenceHit[]
  buildingsAudit: BuildingsAudit
  totalProvinces: number
  resultManpower: number
  resultResources: Record<string, number>
  resultBuildings: Record<string, number>
  requestedAirBaseLevel: number
  airBaseLevelCap: number
  airBaseLevelCapSource: string
}
