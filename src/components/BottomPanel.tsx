import { useState } from 'react'
import type { MergePlan } from '../types'

type Tab = 'changes' | 'conflicts' | 'references'

export function BottomPanel({ plan }: { plan?: MergePlan }) {
  const [tab, setTab] = useState<Tab>('changes')
  return (
    <section className="bottom-panel">
      <div className="bottom-tabs">
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>变更 ({plan?.patches.length ?? 0})</button>
        <button className={tab === 'conflicts' ? 'active' : ''} onClick={() => setTab('conflicts')}>检查 ({plan?.conflicts.length ?? 0})</button>
        <button className={tab === 'references' ? 'active' : ''} onClick={() => setTab('references')}>精确引用 ({plan?.references.length ?? 0})</button>
      </div>
      <div className="bottom-table">
        {tab === 'changes' ? <table><thead><tr><th>文件</th><th>操作</th><th>说明</th></tr></thead><tbody>
          {plan?.patches.map((patch) => <tr key={patch.path}><td>{patch.path}</td><td className={patch.action}>{patch.action === 'delete' ? '删除' : '修改'}</td><td>{patch.summary}</td></tr>)}
        </tbody></table> : null}
        {tab === 'conflicts' ? <table><thead><tr><th>级别</th><th>问题</th><th>说明</th></tr></thead><tbody>
          {plan?.conflicts.map((conflict) => <tr key={conflict.id}><td className={conflict.severity}>{conflict.severity.toUpperCase()}</td><td>{conflict.title}</td><td>{conflict.detail}</td></tr>)}
        </tbody></table> : null}
        {tab === 'references' ? <table><thead><tr><th>文件</th><th>行</th><th>变量 / 映射</th><th>原文 → 结果</th></tr></thead><tbody>
          {plan?.references.map((hit, index) => <tr key={`${hit.path}-${hit.line}-${index}`}>
            <td>{hit.path}</td><td>{hit.line}</td>
            <td className={hit.status}>{hit.keyPath ?? hit.rule} · {hit.oldId}→{hit.newId}{hit.status === 'review' ? '（仅提示）' : ''}</td>
            <td title={hit.after ? `${hit.before} → ${hit.after}` : hit.before}>{hit.after ? `${hit.before} → ${hit.after}` : hit.before}</td>
          </tr>)}
        </tbody></table> : null}
        {!plan ? <div className="table-empty">选择 State 并运行 Dry Run，所有计划变更都会先显示在这里。</div> : null}
      </div>
    </section>
  )
}
