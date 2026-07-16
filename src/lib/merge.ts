import type {
  BuildingsAudit, BuildingsLineIssue, FilePatch, MergeConflict, MergePlan, MergePolicies, ModWorkspace, PdxAssignment,
  PdxBlock, ReferenceHit, StateRecord,
} from '../types'
import {
  applyReplacements, assignments, atomValue, blockAtoms, blockValue, firstAssignment, parsePdx, renderNumericBlock,
  replaceAssignmentValue, type Replacement,
} from './pdx'
import {
  findAirBaseLocatorLines, findDuplicateAirBaseLocatorLines, rewriteBuildingsFile, rewriteStateReferences,
} from './references'

const DEFAULT_AIR_BASE_LEVEL_CAP = 10

function addConflict(
  conflicts: MergeConflict[], severity: MergeConflict['severity'], id: string,
  title: string, detail: string, stateIds?: number[],
): void {
  conflicts.push({ id, severity, title, detail, stateIds })
}

export function buildStateIdMap(states: StateRecord[], sourceIds: number[], keeperId: number): {
  map: Map<number, number>
  finalKeeperId: number
  holes: number[]
} {
  const ids = states.map((state) => state.id).toSorted((a, b) => a - b)
  const maxId = ids.at(-1) ?? 0
  const sourceSet = new Set(sourceIds)
  const newMax = maxId - sourceSet.size
  const survivors = ids.filter((id) => !sourceSet.has(id))
  const survivorSet = new Set(survivors)
  const holes: number[] = []
  for (let id = 1; id <= newMax; id += 1) if (!survivorSet.has(id)) holes.push(id)
  const tails = survivors.filter((id) => id > newMax).toSorted((a, b) => b - a)
  const map = new Map<number, number>()
  holes.forEach((hole, index) => map.set(tails[index], hole))
  const finalKeeperId = map.get(keeperId) ?? keeperId
  for (const source of sourceIds) map.set(source, finalKeeperId)
  return { map, finalKeeperId, holes }
}

function sumRecords(records: Array<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) result[key] = (result[key] ?? 0) + value
  }
  return result
}

function resolveAirBaseLevelCap(workspace: ModWorkspace): {
  level: number
  source: string
  invalidDefinitions: string[]
} {
  const definitionFiles = [...workspace.files.values()]
    .filter((file) => /^common\/buildings\/.*\.txt$/i.test(file.path))
    .toSorted((left, right) => left.path.localeCompare(right.path))
  const parsedFiles = definitionFiles.map((file) => ({ file, root: parsePdx(file.text) }))
  const variables = new Map<string, string>()
  for (const { root } of parsedFiles) {
    const containers = [
      root,
      ...assignments(root, 'buildings')
        .filter((item) => item.value.kind === 'block')
        .map((item) => item.value as PdxBlock),
    ]
    for (const container of containers) {
      for (const variable of assignments(container).filter((item) => item.key.startsWith('@'))) {
        if (variable.value.kind === 'atom') variables.set(variable.key, variable.value.value)
      }
    }
  }
  let candidate: { raw: string; source: string } | undefined
  for (const { file, root } of parsedFiles) {
    const containers = [
      root,
      ...assignments(root, 'buildings')
        .filter((item) => item.value.kind === 'block')
        .map((item) => item.value as PdxBlock),
    ]
    for (const container of containers) {
      for (const definition of assignments(container).filter((item) => item.key.toLowerCase() === 'air_base')) {
        if (definition.value.kind !== 'block') continue
        const levelCap = blockValue(definition.value, 'level_cap')
        const rawStateMax = levelCap ? atomValue(levelCap, 'state_max') : undefined
        if (rawStateMax !== undefined) candidate = { raw: rawStateMax, source: file.path }
      }
    }
  }
  if (candidate) {
    let resolvedRaw = candidate.raw
    const seen = new Set<string>()
    while (resolvedRaw.startsWith('@') && variables.has(resolvedRaw) && !seen.has(resolvedRaw)) {
      seen.add(resolvedRaw)
      resolvedRaw = variables.get(resolvedRaw)!
    }
    const stateMax = Number(resolvedRaw)
    if (Number.isInteger(stateMax) && stateMax > 0) {
      return { level: stateMax, source: candidate.source, invalidDefinitions: [] }
    }
  }
  const fallback = {
    level: DEFAULT_AIR_BASE_LEVEL_CAP,
    source: `HOI4 默认值 ${DEFAULT_AIR_BASE_LEVEL_CAP}（MOD 内未找到可解析的覆盖定义）`,
  }
  return {
    ...fallback,
    invalidDefinitions: candidate ? [`${candidate.source}: state_max = ${candidate.raw}`] : [],
  }
}

