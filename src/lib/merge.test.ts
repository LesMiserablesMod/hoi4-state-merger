import { describe, expect, it } from 'vitest'
import type { MergePlan, ModWorkspace, SourceFile, StateRecord } from '../types'
import { buildStateIdMap, createMergePlan, verifyAppliedMerge } from './merge'
import { assignments, blockAtoms, blockValue, parsePdx } from './pdx'
import {
  findDuplicateAirBaseLocatorLines, remapBuildingsFile, rewriteBuildingsFile, rewriteStateReferences,
} from './references'
import { parseStateFile } from './stateParser'

const handle = {} as FileSystemFileHandle
const root = { name: 'fixture' } as FileSystemDirectoryHandle

function source(path: string, text: string): SourceFile {
  return { path, text, handle }
}

function stateFile(id: number): SourceFile {
  return source(`history/states/${id}-fixture.txt`, `state = {
  id = ${id}
  name = "STATE_${id}"
  manpower = ${id * 100}
  state_category = city
  resources = { steel = ${id} }
  history = {
    owner = GER
    add_core_of = GER
    buildings = {
      infrastructure = 2
      industrial_complex = 1
      ${id * 10} = { naval_base = 1 }
    }
    victory_points = { ${id * 10} ${id} }
    victory_points = { ${id * 10 + 1} ${id + 1} }
  }
  provinces = { ${id * 10} ${id * 10 + 1} }
  local_supplies = 0.2
}
`)
}

function fixtureWorkspace(): ModWorkspace {
  const stateFiles = [1, 2, 3, 4, 5].map(stateFile)
  const descriptor = source('descriptor.mod', 'replace_path = "history/states"\n')
  const buildings = source('map/buildings.txt', [
    ...[1, 2, 3, 4, 5].map((id) => `${id};air_base;${id * 10}.00;0.00;${id * 10 + 1}.00;0.00;-1`),
    '5;naval_base;100.50;0.00;200.25;0.00;-1',
    '2;bunker;20.00;0.00;30.00;0.00;-1',
  ].join('\n') + '\n')
  const event = source('events/fixture.txt', 'capital = 4\ntarget_state = 5\nstate:3\ndays = 4\nprovince = 5\n')
  const files = new Map([...stateFiles, descriptor, buildings, event].map((file) => [file.path, file]))
  const states = stateFiles.flatMap(parseStateFile)
  for (const state of states) state.strategicRegionIds = [1]
  const provinceToState = new Map<number, number>()
  for (const state of states) for (const province of state.provinceIds) provinceToState.set(province, state.id)
  return {
    root,
    name: 'fixture',
    states,
    files,
    provinceToState,
    provinceToRegion: new Map([...provinceToState.keys()].map((province) => [province, 1])),
  }
}

function appliedWorkspace(before: ModWorkspace, plan: MergePlan): ModWorkspace {
  const files = new Map([...before.files].map(([path, file]) => [path, source(path, file.text)]))
  for (const patch of plan.patches) {
    if (patch.action === 'delete') files.delete(patch.path)
    else files.set(patch.path, source(patch.path, patch.after ?? ''))
  }
  const states = [...files.values()]
    .filter((file) => /^history\/states\/.*\.txt$/i.test(file.path))
    .flatMap(parseStateFile)
    .toSorted((left, right) => left.id - right.id)
  for (const state of states) state.strategicRegionIds = [1]
  const provinceToState = new Map<number, number>()
  for (const state of states) for (const province of state.provinceIds) provinceToState.set(province, state.id)
  return { ...before, states, files, provinceToState }
}

