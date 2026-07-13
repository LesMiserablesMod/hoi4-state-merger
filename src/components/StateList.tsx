import { Search, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { StateRecord } from '../types'
import type { SelectionMode } from './MapCanvas'

interface Props {
  states: StateRecord[]
  keeperId?: number
  sourceIds: number[]
  mode: SelectionMode
  onPick: (id: number, mode: SelectionMode) => void
}

function stateLabel(state: StateRecord): string {
  return state.name.replace(/^"|"$/g, '').replace(/^STATE_/, 'State ')
}

export function StateList({ states, keeperId, sourceIds, mode, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState('all')
  const [region, setRegion] = useState('all')
  const owners = useMemo(() => [...new Set(states.map((state) => state.owner).filter(Boolean))].toSorted(), [states])
  const regions = useMemo(() => [...new Set(states.flatMap((state) => state.strategicRegionIds))].toSorted((a, b) => a - b), [states])
  const filtered = useMemo(() => states.filter((state) => {
    const matchQuery = `${state.id} ${state.name}`.toLowerCase().includes(query.toLowerCase())
    const matchOwner = owner === 'all' || state.owner === owner
    const matchRegion = region === 'all' || state.strategicRegionIds.includes(Number(region))
    return matchQuery && matchOwner && matchRegion
  }), [states, query, owner, region])

  return (
    <aside className="states-panel">
      <header><h2>States</h2><span>{states.length}</span></header>
      <label className="search-field">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 ID 或名称…" />
      </label>
      <div className="filters">
        <label>所有者
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="all">全部</option>
            {owners.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>战略区域
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="all">全部</option>
            {regions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="state-table-head"><span>ID</span><span>名称</span><span>Owner</span><span>格数</span><span /></div>
      <div className="state-list">
        {filtered.map((state) => {
          const selected = keeperId === state.id ? 'keeper' : sourceIds.includes(state.id) ? 'source' : ''
          const risky = state.historyHasDates || state.unknownHistoryKeys.length > 0
          return (
            <button key={state.id} className={`state-row ${selected}`} onClick={() => onPick(state.id, mode === 'pan' ? 'source' : mode)}>
              <span>{state.id}</span>
              <span title={stateLabel(state)}>{stateLabel(state)}</span>
              <span>{state.owner ?? '—'}</span>
              <span>{state.provinceIds.length}</span>
              <span>{risky ? <ShieldAlert size={14} /> : null}</span>
            </button>
          )
        })}
      </div>
      <footer>{keeperId ? '已选择 1 个保留州' : '未选择保留州'} · {sourceIds.length} 个来源州</footer>
    </aside>
  )
}
