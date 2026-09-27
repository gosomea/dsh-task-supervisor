/** Dependency layout uses persisted edges; accepted counts never stand in for work percentage. */
import { useMemo } from 'react'
import { dependencies, runsOf } from '../graph.ts'
import type { TaskSnapshot } from '../state.ts'

const WIDTH = 196
const HEIGHT = 102
const GAP_X = 48
const GAP_Y = 28

export function TaskGraph({ task, selected, select, label }: {
  task: TaskSnapshot; selected?: string | undefined; select: (id: string) => void; label: (id: string) => string
}) {
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
      positions.set(stage.id, { x: 12 + column * (WIDTH + GAP_X), y: 12 + row * (HEIGHT + GAP_Y) })
      rows.set(column, row + 1)
    }
    return { positions, width: 24 + (Math.max(0, ...levels.values()) + 1) * (WIDTH + GAP_X) - GAP_X,
      height: 24 + Math.max(1, ...rows.values()) * (HEIGHT + GAP_Y) - GAP_Y }
  }, [task.stages])
  return <div className="dsh-task-graph-scroll" aria-label="任务依赖图，可横向滚动">
    <div className="dsh-task-graph" style={{ width: graph.width, height: graph.height }}>
      <svg width={graph.width} height={graph.height} aria-hidden="true">
        {task.stages.flatMap((stage, i) => dependencies(task.stages, i).map(parent => {
          const a = graph.positions.get(parent)!
          const b = graph.positions.get(stage.id)!
          const x = a.x + WIDTH; const y = a.y + HEIGHT / 2; const endY = b.y + HEIGHT / 2
          return <g key={`${parent}:${stage.id}`}>
            <path d={`M${x} ${y} C${x + GAP_X / 2} ${y},${b.x - GAP_X / 2} ${endY},${b.x} ${endY}`} />
            <path d={`M${b.x - 6} ${endY - 4} L${b.x} ${endY} L${b.x - 6} ${endY + 4}`} />
          </g>
        }))}
      </svg>
      {task.stages.map(stage => {
        const position = graph.positions.get(stage.id)!
        const run = runsOf(task).find(run => run.id === stage.id)
        return <button type="button" key={stage.id} className="dsh-task-node" data-status={run?.status}
          aria-pressed={selected === stage.id} onClick={() => select(stage.id)}
          title={`${stage.id} · ${stage.title}\n${label(stage.id)} · 尝试 ${run?.attempt}\n${stage.description ?? ''}`}
          style={{ left: position.x, top: position.y, width: WIDTH, height: HEIGHT }}>
          <span>{label(stage.id)}</span><strong>{stage.id} · {stage.title}</strong><small>尝试 {run?.attempt}</small>
        </button>
      })}
    </div>
  </div>
}

export const GRAPH_CSS = `
.dsh-task-graph-scroll{max-width:100%;overflow:auto;margin:8px 0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-task-graph{position:relative}.dsh-task-graph svg{position:absolute;inset:0;pointer-events:none}.dsh-task-graph path{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5}
.dsh-task-node{position:absolute;display:flex;flex-direction:column;gap:4px;text-align:left;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-task-node span,.dsh-task-node small{font-size:11px;color:var(--dsw-alias-label-secondary)}.dsh-task-node strong{font-size:12px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dsh-task-node[aria-pressed=true]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsh-task-node:focus-visible{outline:3px solid var(--dsw-alias-brand-primary)}
.dsh-task-node[data-status=passed]{border-color:var(--dsw-alias-state-success-primary)}.dsh-task-node[data-status=running],.dsh-task-node[data-status=reviewing]{border-width:2px;border-color:var(--dsw-alias-brand-primary)}.dsh-task-node[data-status=awaiting-user],.dsh-task-node[data-status=needs-revision]{border-color:var(--dsw-alias-state-error-primary)}
`
