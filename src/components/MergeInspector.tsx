import { AlertTriangle, Ban, CheckCircle2, Flag, Info, Minus } from 'lucide-react'
import type { MergePlan, MergePolicies, StateRecord } from '../types'

interface Props {
  states: StateRecord[]
  keeperId?: number
  sourceIds: number[]
  plan?: MergePlan
  policies: MergePolicies
  onPoliciesChange: (policies: MergePolicies) => void
  onRemoveSource: (id: number) => void
}

const label = (state?: StateRecord) => state ? state.name.replace(/^"|"$/g, '') : '未选择'

export function MergeInspector({
  states, keeperId, sourceIds, plan, policies, onPoliciesChange, onRemoveSource,
}: Props) {
  const byId = new Map(states.map((state) => [state.id, state]))
  const keeper = keeperId ? byId.get(keeperId) : undefined
  const sources = sourceIds.map((id) => byId.get(id)).filter((state): state is StateRecord => Boolean(state))
  const blocks = plan?.conflicts.filter((item) => item.severity === 'block').length ?? 0
  const warnings = plan?.conflicts.filter((item) => item.severity === 'warning').length ?? 0
  const infos = plan?.conflicts.filter((item) => item.severity === 'info').length ?? 0

  return (
    <aside className="inspector-panel">
      <header><h2>合并计划</h2><span>{plan ? 'DRY RUN' : '未计算'}</span></header>
      <div className="inspector-scroll">
        <section className="inspector-section">
          <h3>保留 State</h3>
          <div className="keeper-line">
            <Flag size={15} />
            <strong>{keeper ? `${keeper.id} · ${label(keeper)}` : '请在地图或左侧列表中选择'}</strong>
            {keeper ? <span>{keeper.owner ?? '—'} · {keeper.provinceIds.length} 格</span> : null}
          </div>
        </section>
        <section className="inspector-section">
          <h3>来源 States <span>({sources.length})</span></h3>
          <div className="source-lines">
            {sources.length === 0 ? <p className="muted">选择相邻 State 作为合并来源。</p> : sources.map((state) => (
              <div className="source-line" key={state.id}>
                <button onClick={() => onRemoveSource(state.id)} title="移除"><Minus size={13} /></button>
                <strong>{state.id}</strong><span>{label(state)}</span><em>{state.provinceIds.length} 格</em>
              </div>
            ))}
          </div>
        </section>
        <section className="inspector-section result-box">
          <h3>合并结果</h3>
          <dl>
            <dt>最终 State ID</dt><dd>{plan?.keeperFinalId ?? keeperId ?? '—'}</dd>
            <dt>Province 数量</dt><dd>{plan?.totalProvinces ?? '—'}（不改 ID）</dd>
            <dt>人口</dt><dd>{plan?.resultManpower.toLocaleString() ?? '—'}</dd>
            <dt>资源类型</dt><dd>{plan ? Object.keys(plan.resultResources).length : '—'}</dd>
            <dt>地图定位器</dt><dd>{plan ? `${plan.buildingsAudit.changedRows} 迁移 / ${plan.buildingsAudit.parsedRows} 已校验` : '—'}</dd>
          </dl>
        </section>
        <section className="inspector-section policies">
          <h3>合并策略</h3>
          <label>人口与资源<select disabled><option>求和</option></select></label>
          <label>基础设施
            <select value={policies.infrastructure} onChange={(event) => onPoliciesChange({ ...policies, infrastructure: event.target.value as 'max' | 'sum' })}>
              <option value="max">保留最高等级</option><option value="sum">求和</option>
            </select>
          </label>
          <label>其他州级建筑
            <select value={policies.otherStateBuildings} onChange={(event) => onPoliciesChange({ ...policies, otherStateBuildings: event.target.value as 'max' | 'sum' })}>
              <option value="sum">求和</option><option value="max">保留最高等级</option>
            </select>
          </label>
          <label>State Category
            <select value={policies.category} onChange={(event) => onPoliciesChange({ ...policies, category: event.target.value as 'strict' | 'keeper' })}>
              <option value="keeper">保留目标州（推荐）</option><option value="strict">不一致时阻止</option>
            </select>
          </label>
        </section>
        <section className="inspector-section validation">
          <div className="validation-head">
            <h3>执行检查</h3>
            <span className={blocks ? 'bad' : 'good'}>{blocks} 阻断 · {warnings} 警告 · {infos} 说明</span>
          </div>
          {!plan ? <p className="muted">运行 Dry Run 后显示检查结果。</p> : plan.conflicts.length === 0 ? (
            <div className="all-clear"><CheckCircle2 size={16} />未发现阻断问题</div>
          ) : plan.conflicts.map((conflict) => (
            <div className={`conflict ${conflict.severity}`} key={conflict.id}>
              {conflict.severity === 'block' ? <Ban size={15} /> : conflict.severity === 'warning' ? <AlertTriangle size={15} /> : <Info size={15} />}
              <div><strong>{conflict.title}</strong><p>{conflict.detail}</p></div>
            </div>
          ))}
        </section>
      </div>
    </aside>
  )
}
