/** Native DSH flow-row disclosure, with plugin-owned content only. */
import { useState, type ReactNode } from 'react'
import { DisclosureRow, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow className="dsh-task-disclosure" titleClassName="dsh-task-disclosure-title" icon={<IconChevronDownOutlineRegular />} title={title}
    open={open} expandable expandOnRowClick onToggle={() => setOpen(value => !value)}>
    <div className="dsh-task-disclosure-content">{children}</div>
  </DisclosureRow>
}