function combineBuildings(
  states: StateRecord[],
  policies: MergePolicies,
  airBaseLevelCap: number,
): { buildings: Record<string, number>; requestedAirBaseLevel: number } {
  const keys = new Set(states.flatMap((state) => Object.keys(state.stateBuildings)))
  const result: Record<string, number> = {}
  let requestedAirBaseLevel = 0
  for (const key of keys) {
    const values = states.map((state) => state.stateBuildings[key] ?? 0)
    const policy = key === 'infrastructure' ? policies.infrastructure : policies.otherStateBuildings
    const combined = policy === 'max' ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0)
    if (key === 'air_base') {
      requestedAirBaseLevel = combined
      result[key] = Math.min(combined, airBaseLevelCap)
    } else {
      result[key] = combined
    }
  }
  return { buildings: result, requestedAirBaseLevel }
}

function renderAssignments(values: Record<string, number>, indent: string): string {
  const entries = Object.entries(values).toSorted(([left], [right]) => left.localeCompare(right))
  return `{\n${entries.map(([key, value]) => `${indent}${key} = ${value}`).join('\n')}\n${indent.slice(0, -1)}}`
}

function renderBuildings(
  buildings: Record<string, number>, provinceBlocks: Record<number, string>, indent: string,
): string {
  const stateLines = Object.entries(buildings)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${indent}${key} = ${value}`)
  const provinceLines = Object.entries(provinceBlocks)
    .toSorted(([left], [right]) => Number(left) - Number(right))
    .map(([, block]) => block.split(/\r?\n/).map((line) => `${indent}${line.trimStart()}`).join('\n'))
  return `{\n${[...stateLines, ...provinceLines].join('\n')}\n${indent.slice(0, -1)}}`
}

function renderVictoryPointBlocks(values: Record<number, number>, indent: string): string[] {
  return Object.entries(values)
    .toSorted(([left], [right]) => Number(left) - Number(right))
    .map(([province, value]) => `{\n${indent}\t${province} ${value}\n${indent}}`)
}

function insertBeforeClose(block: PdxBlock, text: string): Replacement {
  return { start: block.closeStart, end: block.closeStart, text: `\n${text}\n` }
}

function replaceOrInsertBlock(
  block: PdxBlock, key: string, renderedValue: string, indent: string,
): Replacement[] {
  const existing = assignments(block, key)
  if (existing.length === 0) return [insertBeforeClose(block, `${indent}${key} = ${renderedValue}`)]
  return [
    { start: existing[0].value.start, end: existing[0].value.end, text: renderedValue },
    ...existing.slice(1).map((item) => ({ start: item.start, end: item.end, text: '' })),
  ]
}

function replaceOrInsertRepeatedBlocks(
  block: PdxBlock, key: string, renderedValues: string[], indent: string,
): Replacement[] {
  const existing = assignments(block, key)
  if (renderedValues.length === 0) {
    return existing.map((item) => ({ start: item.start, end: item.end, text: '' }))
  }
  const rendered = renderedValues
    .map((value, index) => `${index === 0 ? '' : `\n${indent}${key} = `}${value}`)
    .join('')
  if (existing.length === 0) return [insertBeforeClose(block, `${indent}${key} = ${rendered}`)]
  return [
    { start: existing[0].value.start, end: existing[0].value.end, text: rendered },
    ...existing.slice(1).map((item) => ({ start: item.start, end: item.end, text: '' })),
  ]
}

function mergeKeeperText(
  keeper: StateRecord,
  selected: StateRecord[],
  finalKeeperId: number,
  policies: MergePolicies,
  resultResources: Record<string, number>,
  resultBuildings: Record<string, number>,
): string {
  const text = keeper.file.text
  const replacements: Replacement[] = []
  const state = keeper.stateBlock
  const provinces = selected.flatMap((item) => item.provinceIds)
  const idReplacement = replaceAssignmentValue(firstAssignment(state, 'id'), String(finalKeeperId))
  if (idReplacement) replacements.push(idReplacement)
  const manpowerReplacement = replaceAssignmentValue(
    firstAssignment(state, 'manpower'), String(selected.reduce((sum, item) => sum + item.manpower, 0)),
  )
  if (manpowerReplacement) replacements.push(manpowerReplacement)
  const provinceAssignment = firstAssignment(state, 'provinces')
  if (provinceAssignment) replacements.push({
    start: provinceAssignment.value.start,
    end: provinceAssignment.value.end,
    text: renderNumericBlock(provinces, '\t\t'),
  })
  replacements.push(...replaceOrInsertBlock(state, 'resources', renderAssignments(resultResources, '\t\t'), '\t'))
  const localSupplies = selected.reduce((sum, item) => sum + item.localSupplies, 0)
  const localAssignment = firstAssignment(state, 'local_supplies')
  if (localAssignment) {
    replacements.push({ start: localAssignment.value.start, end: localAssignment.value.end, text: String(localSupplies) })
  } else {
    replacements.push(insertBeforeClose(state, `\tlocal_supplies = ${localSupplies}`))
  }
  const history = blockValue(state, 'history')
  if (history) {
    const provinceBlocks: Record<number, string> = {}
    const victoryPoints: Record<number, number> = {}
    for (const item of selected) {
      Object.assign(provinceBlocks, item.provinceBuildingBlocks)
      Object.assign(victoryPoints, item.victoryPoints)
    }
    replacements.push(...replaceOrInsertBlock(
      history, 'buildings', renderBuildings(resultBuildings, provinceBlocks, '\t\t\t'), '\t\t',
    ))
    replacements.push(...replaceOrInsertRepeatedBlocks(
      history, 'victory_points', renderVictoryPointBlocks(victoryPoints, '\t\t'), '\t\t',
    ))
  }
  if (policies.category === 'keeper') {
    const category = firstAssignment(state, 'state_category')
    if (category) replacements.push({ start: category.value.start, end: category.value.end, text: keeper.category })
  }
  return applyReplacements(text, replacements.filter((item): item is Replacement => Boolean(item)))
}

function removeStateBlock(text: string, assignment: PdxAssignment): string {
  let start = assignment.start
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1
  if (start > 0 && text[start - 1] === '\n') start -= 1
  return text.slice(0, start) + text.slice(assignment.end)
}

function renderStateTombstone(sourceId: number, keeperId: number): string {
  return `# State ${sourceId} was merged into State ${keeperId} by HOI4 State Merger.\n`
    + '# Intentionally kept as an empty override so an upstream State file cannot reappear.\n'
}

