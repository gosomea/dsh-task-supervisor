/** Compact Supervisor navigation and proposal actions use the native locale service. */
export const zh = {
  chat: '对话', details: '详情', more: '更多任务操作', history: '历史任务', back: '返回当前任务',
  help: '使用帮助', close: '关闭', reading: '正在读取…', ended: '已结束的任务',
  waiting: '等待输入目标', idle: '询问进度、修改目标，或描述新任务',
  helpText: '这里可以跟进进度、修改任务或建立新任务。普通问询不会打断执行。输入 /task <目标> 建立任务，/compact 压缩对话。',
  draft: '任务草案', requirements: '查看完整要求', questions: '待确认', create: '建立任务',
  created: '已建立任务', older: '此前草案', current: '查看当前草案', currentDraft: '当前草案',
  blocked: '当前任务结束后可建立', unresolved: '请在对话中补充待确认内容',
}
export type SupervisorKey = keyof typeof zh
export type SupervisorTranslate = (key: SupervisorKey) => string
export const en: Record<SupervisorKey, string> = {
  chat: 'Chat', details: 'Details', more: 'More task actions', history: 'Task history', back: 'Back to current task',
  help: 'Help', close: 'Close', reading: 'Loading…', ended: 'Finished tasks',
  waiting: 'Waiting for an objective', idle: 'Ask about progress, revise an objective, or describe a new task',
  helpText: 'Follow progress, revise tasks, or create a task here. Questions do not interrupt execution. Use /task <objective> to create a task and /compact to compact this conversation.',
  draft: 'Task draft', requirements: 'Full requirements', questions: 'Open questions', create: 'Create task',
  created: 'Task created', older: 'Earlier draft', current: 'View current draft', currentDraft: 'Current draft',
  blocked: 'Available after the current task ends', unresolved: 'Answer the open questions in chat',
}
