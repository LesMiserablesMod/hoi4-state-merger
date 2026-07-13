import { describe, expect, it } from 'vitest'
import type { ModWorkspace, SourceFile, StateRecord } from '../types'
import { buildStateIdMap, createMergePlan } from './merge'
import { assignments, blockAtoms, blockValue, parsePdx } from './pdx'
import { remapBuildingsFile, rewriteBuildingsFile, rewriteStateReferences } from './references'
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
  const buildings = source('map/buildings.txt', '5;naval_base;100.50;0.00;200.25;0.00;-1\n2;bunker;20.00;0.00;30.00;0.00;-1\n')
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
})