function replaceWorkspaceFile(workspace: ModWorkspace, path: string, text?: string): ModWorkspace {
  const files = new Map(workspace.files)
  if (text === undefined) files.delete(path)
  else files.set(path, source(path, text))
  const states = [...files.values()]
    .filter((file) => /^history\/states\/.*\.txt$/i.test(file.path))
    .flatMap(parseStateFile)
    .toSorted((left, right) => left.id - right.id)
  for (const state of states) state.strategicRegionIds = [1]
  const provinceToState = new Map<number, number>()
  for (const state of states) for (const province of state.provinceIds) provinceToState.set(province, state.id)
  return { ...workspace, files, states, provinceToState }
}

describe('State ID tail filling', () => {
  it('fills low holes with surviving tail IDs and maps sources to the final keeper', () => {
    const states = [1, 2, 3, 4, 5].map((id) => ({ id }) as StateRecord)
    const result = buildStateIdMap(states, [2, 4], 3)
    expect([...result.map.entries()]).toEqual([[5, 2], [2, 3], [4, 3]])
    expect(result.finalKeeperId).toBe(3)
    expect(result.holes).toEqual([2])
  })
})

describe('conservative reference rewrites', () => {
  it('rewrites recognized State contexts but leaves arbitrary numbers untouched', () => {
    const idMap = new Map([[4, 2], [5, 3]])
    const input = 'capital = 4\ntarget_state = 5\nstate:4\ndays = 4\nprovince = 5\n'
    const result = rewriteStateReferences('events/test.txt', input, idMap)
    expect(result.text).toContain('capital = 2')
    expect(result.text).toContain('target_state = 3')
    expect(result.text).toContain('state:2')
    expect(result.text).toContain('days = 4')
    expect(result.text).toContain('province = 5')
    expect(result.hits).toHaveLength(3)
  })

  it('uses exact PDX tokens and reports only a concrete unregistered State-style variable', () => {
    const idMap = new Map([[4, 2], [5, 3]])
    const input = `# capital = 4
name = "capital = 4"
capital = 4
capital = 4.0
capital = -4
capital = "4"
province = 4
set_state_owner = 4
custom_state_target = 5
state:4
`
    const result = rewriteStateReferences('events/test.txt', input, idMap)
    expect(result.text).toContain('# capital = 4')
    expect(result.text).toContain('name = "capital = 4"')
    expect(result.text).toContain('capital = 2')
    expect(result.text).toContain('capital = 4.0')
    expect(result.text).toContain('capital = -4')
    expect(result.text).toContain('capital = "4"')
    expect(result.text).toContain('province = 4')
    expect(result.text).toContain('set_state_owner = 4')
    expect(result.text).toContain('custom_state_target = 5')
    expect(result.text).toContain('state:2')
    expect(result.hits.filter((hit) => hit.status === 'updated')).toHaveLength(2)
    expect(result.hits.filter((hit) => hit.status === 'review').map((hit) => hit.keyPath)).toEqual(['custom_state_target'])
  })

  it('applies collision mappings once without rescanning a valid new ID', () => {
    const result = rewriteStateReferences(
      'events/test.txt',
      'target_state = 5\nstate = 3\n',
      new Map([[5, 3], [3, 2]]),
    )
    expect(result.text).toBe('target_state = 3\nstate = 2\n')
    expect(result.hits.every((hit) => hit.status === 'updated')).toBe(true)
  })

  it('rewrites numeric State keys only in an explicit air_wings context and reports the hit', () => {
    const input = `air_wings = {
  2634 = { fighter_equipment_0 = { amount = 50 } }
}
state = {
  history = {
    buildings = {
      2634 = { naval_base = 1 }
    }
  }
}
`
    const result = rewriteStateReferences('history/units/test.txt', input, new Map([[2634, 2631]]))

    expect(result.text).toContain('air_wings = {\n  2631 = {')
    expect(result.text).toContain('buildings = {\n      2634 = { naval_base = 1 }')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toMatchObject({
      status: 'updated',
      oldId: 2634,
      newId: 2631,
      keyPath: 'air_wings > 2634',
      rule: 'air_wings State ID 数字键',
    })
  })

  it('only remaps the first column of map/buildings.txt', () => {
    const result = remapBuildingsFile(
      '5;naval_base;50.00;1.00;0.00;0.00;-1\n',
      new Map([[5, 3], [50, 9]]),
    )
    expect(result).toBe('3;naval_base;50.00;1.00;0.00;0.00;-1\n')
  })

  it('preserves comments, blank lines and CRLF while mapping each State ID once', () => {
    const result = remapBuildingsFile(
      '# 5;naval_base;0;0;0;0;-1\r\n\r\n  5;arms_factory;3;4;5;6;-1\r\n3;50;7;8;9;10;-1\r\n',
      new Map([[5, 3], [3, 2], [50, 9]]),
    )
    expect(result).toBe(
      '# 5;naval_base;0;0;0;0;-1\r\n\r\n  3;arms_factory;3;4;5;6;-1\r\n2;50;7;8;9;10;-1\r\n',
    )
  })

  it('applies the real crash mapping once and leaves the adjacent-sea Province column untouched', () => {
    const input = [
      '2621;arms_factory;10;0;20;0;-1',
      '2634;supply_node;11;0;21;0;-1',
      '4767;naval_base_spawn;12;0;22;0;2634',
      '4768;industrial_complex;13;0;23;0;2621',
    ].join('\n') + '\n'
    const result = rewriteBuildingsFile(
      input,
      new Map([[2621, 2631], [2634, 2631], [4767, 2634], [4768, 2621]]),
      new Set([2621, 2634, 4767, 4768]),
      new Set([2621, 2631, 2634]),
      new Set([2621, 2634]),
    )

    expect(result.text).toBe([
      '2631;arms_factory;10;0;20;0;-1',
      '2631;supply_node;11;0;21;0;-1',
      '2634;naval_base_spawn;12;0;22;0;2634',
      '2621;industrial_complex;13;0;23;0;2621',
    ].join('\n') + '\n')
    expect(result.audit).toMatchObject({
      totalRows: 4,
      parsedRows: 4,
      changedRows: 4,
      selectedRows: 2,
      invalidBeforeStateLines: [],
      invalidAfterStateLines: [],
      mismatchedLines: [],
      suffixMismatchLines: [],
    })
    expect(result.hits.map((hit) => `${hit.oldId}->${hit.newId}`)).toEqual([
      '2621->2631', '2634->2631', '4767->2634', '4768->2621',
    ])
  })

  it('keeps the keeper air_base locator and removes source locators after a CRLF merge', () => {
    const input = [
      '3;air_base;30;0;31;0;-1',
      '2;air_base;20;0;21;0;-1',
      '4;air_base;40;0;41;0;-1',
      '3;naval_base_spawn;32;0;33;0;300',
      '4;arms_factory;42;0;43;0;-1',
    ].join('\r\n') + '\r\n'
    const result = rewriteBuildingsFile(
      input,
      new Map([[3, 2], [4, 2]]),
      new Set([2, 3, 4]),
      new Set([2]),
      new Set([2, 3, 4]),
      2,
    )

    expect(result.text).toBe([
      '2;air_base;20;0;21;0;-1',
      '2;naval_base_spawn;32;0;33;0;300',
      '2;arms_factory;42;0;43;0;-1',
    ].join('\r\n') + '\r\n')
    expect(result.audit.removedAirBaseLocatorLines).toHaveLength(2)
    expect(result.audit.duplicateAirBaseLocatorLines).toEqual([])
    expect(findDuplicateAirBaseLocatorLines(result.text)).toEqual([])
  })

  it('keeps the earliest source air_base locator when the keeper has none', () => {
    const result = rewriteBuildingsFile(
      '3;air_base;30;0;31;0;-1\n4;air_base;40;0;41;0;-1\n2;bunker;20;0;21;0;-1\n',
      new Map([[3, 2], [4, 2]]),
      new Set([2, 3, 4]),
      new Set([2]),
      new Set([2, 3, 4]),
      2,
    )

    expect(result.text).toContain('2;air_base;30;0;31;0;-1\n')
    expect(result.text).not.toContain('air_base;40;0;41')
    expect(result.audit.removedAirBaseLocatorLines).toHaveLength(1)
  })

  it('keeps the tail-fill keeper locator even when its final ID equals the removed source ID', () => {
    const result = rewriteBuildingsFile(
      '2;air_base;20;0;21;0;-1\n5;air_base;50;0;51;0;-1\n',
      new Map([[5, 2], [2, 2]]),
      new Set([1, 2, 3, 4, 5]),
      new Set([1, 2, 3, 4]),
      new Set([2, 5]),
      5,
    )

    expect(result.text).toBe('2;air_base;50;0;51;0;-1\n')
    expect(result.audit.removedAirBaseLocatorLines).toHaveLength(1)
    expect(result.audit.duplicateAirBaseLocatorLines).toEqual([])
  })

  it('does not deduplicate province or multi-locator building types', () => {
    const result = rewriteBuildingsFile(
      '2;bunker;20;0;21;0;-1\n3;bunker;30;0;31;0;-1\n3;naval_base_spawn;32;0;33;0;300\n',
      new Map([[3, 2]]),
      new Set([2, 3]),
      new Set([2]),
      new Set([2, 3]),
      2,
    )

    expect(result.text.match(/^2;bunker;.*$/gm)).toHaveLength(2)
    expect(result.text).toContain('2;naval_base_spawn;32;0;33;0;300')
    expect(result.audit.removedAirBaseLocatorLines).toEqual([])
  })

  it('reports an exact unknown numeric block key but excludes Province and random-list keys', () => {
    const input = `completion_reward = {
  2634 = { add_core_of = GER }
}
random_list = {
  2634 = { add_political_power = 10 }
}
buildings = {
  2634 = { naval_base = 1 }
}
`
    const result = rewriteStateReferences('common/national_focus/test.txt', input, new Map([[2634, 2631]]))
    expect(result.text).toBe(input)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toMatchObject({
      status: 'review',
      keyPath: 'completion_reward > 2634',
      oldId: 2634,
      newId: 2631,
    })
  })
})

