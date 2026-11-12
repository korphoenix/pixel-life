import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { createError, getHeader, type H3Event } from 'h3'

export const maxUploadBytes = 6 * 1024 * 1024
export async function readLimitedUpload(event: H3Event) {
  const contentType = getHeader(event, 'content-type') ?? ''
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw createError({ statusCode: 415, data: { message: '請使用照片上傳表單。' } })
  }
  const declared = getHeader(event, 'content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxUploadBytes)) {
    throw createError({ statusCode: 413, data: { message: '上傳內容過大，照片最多 5 MB。' } })
  }
  const stream = Readable.toWeb(event.node.req)
  if (!stream) throw createError({ statusCode: 400, data: { message: '缺少上傳內容。' } })
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const timer = setTimeout(() => { void reader.cancel().catch(() => undefined) }, 30_000)
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxUploadBytes) {
        void reader.cancel().catch(() => undefined)
        throw createError({ statusCode: 413, data: { message: '上傳內容過大，照片最多 5 MB。' } })
      }
      chunks.push(value)
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData()
    const allowed = new Set(['purpose', 'photo', 'caption', 'revision', 'occurredOn'])
    const seen = new Set<string>()
    const parts = []
    for (const [name, value] of form.entries()) {
      if (!allowed.has(name) || seen.has(name) || (name === 'photo') !== (typeof value !== 'string')) {
        throw createError({ statusCode: 400, data: { message: '上傳欄位不正確。' } })
      }
      seen.add(name)
      if (typeof value === 'string' && Buffer.byteLength(value) > 4096) throw new Error('field too long')
      parts.push({ name, data: typeof value === 'string' ? Buffer.from(value) : Buffer.from(await value.arrayBuffer()), filename: typeof value === 'string' ? undefined : value.name })
    }
    return parts
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({ statusCode: 400, data: { message: '無法讀取照片，請重新選取後上傳。' } })
  } finally { clearTimeout(timer); reader.releaseLock() }
}