function validate(
  workspace: ModWorkspace, selected: StateRecord[], keeper: StateRecord,
  policies: MergePolicies,
): MergeConflict[] {
  const conflicts: MergeConflict[] = []
  const statesPerFile = new Map<string, number[]>()
  for (const state of workspace.states) {
    const stateIds = statesPerFile.get(state.file.path) ?? []
    stateIds.push(state.id)
    statesPerFile.set(state.file.path, stateIds)
  }
  const multiStateFiles = [...statesPerFile.entries()].filter(([, stateIds]) => stateIds.length > 1)
  if (multiStateFiles.length) addConflict(
    conflicts, 'block', 'multi-state-files', '一个文件中包含多个 State block',
    `MVP 为避免同文件多次位移导致误写，要求每个 State 独立文件。涉及：${multiStateFiles.slice(0, 6).map(([path, stateIds]) => `${path} (${stateIds.join(', ')})`).join('；')}`,
    multiStateFiles.flatMap(([, stateIds]) => stateIds),
  )
  const ids = workspace.states.map((state) => state.id).toSorted((a, b) => a - b)
  const duplicateIds = ids.filter((id, index) => index > 0 && id === ids[index - 1])
  if (duplicateIds.length > 0) addConflict(
    conflicts, 'block', 'duplicate-state-ids', '存在重复 State ID',
    `重复：${[...new Set(duplicateIds)].slice(0, 20).join(', ')}`,
  )
  const invalidIds = ids.filter((id) => !Number.isInteger(id) || id <= 0)
  if (invalidIds.length > 0) addConflict(
    conflicts, 'block', 'invalid-state-ids', 'State ID 必须是正整数',
    `异常：${invalidIds.slice(0, 20).join(', ')}`,
  )
  const maxId = ids.at(-1) ?? 0
  const missing = Array.from({ length: Math.max(0, maxId) }, (_, index) => index + 1).filter((id) => !ids.includes(id))
  if (missing.length > 0) addConflict(conflicts, 'block', 'state-id-gaps', '现有 State ID 已经不连续', `缺少：${missing.slice(0, 20).join(', ')}`)
  const allProvinces = new Map<number, number[]>()
  for (const state of workspace.states) for (const province of state.provinceIds) {
    const owners = allProvinces.get(province) ?? []
    owners.push(state.id)
    allProvinces.set(province, owners)
  }
  const duplicate = [...allProvinces.entries()].filter(([, owners]) => owners.length > 1)
  if (duplicate.length) addConflict(conflicts, 'block', 'duplicate-provinces', 'Province 同时属于多个 State', `${duplicate.length} 个 Province 归属重复`)

  const sources = selected.filter((state) => state.id !== keeper.id)
  const regions = [...new Set(selected.flatMap((state) => state.strategicRegionIds))]
  if (regions.length !== 1) addConflict(
    conflicts, 'block', 'strategic-region', '所选 State 不在同一 Strategic Region',
    `所选 State 覆盖区域：${regions.join(', ') || '未知'}。当前工具不重写 Strategic Region，不能安全生成跨区域 State。`,
    selected.map((state) => state.id),
  )
  const categories = [...new Set(selected.map((state) => state.category))]
  if (categories.length > 1) addConflict(
    conflicts, policies.category === 'strict' ? 'block' : 'warning', 'category', 'State Category 不一致',
    `${categories.join(' / ')}；${policies.category === 'keeper' ? `将保留 ${keeper.category}` : '请选择显式处理策略'}`,
    selected.map((state) => state.id),
  )
  const dated = sources.filter((state) => state.historyHasDates)
  const unknown = sources.filter((state) => state.unknownHistoryKeys.length)
  const politicalDifferences = sources.filter((state) =>
    state.owner !== keeper.owner
    || state.controller !== keeper.controller
    || state.cores.join('|') !== keeper.cores.join('|')
    || state.claims.join('|') !== keeper.claims.join('|'),
  )
  addConflict(
    conflicts, 'info', 'source-history-discarded', '来源 State history 将被丢弃',
    `State ${sources.map((state) => state.id).join(', ')} 的政治、日期与未知 history 不会拼接；保留 State ${keeper.id} 的 history 作为结果。明确的 Province、人口、资源、建筑与胜利点仍会合并。`
      + `${dated.length ? ` 含日期历史：${dated.map((state) => state.id).join(', ')}。` : ''}`
      + `${unknown.length ? ` 含未知效果：${unknown.map((state) => `${state.id}(${state.unknownHistoryKeys.join('/')})`).join(', ')}。` : ''}`
      + `${politicalDifferences.length ? ` 政治历史不同：${politicalDifferences.map((state) => state.id).join(', ')}。` : ''}`,
    sources.map((state) => state.id),
  )
  for (const state of selected) {
    for (const province of Object.keys(state.victoryPoints).map(Number)) {
      if (!state.provinceIds.includes(province)) addConflict(
        conflicts, 'block', `victory-point-${state.id}-${province}`, '胜利点 Province 归属异常',
        `State ${state.id} 的胜利点引用 Province ${province}，但该 Province 不属于它。`, [state.id],
      )
    }
    for (const province of Object.keys(state.provinceBuildingBlocks).map(Number)) {
      if (!state.provinceIds.includes(province)) addConflict(
        conflicts, 'block', `building-${state.id}-${province}`, '省级建筑归属异常',
        `State ${state.id} 的建筑引用 Province ${province}，但该 Province 不属于它。`, [state.id],
      )
    }
  }
  const descriptor = [...workspace.files.values()].find((file) => /(^|\/)descriptor\.mod$/i.test(file.path) || file.path.endsWith('.mod'))
  if (!descriptor?.text.includes('replace_path = "history/states"')) addConflict(
    conflicts, 'warning', 'partial-overlay', '未确认 history/states 完整覆盖',
    '若这是局部覆盖 MOD，删除文件可能让上游同名 State 重新生效。应用前请确认这是完整地图 MOD。',
  )
  return conflicts
}

