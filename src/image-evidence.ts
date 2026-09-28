/** Read only immutable images already admitted to the bound Session prefix. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ReviewerModel } from './reviewer.ts'

export function installImageEvidence(ctx: Context, owner: Context, main: Agent, cutoff: number,
  afterSeq: number, observed: Set<number>, inspected: Set<number>, model: ReviewerModel, admit: () => void = () => {}): void {
  ctx.tools.register(defineTool({
    name: 'read_task_image',
    description: 'Inspect an immutable native image from an already-read main Session event. Use the zero-based image index. No filesystem path or arbitrary attachment ID is accepted; fresh evidence must belong to this task/node attempt.',
    parameters: { seq: { type: 'integer', required: true }, image_index: { type: 'integer', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        seq: { type: 'integer', required: true }, attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
        bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
      } },
      render: (_args, value) => [
        { type: 'text', text: `Image evidence from main Session seq ${value.seq}; immutable attachment ${value.attachmentId}.` },
        { type: 'image', attachment: { attachmentId: AttachmentId(value.attachmentId), mediaType: value.mediaType,
          bytes: value.bytes, width: value.width, height: value.height } },
      ],
    },
    async execute(args, exec) {
      admit()
      if (!observed.has(args.seq) || args.seq < afterSeq || args.seq > cutoff) throw new Error('image must be read from this task/node attempt inside the review cutoff')
      const info = await owner.llm.resolveModelInfo(model.provider, model.model, exec.signal)
      if (!info.inputModalities?.includes('image')) throw new Error('review model does not declare image input; return needs-user for required visual judgments')
      const reader = await owner.sessionPersistence.open(main.id, 'read')
      try {
        const event = (await reader.read(args.seq, 1)).events[0]
        const content = event?.seq !== args.seq ? [] : event.type === 'user/message' ? event.data.content
          : event.type === 'tool/result' ? event.data.message.content : []
        const images = content.filter(block => block.type === 'image')
        const image = images[args.image_index]
        if (image === undefined || image.type !== 'image') throw new Error('no image at that event/index')
        const attachments = owner.get('attachments')
        if (attachments === undefined) throw new Error('native attachment storage is unavailable')
        await attachments.readImage(image.attachment, exec.signal)
        inspected.add(args.seq)
        const ref = image.attachment
        return { seq: args.seq, attachmentId: ref.attachmentId, mediaType: ref.mediaType,
          bytes: ref.bytes, width: ref.width, height: ref.height }
      } finally { await reader.close() }
    },
  }))
}
