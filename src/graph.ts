/** Dependency scheduling and attempt invalidation over durable task snapshots. */
import type { TaskSnapshot, TaskStage, NodeRun } from './state.ts'

export function dependencies(stages: readonly TaskStage[], index: number): readonly string[] {
  return stages[index]?.dependsOn ?? (index === 0 ? [] : [stages[index - 1]!.id])
}

export function validateGraph(stages: readonly TaskStage[]): void {
  const ids = new Set(stages.map(stage => stage.id))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (index: number) => {
    const id = stages[index]!.id
    if (visiting.has(id)) throw new Error(`dependency cycle at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    const deps = dependencies(stages, index)
    if (new Set(deps).size !== deps.length) throw new Error(`duplicate dependency at ${id}`)
    for (const dependency of deps) {
      if (!ids.has(dependency)) throw new Error(`unknown dependency ${dependency}`)
      visit(stages.findIndex(stage => stage.id === dependency))
    }
    visiting.delete(id)
    visited.add(id)
  }
  stages.forEach((_stage, index) => visit(index))
}

/** Legacy stages retain their adjacent dependencies and accepted prefix. */
export function runsOf(task: TaskSnapshot): NodeRun[] {
  return task.nodeRuns ?? task.stages.map((stage, index) => ({ id: stage.id, attempt: 1,
    status: index < task.stageIndex ? 'passed' : 'pending' }))
}

export function readyNodes(task: TaskSnapshot): string[] {
  const runs = runsOf(task)
  return task.stages.filter((stage, index) => {
    const run = runs.find(item => item.id === stage.id)
    return run !== undefined && ['pending', 'needs-revision'].includes(run.status)
      && dependencies(task.stages, index).every(id => runs.find(item => item.id === id)?.status === 'passed')
  }).map(stage => stage.id)
}

export function acceptedNodes(task: TaskSnapshot): string[] {
  return runsOf(task).filter(run => run.status === 'passed').map(run => run.id)
}

/** Keep the old display pointer as a derived selection, never an accepted count. */
export function withRuns(task: TaskSnapshot, runs: NodeRun[]): TaskSnapshot {
  const next = { ...task, nodeRuns: runs }
  const current = runs.find(run => ['running', 'reviewing', 'awaiting-user'].includes(run.status))?.id
    ?? readyNodes(next)[0]
  return { ...next, stageIndex: current === undefined ? task.stages.length : task.stages.findIndex(stage => stage.id === current) }
}

export function beginNode(task: TaskSnapshot, id: string, sessionId: string): TaskSnapshot {
  if (!readyNodes(task).includes(id)) throw new Error(`node ${id} is not ready`)
  return withRuns(task, runsOf(task).map(run => run.id !== id ? run : {
    ...run, status: 'running', sessionId, startedAt: new Date().toISOString(),
  }))
}

export function reviewNode(task: TaskSnapshot, id: string, attempt: number | undefined): TaskSnapshot {
  const run = runsOf(task).find(item => item.id === id)
  if (run === undefined || (attempt ?? 1) !== run.attempt) throw new Error('node attempt is stale; read task_status')
  if (!readyNodes(task).includes(id) && run.status !== 'running') throw new Error(`node ${id} is not ready for review`)
  return withRuns(task, runsOf(task).map(item => item.id === id ? { ...item, status: 'reviewing' } : item))
}

export function finishNode(task: TaskSnapshot, id: string, verdict: 'pass' | 'revise' | 'needs-user', reviewSeq: number): TaskSnapshot {
  return withRuns(task, runsOf(task).map(run => run.id !== id ? run : { ...run,
    status: verdict === 'pass' ? 'passed' : verdict === 'revise' ? 'needs-revision' : 'awaiting-user',
    reviewSeq, finishedAt: new Date().toISOString(),
  }))
}

/** Rework invalidates accepted descendants and advances all affected attempt IDs. */
export function reworkNode(task: TaskSnapshot, id: string): TaskSnapshot {
  if (!task.stages.some(stage => stage.id === id)) throw new Error(`unknown node ${id}`)
  const affected = new Set([id])
  for (let changed = true; changed;) {
    changed = false
    task.stages.forEach((stage, index) => {
      if (!affected.has(stage.id) && dependencies(task.stages, index).some(dep => affected.has(dep))) {
        affected.add(stage.id); changed = true
      }
    })
  }
  return withRuns(task, runsOf(task).map(run => affected.has(run.id)
    ? { id: run.id, attempt: run.attempt + 1, status: 'pending' } : run))
}