describe('merge plan', () => {
  it('merges State contents, tombstones source files, fills IDs and never patches Province map files', () => {
    const plan = createMergePlan(fixtureWorkspace(), 2, [3, 4], {
      category: 'strict',
      infrastructure: 'max',
      otherStateBuildings: 'sum',
    })
    expect(plan.conflicts.filter((conflict) => conflict.severity === 'block')).toEqual([])
    expect(plan.keeperFinalId).toBe(2)
    expect([...plan.idMap.entries()]).toEqual([[5, 3], [3, 2], [4, 2]])
    expect(plan.totalProvinces).toBe(6)
    expect(plan.resultManpower).toBe(900)
    expect(plan.patches.find((patch) => patch.path.includes('2-fixture'))?.after).toContain('provinces = {\n\t\t20 21 30 31 40 41')
    expect(plan.patches.filter((patch) => patch.summary.includes('覆盖占位')).map((patch) => patch.path)).toEqual([
      'history/states/3-fixture.txt',
      'history/states/4-fixture.txt',
    ])
    expect(plan.patches.find((patch) => patch.path === 'history/states/3-fixture.txt')?.after).toContain('empty override')
    expect(plan.patches.find((patch) => patch.path.includes('5-fixture'))?.after).toContain('id = 3')
    expect(plan.patches.find((patch) => patch.path === 'map/buildings.txt')?.after).toContain('3;naval_base;100.50')
    expect(plan.patches.find((patch) => patch.path === 'events/fixture.txt')?.after).toContain('capital = 2')
    expect(plan.patches.some((patch) => patch.path === 'map/provinces.bmp')).toBe(false)
    expect(plan.patches.some((patch) => patch.path === 'map/definition.csv')).toBe(false)
  })

  it('writes every merged Victory Point as an independent two-atom block', () => {
    const plan = createMergePlan(fixtureWorkspace(), 2, [3, 4], {
      category: 'strict',
      infrastructure: 'max',
      otherStateBuildings: 'sum',
    })
    const keeperAfter = plan.patches.find((patch) => patch.path.includes('2-fixture'))?.after ?? ''
    const state = blockValue(parsePdx(keeperAfter), 'state')
    const history = state ? blockValue(state, 'history') : undefined
    const victoryPoints = history ? assignments(history, 'victory_points') : []
    expect(victoryPoints).toHaveLength(6)
    expect(victoryPoints.map((item) => item.value.kind === 'block' ? blockAtoms(item.value) : []))
      .toEqual([
        ['20', '2'],
        ['21', '3'],
        ['30', '3'],
        ['31', '4'],
        ['40', '4'],
        ['41', '5'],
      ])
    expect(victoryPoints.every((item) =>
      item.value.kind === 'block' && blockAtoms(item.value).length === 2,
    )).toBe(true)
  })

  it('caps merged air_base levels using the mod building definition', () => {
    const workspace = fixtureWorkspace()
    workspace.states.find((state) => state.id === 2)!.stateBuildings.air_base = 6
    workspace.states.find((state) => state.id === 3)!.stateBuildings.air_base = 7
    const buildingDefinition = source('common/buildings/zz_test.txt', `buildings = {
  @custom_air_base_cap = 8
  air_base = {
    level_cap = {
      state_max = @custom_air_base_cap
    }
  }
}
`)
    workspace.files.set(buildingDefinition.path, buildingDefinition)

    const plan = createMergePlan(workspace, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })

    expect(plan.requestedAirBaseLevel).toBe(13)
    expect(plan.airBaseLevelCap).toBe(8)
    expect(plan.airBaseLevelCapSource).toBe('common/buildings/zz_test.txt')
    expect(plan.resultBuildings.air_base).toBe(8)
    expect(plan.conflicts.find((item) => item.id === 'air-base-level-capped')?.severity).toBe('warning')
    expect(plan.patches.find((patch) => patch.path.includes('2-fixture'))?.after).toContain('air_base = 8')
  })

  it('blocks fractional air_base levels and warns when state_max cannot be resolved', () => {
    const workspace = fixtureWorkspace()
    workspace.states.find((state) => state.id === 2)!.stateBuildings.air_base = 1.5
    const malformedDefinition = source('common/buildings/zz_bad.txt', `buildings = {
  air_base = { level_cap = { state_max = 8.5 } }
}
`)
    workspace.files.set(malformedDefinition.path, malformedDefinition)

    const plan = createMergePlan(workspace, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })

    expect(plan.conflicts.find((item) => item.id === 'air-base-level-invalid')?.severity).toBe('block')
    expect(plan.conflicts.find((item) => item.id === 'air-base-level-cap-invalid')?.severity).toBe('warning')
    expect(plan.airBaseLevelCap).toBe(10)
  })

  it('folds source air_base locators into the keeper locator in the merge plan', () => {
    const workspace = fixtureWorkspace()
    const buildings = source('map/buildings.txt', [
      '3;air_base;30;0;31;0;-1',
      '2;air_base;20;0;21;0;-1',
      '4;air_base;40;0;41;0;-1',
      '3;bunker;32;0;33;0;-1',
    ].join('\n') + '\n')
    workspace.files.set(buildings.path, buildings)

    const plan = createMergePlan(workspace, 2, [3, 4], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })
    const after = plan.patches.find((patch) => patch.path === 'map/buildings.txt')?.after ?? ''

    expect(after.split('\n').filter((line) => line.startsWith('2;air_base;')))
      .toEqual(['2;air_base;20;0;21;0;-1'])
    expect(after).toContain('2;bunker;32;0;33;0;-1')
    expect(plan.buildingsAudit.removedAirBaseLocatorLines).toHaveLength(2)
    expect(plan.conflicts.find((item) => item.id === 'map-buildings-air-base-deduplicated')?.severity).toBe('info')
    expect(plan.conflicts.find((item) => item.id === 'map-buildings-duplicate-air-base')).toBeUndefined()
  })

  it('repairs a duplicate keeper locator with a warning but blocks unrelated duplicates', () => {
    const keeperDuplicate = fixtureWorkspace()
    const keeperBuildings = source('map/buildings.txt', [
      '2;air_base;20;0;21;0;-1',
      '2;air_base;22;0;23;0;-1',
      '3;air_base;30;0;31;0;-1',
    ].join('\n') + '\n')
    keeperDuplicate.files.set(keeperBuildings.path, keeperBuildings)
    const repairedPlan = createMergePlan(keeperDuplicate, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })

    expect(repairedPlan.buildingsAudit.preexistingDuplicateAirBaseLocatorLines).toHaveLength(2)
    expect(repairedPlan.buildingsAudit.removedAirBaseLocatorLines).toHaveLength(2)
    expect(repairedPlan.conflicts.find((item) => item.id === 'map-buildings-preexisting-duplicate-air-base')?.severity)
      .toBe('warning')
    expect(repairedPlan.conflicts.find((item) => item.id === 'map-buildings-duplicate-air-base')).toBeUndefined()

    const unrelatedDuplicate = fixtureWorkspace()
    const unrelatedBuildings = source('map/buildings.txt', [
      '1;air_base;10;0;11;0;-1',
      '1;air_base;12;0;13;0;-1',
      '2;air_base;20;0;21;0;-1',
      '3;air_base;30;0;31;0;-1',
    ].join('\n') + '\n')
    unrelatedDuplicate.files.set(unrelatedBuildings.path, unrelatedBuildings)
    const blockedPlan = createMergePlan(unrelatedDuplicate, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })

    expect(blockedPlan.conflicts.find((item) => item.id === 'map-buildings-duplicate-air-base')?.severity)
      .toBe('block')
  })

  it('discards source political and dated history without blocking the merge', () => {
    const workspace = fixtureWorkspace()
    const oldSource = workspace.files.get('history/states/3-fixture.txt')!
    const changedSource = source(oldSource.path, oldSource.text
      .replace('owner = GER', 'owner = FRA\n    1939.1.1 = { owner = ENG }\n    custom_history_effect = yes'))
    workspace.files.set(changedSource.path, changedSource)
    workspace.states = workspace.states.filter((state) => state.id !== 3)
    const parsed = parseStateFile(changedSource)[0]
    parsed.strategicRegionIds = [1]
    workspace.states.push(parsed)
    workspace.states.sort((left, right) => left.id - right.id)

    const plan = createMergePlan(workspace, 2, [3], {
      category: 'keeper',
      infrastructure: 'max',
      otherStateBuildings: 'sum',
    })
    expect(plan.conflicts.filter((conflict) => conflict.severity === 'block')).toEqual([])
    expect(plan.conflicts.find((conflict) => conflict.id === 'source-history-discarded')?.detail).toContain('含日期历史：3')
    expect(plan.patches.find((patch) => patch.path === changedSource.path)?.after).toContain('empty override')
  })

  it('blocks when map/buildings.txt is missing or contains an unparseable data row', () => {
    const missing = fixtureWorkspace()
    missing.files.delete('map/buildings.txt')
    const missingPlan = createMergePlan(missing, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })
    expect(missingPlan.conflicts.find((item) => item.id === 'map-buildings-missing')?.severity).toBe('block')

    const malformed = fixtureWorkspace()
    const oldBuildings = malformed.files.get('map/buildings.txt')!
    malformed.files.set('map/buildings.txt', source('map/buildings.txt', `${oldBuildings.text}not-a-state;naval_base;1;2;3;4;-1\n`))
    const malformedPlan = createMergePlan(malformed, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })
    expect(malformedPlan.conflicts.find((item) => item.id === 'map-buildings-unparsed')?.severity).toBe('block')
  })

  it('blocks when none of the selected States has an air_base locator', () => {
    const workspace = fixtureWorkspace()
    const withoutSelectedAirBase = source('map/buildings.txt', [
      '1;air_base;10;0;11;0;-1',
      '4;air_base;40;0;41;0;-1',
      '5;air_base;50;0;51;0;-1',
      '2;bunker;20;0;21;0;-1',
      '3;arms_factory;30;0;31;0;-1',
    ].join('\n') + '\n')
    workspace.files.set(withoutSelectedAirBase.path, withoutSelectedAirBase)

    const plan = createMergePlan(workspace, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })

    expect(plan.conflicts.find((item) => item.id === 'map-buildings-selected-air-base-missing')?.severity)
      .toBe('block')
  })

  it('blocks a cross-Strategic-Region merge', () => {
    const workspace = fixtureWorkspace()
    workspace.states.find((state) => state.id === 3)!.strategicRegionIds = [2]
    const plan = createMergePlan(workspace, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })
    expect(plan.conflicts.find((item) => item.id === 'strategic-region')?.severity).toBe('block')
  })

  it('blocks a Victory Point that references a Province outside its State', () => {
    const workspace = fixtureWorkspace()
    workspace.states.find((state) => state.id === 3)!.victoryPoints[9999] = 10
    const plan = createMergePlan(workspace, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })

    expect(plan.conflicts.find((item) => item.id === 'victory-point-3-9999')?.severity).toBe('block')
  })

  it('write-after verification rejects an over-cap level, duplicate or missing locator, and missing file', () => {
    const before = fixtureWorkspace()
    before.states.find((state) => state.id === 2)!.stateBuildings.air_base = 6
    before.states.find((state) => state.id === 3)!.stateBuildings.air_base = 7
    const plan = createMergePlan(before, 2, [3], {
      category: 'keeper', infrastructure: 'max', otherStateBuildings: 'sum',
    })
    const applied = appliedWorkspace(before, plan)
    expect(verifyAppliedMerge(before, applied, plan)).toEqual([])

    const keeperPath = plan.patches.find((patch) => patch.path.includes('2-fixture'))!.path
    const overCapText = applied.files.get(keeperPath)!.text.replace('air_base = 10', 'air_base = 11')
    const overCap = replaceWorkspaceFile(applied, keeperPath, overCapText)
    expect(verifyAppliedMerge(before, overCap, plan).some((failure) => failure.includes('超过上限 10'))).toBe(true)

    const buildingsPath = 'map/buildings.txt'
    const buildingsText = applied.files.get(buildingsPath)!.text
    const keeperLocator = buildingsText.split('\n').find((line) => line.startsWith(`${plan.keeperFinalId};air_base;`))!
    const duplicate = replaceWorkspaceFile(applied, buildingsPath, `${buildingsText}${keeperLocator}\n`)
    expect(verifyAppliedMerge(before, duplicate, plan).some((failure) => failure.includes('重复 air_base 定位器'))).toBe(true)

    const withoutKeeperLocator = buildingsText.split('\n')
      .filter((line) => !line.startsWith(`${plan.keeperFinalId};air_base;`))
      .join('\n')
    const missingLocator = replaceWorkspaceFile(applied, buildingsPath, withoutKeeperLocator)
    expect(verifyAppliedMerge(before, missingLocator, plan).some((failure) => failure.includes('应为 1 条，实际 0 条'))).toBe(true)

    const missingFile = replaceWorkspaceFile(applied, buildingsPath)
    expect(verifyAppliedMerge(before, missingFile, plan)).toContain('写入后缺少 map/buildings.txt，无法校验空军基地定位器')
  })
})
