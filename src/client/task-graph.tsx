/** Dependency layout uses persisted edges; accepted counts never stand in for work percentage. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dependencies, runsOf } from '../graph.ts'
import type { TaskSnapshot } from '../state-schema.ts'

const WIDTH = 154
const GAP_X = 40

export function TaskGraph({ task, selected, select, label, executor, compact = false }: {
  task: TaskSnapshot; selected?: string | undefined; select: (id: string) => void; label: (id: string) => string; executor: (id: string) => string; compact?: boolean
}) {
  const height = compact ? 64 : 84
  const gapY = compact ? 16 : 24
  const anchors = useRef(new Map<string, HTMLButtonElement>())
  const viewport = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(hideTimer.current), [])
  function show(id: string, element: HTMLElement) {
    clearTimeout(hideTimer.current)
    const rect = element.getBoundingClientRect()
    setHover({ id, left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
      top: rect.bottom + 8 + 260 > window.innerHeight ? Math.max(12, rect.top - 268) : rect.bottom + 8 })
  }
  const hide = () => { hideTimer.current = setTimeout(() => setHover(null), 140) }
  useEffect(() => {
    const id = hover?.id
    if (!id) return
    const update = () => {
      const anchor = anchors.current.get(id)
      const bounds = viewport.current?.getBoundingClientRect()
      if (!anchor || !bounds) return
      const rect = anchor.getBoundingClientRect()
      if (rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) setHover(null)
      else show(id, anchor)
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [hover?.id])
  const hovered = task.stages.find(stage => stage.id === hover?.id)
  const graph = useMemo(() => {
    const levels = new Map<string, number>()
    const positions = new Map<string, { x: number; y: number }>()
    const level = (id: string): number => {
      const cached = levels.get(id)
      if (cached !== undefined) return cached
      const index = task.stages.findIndex(stage => stage.id === id)
      const value = Math.max(-1, ...dependencies(task.stages, index).map(level)) + 1
      levels.set(id, value)
      return value
    }
    const rows = new Map<number, number>()
    for (const stage of task.stages) {
      const column = level(stage.id)
      const row = rows.get(column) ?? 0
      positions.set(stage.id, { x: 12 + column * (WIDTH + GAP_X), y: 12 + row * (height + gapY) })
      rows.set(column, row + 1)
    }
    const maxRows = Math.max(1, ...rows.values())
    for (const stage of task.stages) { const pos = positions.get(stage.id)!; pos.y += (maxRows - rows.get(level(stage.id))!) * (height + gapY) / 2 }
    return { positions, width: 24 + (Math.max(0, ...levels.values()) + 1) * (WIDTH + GAP_X) - GAP_X,
      height: 24 + Math.max(1, ...rows.values()) * (height + gapY) - gapY }
  }, [task.stages, height, gapY])
  useEffect(() => {
    if (!compact || !selected) return
    const pos = graph.positions.get(selected)
    const element = viewport.current
    if (pos && element) element.scrollTo({ left: Math.max(0, pos.x - (element.clientWidth - WIDTH) / 2), top: Math.max(0, pos.y - (element.clientHeight - height) / 2) })
  }, [compact, selected])
  return <><div ref={viewport} className="dsh-task-graph-scroll" data-compact={compact || undefined} aria-label="任务依赖图，可横向滚动">
    <div className="dsh-task-graph" style={{ width: graph.width, height: graph.height }}>
      <svg width={graph.width} height={graph.height} aria-hidden="true">
        {task.stages.flatMap((stage, i) => dependencies(task.stages, i).map(parent => {
          const a = graph.positions.get(parent)!
          const b = graph.positions.get(stage.id)!
          const x = a.x + WIDTH; const y = a.y + height / 2; const endY = b.y + height / 2
          return <g key={`${parent}:${stage.id}`}>
            <path d={`M${x} ${y} C${x + GAP_X / 2} ${y},${b.x - GAP_X / 2} ${endY},${b.x} ${endY}`} />
            <path d={`M${b.x - 6} ${endY - 4} L${b.x} ${endY} L${b.x - 6} ${endY + 4}`} />
          </g>
        }))}
      </svg>
      {task.stages.map(stage => {
        const position = graph.positions.get(stage.id)!
        const run = runsOf(task).find(run => run.id === stage.id)
        return <button ref={element => { if (element) anchors.current.set(stage.id, element); else anchors.current.delete(stage.id) }} type="button" key={stage.id} className="dsh-task-node" data-status={run?.status}
          aria-pressed={selected === stage.id} onClick={() => { setHover(null); select(stage.id) }}
          onMouseEnter={event => show(stage.id, event.currentTarget)} onMouseLeave={hide}
          onFocus={event => show(stage.id, event.currentTarget)} onBlur={hide}
          onKeyDown={event => { if (event.key === 'Escape') setHover(null) }}
          aria-label={`${stage.title} · ${label(stage.id)}`}
          style={{ left: position.x, top: position.y, width: WIDTH, height: height }}>
          <span><i aria-hidden="true" />{label(stage.id)}</span><strong>{stage.title}</strong><small>{executor(stage.id)}</small>
        </button>
      })}
    </div>
  </div>
    {hover && hovered && createPortal(<aside role="tooltip" className="dsh-task-node-tooltip" style={{ left: hover.left, top: hover.top }}
      onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={hide}>
      <strong>{hovered.title}</strong><small>{executor(hovered.id)} · {label(hovered.id)} · 尝试 {runsOf(task).find(run => run.id === hovered.id)?.attempt ?? 1}</small>
      <p>{hovered.description ?? '点击节点查看验收与执行详情。'}</p>
      <ul>{task.criteria.filter(item => hovered.criterionIds.includes(item.id)).map(item => <li key={item.id}>{item.text}</li>)}</ul>
    </aside>, document.body)}
  </>
}

export const GRAPH_CSS = `
.dsh-task-graph-scroll{max-width:100%;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;overscroll-behavior:contain}
.dsh-task-graph-scroll[data-compact]{max-height:min(180px,24vh);border:0;border-radius:0}.dsh-task-graph-scroll[data-compact] .dsh-task-graph{margin:0 auto}.dsh-task-graph-scroll[data-compact] .dsh-task-node{padding:6px 10px;gap:3px}.dsh-task-graph{position:relative;margin:6px auto}.dsh-task-graph svg{position:absolute;inset:0;pointer-events:none}.dsh-task-graph path{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.2;opacity:.6}
.dsh-task-node{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:5px;text-align:left;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;transition:border-color .15s,background .15s;outline:none}
.dsh-task-node span{display:flex;align-items:center;gap:6px;font:11px/1.2 system-ui;color:var(--dsw-alias-label-secondary)}.dsh-task-node i{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}.dsh-task-node strong{font:500 12px/1.4 system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}
.dsh-task-node small{font-size:11px;line-height:1.3;color:var(--dsw-alias-label-tertiary)}.dsh-task-node[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}.dsh-task-node:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-task-node:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:2px}
.dsh-task-node[data-status=passed] i{background:var(--dsw-alias-state-success-primary)}.dsh-task-node[data-status=running] i,.dsh-task-node[data-status=reviewing] i{background:var(--dsw-alias-brand-primary)}.dsh-task-node[data-status=awaiting-user] i,.dsh-task-node[data-status=needs-revision] i{background:var(--dsw-alias-state-warn-primary)}
.dsh-task-node-tooltip{position:fixed;z-index:30;width:min(320px,calc(100vw - 24px));max-height:260px;overflow:auto;box-sizing:border-box;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-elevation-panel);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:12px/1.6 system-ui;overflow-wrap:anywhere}.dsh-task-node-tooltip strong{display:block;font-weight:600}.dsh-task-node-tooltip small{display:block;color:var(--dsw-alias-label-secondary);margin-top:4px}.dsh-task-node-tooltip p{white-space:pre-wrap;margin:8px 0}.dsh-task-node-tooltip ul{padding-left:16px;margin:8px 0 0}.dsh-task-node-tooltip li+li{margin-top:6px}
`
