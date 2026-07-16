import type { ModWorkspace, SourceFile } from '../types'
import { parseStateFile } from './stateParser'

const dummyFileHandle = {} as FileSystemFileHandle
const dummyRoot = { name: 'demo-workspace' } as FileSystemDirectoryHandle

function makeStateFile(id: number, name: string, startProvince: number, category = 'city'): SourceFile {
  const provinces = [startProvince, startProvince + 1, startProvince + 2, startProvince + 3]
  const text = `state = {
\tid = ${id}
\tname = "${name}"
\tmanpower = ${120000 + id * 17000}
\tstate_category = ${category}
\tresources = {
\t\tsteel = ${id * 2}
\t}
\thistory = {
\t\towner = GER
\t\tadd_core_of = GER
\t\tbuildings = {
\t\t\tinfrastructure = 2
\t\t\tindustrial_complex = ${id % 3}
\t\t}
\t\tvictory_points = { ${provinces[0]} ${id % 4 + 1} }
\t}
\tprovinces = { ${provinces.join(' ')} }
\tlocal_supplies = 0.2
}
`
  return { path: `history/states/${id}-${name}.txt`, text, handle: dummyFileHandle }
}

function createDemoBmp(): { bmp: ArrayBuffer; definition: string; provinceState: Map<number, number> } {
  const width = 720
  const height = 360
  const bytesPerRow = Math.ceil((width * 3) / 4) * 4
  const buffer = new ArrayBuffer(54 + bytesPerRow * height)
  const view = new DataView(buffer)
  view.setUint16(0, 0x4d42, true)
  view.setUint32(2, buffer.byteLength, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, bytesPerRow * height, true)
  const definition: string[] = []
  const provinceState = new Map<number, number>()
  let provinceId = 1
  const columns = 4
  const rows = 2
  for (let state = 1; state <= columns * rows; state += 1) {
    for (let part = 0; part < 4; part += 1) {
      const red = (37 * provinceId + 30) % 245 + 5
      const green = (83 * provinceId + 60) % 245 + 5
      const blue = (131 * provinceId + 90) % 245 + 5
      definition.push(`${provinceId};${red};${green};${blue};land;false;plains;1`)
      provinceState.set(provinceId, state)
      provinceId += 1
    }
  }
  for (let y = 0; y < height; y += 1) {
    const visualY = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const col = Math.min(columns - 1, Math.floor(x / (width / columns)))
      const row = Math.min(rows - 1, Math.floor(visualY / (height / rows)))
      const stateId = row * columns + col + 1
      const localX = x - col * (width / columns)
      const localY = visualY - row * (height / rows)
      const part = (localX > width / columns / 2 ? 1 : 0) + (localY > height / rows / 2 ? 2 : 0)
      const province = (stateId - 1) * 4 + part + 1
      const [, redText, greenText, blueText] = definition[province - 1].split(';')
      const offset = 54 + y * bytesPerRow + x * 3
      view.setUint8(offset, Number(blueText))
      view.setUint8(offset + 1, Number(greenText))
      view.setUint8(offset + 2, Number(redText))
    }
  }
  return { bmp: buffer, definition: definition.join('\n'), provinceState }
}

export function createDemoWorkspace(): ModWorkspace {
  const names = ['Westfalen', 'Hannover', 'Braunschweig', 'Magdeburg', 'Anhalt', 'Thüringen', 'Sachsen', 'Brandenburg']
  const stateFiles = names.map((name, index) => makeStateFile(index + 1, name, index * 4 + 1))
  const descriptor: SourceFile = {
    path: 'descriptor.mod',
    text: 'replace_path = "history/states"\n',
    handle: dummyFileHandle,
  }
  const referenceDemo: SourceFile = {
    path: 'events/state-merger-demo.txt',
    text: '# days = 3 不应被识别为 State\ntarget_state = 3\ndays = 3\n',
    handle: dummyFileHandle,
  }
  const buildingsDemo: SourceFile = {
    path: 'map/buildings.txt',
    text: names.flatMap((_, index) => [
      `${index + 1};air_base;${70 + index * 70}.00;0.00;${80 + index * 30}.00;0.00;-1`,
      `${index + 1};industrial_complex;${80 + index * 70}.00;0.00;${90 + index * 30}.00;0.00;-1`,
    ]).join('\n') + '\n',
    handle: dummyFileHandle,
  }
  const files = new Map([...stateFiles, descriptor, referenceDemo, buildingsDemo]
    .map((file) => [file.path, file]))
  const states = stateFiles.flatMap(parseStateFile)
  for (const state of states) state.strategicRegionIds = [1]
  const provinceToState = new Map<number, number>()
  for (const state of states) for (const province of state.provinceIds) provinceToState.set(province, state.id)
  const generated = createDemoBmp()
  return {
    root: dummyRoot,
    name: '演示工作区（只读）',
    states,
    files,
    provinceToState,
    provinceToRegion: new Map([...generated.provinceState.keys()].map((province) => [province, 1])),
    definitionText: generated.definition,
    provincesBmp: generated.bmp,
  }
}