function validateIdMapping(
  workspace: ModWorkspace,
  sourceIds: number[],
  idMap: Map<number, number>,
  finalKeeperId: number,
  conflicts: MergeConflict[],
): void {
  const originalIds = new Set(workspace.states.map((state) => state.id))
  const invalidKeys = [...idMap.keys()].filter((id) => !originalIds.has(id))
  if (invalidKeys.length > 0) addConflict(
    conflicts, 'block', 'id-map-unknown-source', 'State ID 映射包含未知来源',
    `未知：${invalidKeys.join(', ')}`,
  )
  const wrongSources = sourceIds.filter((id) => idMap.get(id) !== finalKeeperId)
  if (wrongSources.length > 0) addConflict(
    conflicts, 'block', 'id-map-source-target', '来源 State 未直接映射到最终保留 State',
    `异常：${wrongSources.join(', ')}；最终保留 State 为 ${finalKeeperId}`,
  )
  const sourceSet = new Set(sourceIds)
  const finalIds = workspace.states
    .filter((state) => !sourceSet.has(state.id))
    .map((state) => idMap.get(state.id) ?? state.id)
    .toSorted((left, right) => left - right)
  const expected = Array.from({ length: workspace.states.length - sourceSet.size }, (_, index) => index + 1)
  if (new Set(finalIds).size !== finalIds.length || finalIds.join(',') !== expected.join(',')) addConflict(
    conflicts, 'block', 'id-map-final-set', '最终 State ID 不能形成连续唯一集合',
    `预期 1..${expected.length}，计算结果前 30 项：${finalIds.slice(0, 30).join(', ')}`,
  )
}

