import { useMemo, useState } from 'react'
import { Check, FileDown, FolderOpen, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { StateList } from './components/StateList'
import { MapCanvas, type SelectionMode } from './components/MapCanvas'
import { MergeInspector } from './components/MergeInspector'
import { BottomPanel } from './components/BottomPanel'
import { applyPatches, exportMergeReport, restorePatches, saveBackupZip } from './lib/fileSystem'
import { createDemoWorkspace } from './lib/demo'
import { createMergePlan, verifyAppliedMerge } from './lib/merge'
import { loadWorkspace } from './lib/workspace'
import type { MergePlan, MergePolicies, ModWorkspace } from './types'

const defaultPolicies: MergePolicies = {
  category: 'keeper',
  infrastructure: 'max',
  otherStateBuildings: 'sum',
}

export default function App() {
  const [workspace, setWorkspace] = useState<ModWorkspace>(() => createDemoWorkspace())
  const [isDemo, setIsDemo] = useState(true)
  const [keeperId, setKeeperId] = useState<number | undefined>(2)
  const [sourceIds, setSourceIds] = useState<number[]>([3, 4])
  const [mode, setMode] = useState<SelectionMode>('keeper')
  const [policies, setPolicies] = useState<MergePolicies>(defaultPolicies)
  const [plan, setPlan] = useState<MergePlan>()
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState('演示工作区只读；打开你的 MOD 后即可生成真实变更。')

  const blocking = plan?.conflicts.some((item) => item.severity === 'block') ?? true
  const stateMap = useMemo(() => new Map(workspace.states.map((state) => [state.id, state])), [workspace])
  const changedStateFiles = plan?.patches.filter((patch) => patch.path.startsWith('history/states/')).length ?? 0

  const pickState = (id: number, pickMode: SelectionMode) => {
    if (!stateMap.has(id)) return
    setPlan(undefined)
    if (pickMode === 'keeper') {
      setKeeperId(id)
      setSourceIds((current) => current.filter((item) => item !== id))
      setMode('source')
      return
    }
    if (pickMode === 'source') {
      if (id === keeperId) return
      setSourceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    }
  }

  const openMod = async () => {
    if (!window.showDirectoryPicker) {
      setNotice('当前浏览器不支持目录读写。请使用最新版 Chrome 或 Edge，并通过 localhost/HTTPS 打开。')
      return
    }
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' })
      setBusy('正在扫描 State、战略区域和引用…')
      const loaded = await loadWorkspace(root)
      setWorkspace(loaded)
      setIsDemo(false)
      setKeeperId(undefined)
      setSourceIds([])
      setPlan(undefined)
      setNotice(`已载入 ${loaded.states.length} 个 State；工具未修改任何文件。`)
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }

  const rescan = async () => {
    if (isDemo) {
      setWorkspace(createDemoWorkspace())
      setPlan(undefined)
      return
    }
    try {
      setBusy('正在重新扫描…')
      setWorkspace(await loadWorkspace(workspace.root))
      setPlan(undefined)
      setNotice('重新扫描完成。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }

  const dryRun = () => {
    if (!keeperId || sourceIds.length === 0) {
      setNotice('请先选择 1 个保留 State 和至少 1 个来源 State。')
      return
    }
    try {
      setBusy('正在计算 State ID 填洞、文件变更和引用迁移…')
      const nextPlan = createMergePlan(workspace, keeperId, sourceIds, policies)
      setPlan(nextPlan)
      const blocks = nextPlan.conflicts.filter((item) => item.severity === 'block').length
      setNotice(blocks
        ? `Dry Run 完成：发现 ${blocks} 个阻断问题，尚不能应用。`
        : `Dry Run 完成：${nextPlan.patches.length} 个文件将变化，定位器变更 ${nextPlan.buildingsAudit.changedRows} 条，其中折叠重复 air_base ${nextPlan.buildingsAudit.removedAirBaseLocatorLines.length} 条。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }

  const apply = async () => {
    if (!plan || blocking || isDemo) return
    try {
      setBusy('等待保存备份…')
      const backedUp = await saveBackupZip(plan, workspace.name)
      if (!backedUp) {
        setNotice('已取消：必须先保存备份，工具才会写入 MOD。')
        return
      }
      setBusy('正在写入已验证的合并计划…')
      await applyPatches(workspace.root, plan.patches)
      let reloaded: ModWorkspace
      try {
        setBusy('正在逐文件和逐 Province 校验写入结果…')
        reloaded = await loadWorkspace(workspace.root)
        const failures = verifyAppliedMerge(workspace, reloaded, plan)
        if (failures.length > 0) throw new Error(failures.join('；'))
      } catch (verificationError) {
        setBusy('写后校验失败，正在自动回滚…')
        try {
          await restorePatches(workspace.root, plan.patches)
        } catch (rollbackError) {
          throw new Error(
            `写后校验失败且自动回滚未完成：${verificationError instanceof Error ? verificationError.message : String(verificationError)}；`
            + `回滚错误：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          )
        }
        throw new Error(`写后校验失败，已自动回滚：${verificationError instanceof Error ? verificationError.message : String(verificationError)}`)
      }
      setWorkspace(reloaded)
      setKeeperId(undefined)
      setSourceIds([])
      setPlan(undefined)
      setNotice('合并已应用；文件、State ID、Province 归属、空军基地等级和地图定位器均通过写后校验。请用 -debug 启动游戏做最终验证。')
    } catch (error) {
      setNotice(`应用失败：${error instanceof Error ? error.message : String(error)}。若提示回滚未完成，请使用刚保存的 ZIP 恢复。`)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><ShieldCheck size={22} /><strong>HOI4 State Merger</strong><span>v0.1.9</span></div>
        <div className="path-box"><FolderOpen size={16} /><span>{workspace.name}</span></div>
        <div className="top-actions">
          <button onClick={openMod}><FolderOpen size={16} />打开 MOD</button>
          <button onClick={rescan} disabled={Boolean(busy)}><RefreshCw size={16} />重扫</button>
          <button onClick={dryRun} disabled={Boolean(busy)}><Play size={16} />Dry Run</button>
          <button onClick={() => plan && exportMergeReport(plan, workspace.name)} disabled={!plan || Boolean(busy)}><FileDown size={16} />导出报告</button>
          <button className="primary" onClick={apply} disabled={!plan || blocking || isDemo || Boolean(busy)}><Check size={16} />应用合并</button>
        </div>
      </header>

      <div className="workspace-grid">
        <StateList
          states={workspace.states}
          keeperId={keeperId}
          sourceIds={sourceIds}
          mode={mode}
          onPick={pickState}
        />
        <MapCanvas
          workspace={workspace}
          keeperId={keeperId}
          sourceIds={sourceIds}
          mode={mode}
          onModeChange={setMode}
          onPickState={pickState}
          onClear={() => { setKeeperId(undefined); setSourceIds([]); setPlan(undefined) }}
        />
        <MergeInspector
          states={workspace.states}
          keeperId={keeperId}
          sourceIds={sourceIds}
          plan={plan}
          policies={policies}
          onPoliciesChange={(nextPolicies) => { setPolicies(nextPolicies); setPlan(undefined) }}
          onRemoveSource={(id) => {
            setSourceIds((current) => current.filter((item) => item !== id))
            setPlan(undefined)
          }}
        />
        <BottomPanel plan={plan} />
      </div>

      <footer className="statusbar">
        <span>0 Province 文件变更</span>
        <span>{changedStateFiles} 个 State 文件变更</span>
        <span className="status-notice">{busy ?? notice}</span>
        <span className={blocking ? 'status-blocked' : 'status-ready'}>
          {plan ? (blocking ? '存在阻断问题' : '计划可应用') : '等待 Dry Run'}
        </span>
      </footer>
      {busy ? <div className="busy-line" /> : null}
    </main>
  )
}