function upsertPatch(patches: Map<string, FilePatch>, patch: FilePatch): void {
  const existing = patches.get(patch.path)
  if (!existing) patches.set(patch.path, patch)
  else patches.set(patch.path, { ...patch, before: existing.before })
}

function emptyBuildingsAudit(): BuildingsAudit {
  return {
    present: false,
    totalRows: 0,
    parsedRows: 0,
    changedRows: 0,
    selectedRows: 0,
    selectedAirBaseLocatorRows: 0,
    finalKeeperAirBaseLocatorRows: 0,
    removedAirBaseLocatorLines: [],
    preexistingDuplicateAirBaseLocatorLines: [],
    duplicateAirBaseLocatorLines: [],
    unparsedLines: [],
    invalidBeforeStateLines: [],
    invalidAfterStateLines: [],
    mismatchedLines: [],
    suffixMismatchLines: [],
    mappings: [],
  }
}

function issueSummary(issues: BuildingsLineIssue[]): string {
  return issues.slice(0, 8).map((item) => {
    const mapping = item.expectedStateId === undefined ? '' : `→${item.expectedStateId}`
    const state = item.stateId === undefined ? '' : ` State ${item.stateId}${mapping}`
    return `L${item.line}${state}`
  }).join('、')
}

function addBuildingsAuditConflicts(conflicts: MergeConflict[], audit: BuildingsAudit): void {
  const checks: Array<{
    id: string
    title: string
    detail: string
    issues: BuildingsLineIssue[]
  }> = [
    {
      id: 'map-buildings-duplicate-air-base',
      title: '同一 State 仍有多个 air_base 地图定位器',
      detail: '空军基地是 State 级单定位设施；合并结果中每个 State 最多只能保留一条定位记录。',
      issues: audit.duplicateAirBaseLocatorLines,
    },
    {
      id: 'map-buildings-unparsed',
      title: 'map/buildings.txt 含无法解析的记录',
      detail: '非空、非注释行必须以 StateID; 开头，否则无法保证建筑与港口定位器完整迁移。',
      issues: audit.unparsedLines,
    },
    {
      id: 'map-buildings-invalid-before-state',
      title: 'map/buildings.txt 原始 State ID 不存在',
      detail: '这些定位器在合并前已不属于任何已载入 State。',
      issues: audit.invalidBeforeStateLines,
    },
    {
      id: 'map-buildings-invalid-after-state',
      title: 'map/buildings.txt 结果 State ID 不存在',
      detail: '这些定位器应用映射后仍不会属于任何最终 State。',
      issues: audit.invalidAfterStateLines,
    },
    {
      id: 'map-buildings-remap-mismatch',
      title: 'map/buildings.txt State ID 迁移不完整',
      detail: '逐行结果与一次性 State ID 映射不一致。',
      issues: audit.mismatchedLines,
    },
    {
      id: 'map-buildings-suffix-changed',
      title: 'map/buildings.txt 非 State 字段发生变化',
      detail: '建筑类型、坐标、旋转或相邻海区字段不应被 State 合并修改。',
      issues: audit.suffixMismatchLines,
    },
  ]
  for (const check of checks) {
    if (check.issues.length === 0) continue
    addConflict(
      conflicts,
      'block',
      check.id,
      check.title,
      `${check.detail} 共 ${check.issues.length} 行：${issueSummary(check.issues)}`,
    )
  }
  if (audit.preexistingDuplicateAirBaseLocatorLines.length > 0) addConflict(
    conflicts,
    'warning',
    'map-buildings-preexisting-duplicate-air-base',
    '输入中已有重复 air_base 地图定位器',
    `检测到 ${audit.preexistingDuplicateAirBaseLocatorLines.length} 条位于重复组中的记录；属于本次合并组的重复会自动折叠，其他重复会继续作为阻断项列出：${issueSummary(audit.preexistingDuplicateAirBaseLocatorLines)}`,
  )
  if (audit.removedAirBaseLocatorLines.length > 0) addConflict(
    conflicts,
    'info',
    'map-buildings-air-base-deduplicated',
    '已折叠空军基地地图定位器',
    `同一最终 State 只保留一个 air_base 定位器，优先保留目标 State 原坐标；已移除 ${audit.removedAirBaseLocatorLines.length} 条：${issueSummary(audit.removedAirBaseLocatorLines)}`,
  )
  if (audit.selectedAirBaseLocatorRows === 0) addConflict(
    conflicts,
    'block',
    'map-buildings-selected-air-base-missing',
    '所选 State 缺少 air_base 地图定位器',
    '目标和来源 State 都没有可保留的 air_base 坐标，工具无法安全生成机场地图位置。请先修复 map/buildings.txt。',
  )
  if (audit.selectedAirBaseLocatorRows > 0 && audit.finalKeeperAirBaseLocatorRows !== 1) addConflict(
    conflicts,
    'block',
    'map-buildings-final-air-base-count',
    '最终 State 的 air_base 地图定位器数量不为 1',
    `预期 1 条，实际 ${audit.finalKeeperAirBaseLocatorRows} 条。`,
  )
}

export function createMergePlan(
  workspace: ModWorkspace,
  keeperId: number,
  sourceIds: number[],
  policies: MergePolicies,
): MergePlan {
  const byId = new Map(workspace.states.map((state) => [state.id, state]))
  const keeper = byId.get(keeperId)
  if (!keeper) throw new Error('Keeper State 不存在')
  if (sourceIds.includes(keeperId)) throw new Error('保留 State 不能同时作为来源 State')
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('来源 State ID 不能重复')
  const missingSources = sourceIds.filter((id) => !byId.has(id))
  if (missingSources.length > 0) throw new Error(`来源 State 不存在：${missingSources.join(', ')}`)
  const sources = sourceIds.map((id) => byId.get(id)!)
  const selected = [keeper, ...sources]
  const { map: idMap, finalKeeperId } = buildStateIdMap(workspace.states, sourceIds, keeperId)
  const conflicts = validate(workspace, selected, keeper, policies)
  validateIdMapping(workspace, sourceIds, idMap, finalKeeperId, conflicts)
  const resultResources = sumRecords(selected.map((state) => state.resources))
  const airBaseLevelCap = resolveAirBaseLevelCap(workspace)
  if (airBaseLevelCap.invalidDefinitions.length > 0) addConflict(
    conflicts,
    'warning',
    'air-base-level-cap-invalid',
    '无法解析 MOD 的空军基地等级上限',
    `未能解析 air_base state_max，将使用默认上限 ${DEFAULT_AIR_BASE_LEVEL_CAP}：${airBaseLevelCap.invalidDefinitions.slice(0, 8).join('；')}`,
  )
  const invalidAirBaseStates = selected.filter((state) => {
    const level = state.stateBuildings.air_base
    return level !== undefined && (!Number.isInteger(level) || level < 0)
  })
  if (invalidAirBaseStates.length > 0) addConflict(
    conflicts,
    'block',
    'air-base-level-invalid',
    '所选 State 的空军基地等级不是非负整数',
    `异常：${invalidAirBaseStates.map((state) => `State ${state.id} = ${state.stateBuildings.air_base}`).join('；')}`,
    invalidAirBaseStates.map((state) => state.id),
  )
  const combinedBuildings = combineBuildings(selected, policies, airBaseLevelCap.level)
  const resultBuildings = combinedBuildings.buildings
  if (combinedBuildings.requestedAirBaseLevel > airBaseLevelCap.level) addConflict(
    conflicts,
    'warning',
    'air-base-level-capped',
    '空军基地等级已按上限截断',
    `合并策略计算出 air_base = ${combinedBuildings.requestedAirBaseLevel}，结果写为 ${airBaseLevelCap.level}；上限来源：${airBaseLevelCap.source}。`,
    selected.map((state) => state.id),
  )
  const resultManpower = selected.reduce((sum, state) => sum + state.manpower, 0)
  const patchMap = new Map<string, FilePatch>()
  const referenceHits: ReferenceHit[] = []
  let buildingsAudit = emptyBuildingsAudit()
  const sourceSet = new Set(sourceIds)
  const validBeforeStateIds = new Set(workspace.states.map((state) => state.id))
  const validAfterStateIds = new Set(workspace.states
    .filter((state) => !sourceSet.has(state.id))
    .map((state) => idMap.get(state.id) ?? state.id))

  const keeperAfter = mergeKeeperText(keeper, selected, finalKeeperId, policies, resultResources, resultBuildings)
  upsertPatch(patchMap, {
    path: keeper.file.path,
    action: 'modify',
    before: keeper.file.text,
    after: keeperAfter,
    summary: `${keeperId} → ${finalKeeperId}；并入 ${sourceIds.join(', ')}`,
  })

  for (const source of sources) {
    const existing = patchMap.get(source.file.path)
    const before = existing?.before ?? source.file.text
    const current = existing?.after ?? source.file.text
    const after = removeStateBlock(current, source.stateAssignment).trim()
    upsertPatch(patchMap, after ? {
      path: source.file.path, action: 'modify', before, after: `${after}\n`, summary: `移除 State ${source.id} block`,
    } : {
      path: source.file.path,
      action: 'modify',
      before,
      after: renderStateTombstone(source.id, finalKeeperId),
      summary: `清空已并入的 State ${source.id}，保留覆盖占位以阻止上游文件回现`,
    })
  }

  for (const state of workspace.states) {
    if (sourceIds.includes(state.id) || state.id === keeperId) continue
    const newId = idMap.get(state.id)
    if (newId === undefined) continue
    const idAssignment = firstAssignment(state.stateBlock, 'id')
    if (!idAssignment) continue
    const after = applyReplacements(state.file.text, [{
      start: idAssignment.value.start, end: idAssignment.value.end, text: String(newId),
    }])
    upsertPatch(patchMap, {
      path: state.file.path, action: 'modify', before: state.file.text, after,
      summary: `尾部填洞：State ${state.id} → ${newId}`,
    })
  }

  const buildings = workspace.files.get('map/buildings.txt')
  if (!buildings) {
    addConflict(
      conflicts,
      'block',
      'map-buildings-missing',
      '缺少 map/buildings.txt',
      '无法同步迁移建筑、港口、补给中心和特殊设施的地图定位器，因此禁止应用合并。',
    )
  } else {
    const rewritten = rewriteBuildingsFile(
      buildings.text,
      idMap,
      validBeforeStateIds,
      validAfterStateIds,
      new Set(selected.map((state) => state.id)),
      keeperId,
    )
    buildingsAudit = rewritten.audit
    referenceHits.push(...rewritten.hits)
    addBuildingsAuditConflicts(conflicts, buildingsAudit)
    if (rewritten.text !== buildings.text) upsertPatch(patchMap, {
      path: buildings.path, action: 'modify', before: buildings.text, after: rewritten.text,
      summary: `按第 1 列旧 State ID 单次迁移定位器，并折叠 ${buildingsAudit.removedAirBaseLocatorLines.length} 个重复 air_base 定位器；其他字段保持不变`,
    })
    if (
      buildingsAudit.unparsedLines.length === 0
      && buildingsAudit.invalidBeforeStateLines.length === 0
      && buildingsAudit.invalidAfterStateLines.length === 0
      && buildingsAudit.mismatchedLines.length === 0
      && buildingsAudit.suffixMismatchLines.length === 0
      && buildingsAudit.duplicateAirBaseLocatorLines.length === 0
      && buildingsAudit.selectedAirBaseLocatorRows > 0
      && buildingsAudit.finalKeeperAirBaseLocatorRows === 1
    ) addConflict(
      conflicts,
      'info',
      'map-buildings-verified',
      'map/buildings.txt 逐行迁移通过',
      `已解析 ${buildingsAudit.parsedRows}/${buildingsAudit.totalRows} 条定位器，变更 ${buildingsAudit.changedRows} 条、折叠 air_base ${buildingsAudit.removedAirBaseLocatorLines.length} 条；其中所选 State 关联 ${buildingsAudit.selectedRows} 条。`,
    )
  }

  for (const file of workspace.files.values()) {
    if (
      patchMap.get(file.path)?.action === 'delete'
      || file.path === 'map/buildings.txt'
    ) continue
    const existing = patchMap.get(file.path)
    const base = existing?.after ?? file.text
    const rewritten = rewriteStateReferences(file.path, base, idMap)
    referenceHits.push(...rewritten.hits)
    if (rewritten.text !== base) upsertPatch(patchMap, {
      path: file.path,
      action: 'modify',
      before: existing?.before ?? file.text,
      after: rewritten.text,
      summary: existing ? `${existing.summary}；迁移 State 引用` : '迁移已识别的 State 引用',
    })
  }
  return {
    keeperId,
    keeperFinalId: finalKeeperId,
    sourceIds,
    idMap,
    conflicts,
    patches: [...patchMap.values()].filter((patch) => patch.action === 'delete' || patch.after !== patch.before),
    references: referenceHits,
    buildingsAudit,
    totalProvinces: selected.reduce((sum, state) => sum + state.provinceIds.length, 0),
    resultManpower,
    resultResources,
    resultBuildings,
    requestedAirBaseLevel: combinedBuildings.requestedAirBaseLevel,
    airBaseLevelCap: airBaseLevelCap.level,
    airBaseLevelCapSource: airBaseLevelCap.source,
  }
}

export function verifyAppliedMerge(
  before: ModWorkspace,
  after: ModWorkspace,
  plan: MergePlan,
): string[] {
  const failures: string[] = []
  const sourceSet = new Set(plan.sourceIds)
  const expectedStateIds = before.states
    .filter((state) => !sourceSet.has(state.id))
    .map((state) => plan.idMap.get(state.id) ?? state.id)
    .toSorted((left, right) => left - right)
  const actualStateIds = after.states.map((state) => state.id).toSorted((left, right) => left - right)
  if (new Set(actualStateIds).size !== actualStateIds.length) failures.push('写入后存在重复 State ID')
  if (expectedStateIds.join(',') !== actualStateIds.join(',')) {
    failures.push(`最终 State ID 集不一致：预期 ${expectedStateIds.length} 个，实际 ${actualStateIds.length} 个`)
  }

  const provinceFailures: string[] = []
  for (const [province, oldState] of before.provinceToState) {
    const expectedState = plan.idMap.get(oldState) ?? oldState
    const actualState = after.provinceToState.get(province)
    if (actualState !== expectedState) provinceFailures.push(`${province}:${actualState ?? '缺失'}≠${expectedState}`)
  }
  for (const province of after.provinceToState.keys()) {
    if (!before.provinceToState.has(province)) provinceFailures.push(`${province}:意外新增`)
  }
  if (provinceFailures.length > 0) {
    failures.push(`Province 最终归属不一致（${provinceFailures.length}）：${provinceFailures.slice(0, 8).join('、')}`)
  }

  const expectedVictoryPoints: Record<number, number> = {}
  const selectedIds = new Set([plan.keeperId, ...plan.sourceIds])
  for (const state of before.states) {
    if (selectedIds.has(state.id)) Object.assign(expectedVictoryPoints, state.victoryPoints)
  }
  const finalKeeper = after.states.find((state) => state.id === plan.keeperFinalId)
  if (!finalKeeper) {
    failures.push(`最终保留 State ${plan.keeperFinalId} 不存在，无法校验胜利点`)
  } else {
    const expectedEntries = Object.entries(expectedVictoryPoints)
      .toSorted(([left], [right]) => Number(left) - Number(right))
    const actualEntries = Object.entries(finalKeeper.victoryPoints)
      .toSorted(([left], [right]) => Number(left) - Number(right))
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      failures.push(`Victory Point 结果不一致：预期 ${expectedEntries.length} 个，实际 ${actualEntries.length} 个`)
    }
    const history = blockValue(finalKeeper.stateBlock, 'history')
    const victoryPointAssignments = history ? assignments(history, 'victory_points') : []
    const malformed = victoryPointAssignments.filter((item) =>
      item.value.kind !== 'block' || blockAtoms(item.value).length !== 2,
    )
    if (victoryPointAssignments.length !== expectedEntries.length || malformed.length > 0) {
      failures.push(
        `Victory Point 块格式错误：应为 ${expectedEntries.length} 个独立二元块，实际 ${victoryPointAssignments.length} 个，异常 ${malformed.length} 个`,
      )
    }
    const expectedAirBaseLevel = plan.resultBuildings.air_base ?? 0
    const actualAirBaseLevel = finalKeeper.stateBuildings.air_base ?? 0
    if (actualAirBaseLevel !== expectedAirBaseLevel) {
      failures.push(`空军基地等级不一致：预期 ${expectedAirBaseLevel}，实际 ${actualAirBaseLevel}`)
    }
    if (!Number.isInteger(actualAirBaseLevel) || actualAirBaseLevel < 0) {
      failures.push(`空军基地等级 ${actualAirBaseLevel} 不是非负整数`)
    }
    if (actualAirBaseLevel > plan.airBaseLevelCap) {
      failures.push(`空军基地等级 ${actualAirBaseLevel} 超过上限 ${plan.airBaseLevelCap}`)
    }
  }

  const buildingsAfter = after.files.get('map/buildings.txt')
  if (!buildingsAfter) {
    failures.push('写入后缺少 map/buildings.txt，无法校验空军基地定位器')
  } else {
    const duplicateAirBaseLocators = findDuplicateAirBaseLocatorLines(buildingsAfter.text)
    if (duplicateAirBaseLocators.length > 0) {
      failures.push(
        `写入后同一 State 仍有重复 air_base 定位器（${duplicateAirBaseLocators.length} 条）：${issueSummary(duplicateAirBaseLocators)}`,
      )
    }
    const finalKeeperAirBaseLocators = findAirBaseLocatorLines(buildingsAfter.text, plan.keeperFinalId)
    if (plan.buildingsAudit.selectedAirBaseLocatorRows > 0 && finalKeeperAirBaseLocators.length !== 1) {
      failures.push(`写入后最终 State ${plan.keeperFinalId} 的 air_base 定位器应为 1 条，实际 ${finalKeeperAirBaseLocators.length} 条`)
    }
  }

  const fileFailures: string[] = []
  for (const patch of plan.patches) {
    const file = after.files.get(patch.path)
    if (patch.action === 'delete') {
      if (file) fileFailures.push(`${patch.path}:应删除但仍存在`)
    } else if (!file || file.text !== (patch.after ?? '')) {
      fileFailures.push(`${patch.path}:写后内容不一致`)
    }
  }
  if (fileFailures.length > 0) failures.push(`文件写后校验失败（${fileFailures.length}）：${fileFailures.slice(0, 5).join('、')}`)
  return failures
}
