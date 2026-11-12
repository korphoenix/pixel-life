import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createEvent } from 'h3'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { readLimitedUpload, maxUploadBytes } from '../server/utils/upload.ts'
import securityHeaders from '../server/middleware/security.ts'

function event(body, headers = {}, url = '/api/generate') {
  const req = Readable.from(body.length ? body : [])
  req.headers = { host: 'localhost:3000', ...headers }; req.method = 'POST'; req.url = url
  const values = {}
  const res = { setHeader(name, value) { values[name.toLowerCase()] = value }, getHeader(name) { return values[name.toLowerCase()] } }
  return { h3: createEvent(req, res), values }
}
async function multipart(extra) {
  const form = new FormData()
  form.append('photo', new Blob([new Uint8Array([255,216,255])], { type: 'image/jpeg' }), 'self.jpg')
  form.append('purpose', 'avatar')
  extra?.(form)
  const request = new Request('http://localhost', { method: 'POST', body: form })
  return { bytes: new Uint8Array(await request.arrayBuffer()), type: request.headers.get('content-type') }
}
test('multipart upload caps actual streamed bytes and rejects ambiguous fields', async () => {
  const valid = await multipart()
  const parts = await readLimitedUpload(event([valid.bytes], { 'content-type': valid.type }).h3)
  assert.equal(parts.find(part => part.name === 'photo').filename, 'self.jpg')
  const duplicate = await multipart(form => form.append('purpose', 'life'))
  await assert.rejects(readLimitedUpload(event([duplicate.bytes], { 'content-type': duplicate.type }).h3), error => error.statusCode === 400)
  await assert.rejects(readLimitedUpload(event([], { 'content-type': valid.type, 'content-length': String(maxUploadBytes + 1) }).h3), error => error.statusCode === 413)
  // No Content-Length: the actual stream must still be bounded.
  await assert.rejects(readLimitedUpload(event([new Uint8Array(maxUploadBytes + 1)], { 'content-type': valid.type }).h3), error => error.statusCode === 413)
  await assert.rejects(readLimitedUpload(event([], { 'content-type': 'text/plain' }).h3), error => error.statusCode === 415)
})
test('API rejects cross-site requests and returns non-caching security headers', () => {
  const same = event([], { origin: 'http://localhost:3000' })
  securityHeaders(same.h3)
  assert.equal(same.values['cache-control'], 'no-store, private')
  assert.equal(same.values['x-frame-options'], 'DENY')
  assert.equal(same.values['referrer-policy'], 'no-referrer')
  assert.throws(() => securityHeaders(event([], { origin: 'https://attacker.example' }).h3), error => error.statusCode === 403)
  assert.throws(() => securityHeaders(event([], { 'sec-fetch-site': 'cross-site' }).h3), error => error.statusCode === 403)
})
test('staged scanner blocks forced private files and scans index rather than worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'life-pixel-security-'))
  try {
    await mkdir(join(root,'scripts'))
    await copyFile(new URL('../scripts/security-check.mjs', import.meta.url), join(root,'scripts/security-check.mjs'))
    execFileSync('git',['init','--quiet'], { cwd: root })
    await writeFile(join(root,'safe.txt'), 'a safe initial file')
    execFileSync('git',['add','safe.txt'], { cwd: root })
    const run = () => spawnSync(process.execPath, ['scripts/security-check.mjs','--staged'], { cwd: root, encoding: 'utf8' })
    assert.equal(run().status, 0)
    const fake = 'sk-' + 'a'.repeat(40)
    await writeFile(join(root,'safe.txt'), fake)
    assert.equal(run().status, 0, 'unstaged text must not change staged scan')
    execFileSync('git',['add','safe.txt'], { cwd: root })
    const exposed = run()
    assert.equal(exposed.status, 1)
    assert.ok(!exposed.stderr.includes(fake), 'scanner must never print credentials')
    await writeFile(join(root,'safe.txt'),'safe again'); execFileSync('git',['add','safe.txt'],{cwd:root})
    await writeFile(join(root,'.env'),'LOCAL_VALUE=private')
    execFileSync('git',['add','-f','.env'],{cwd:root})
    assert.equal(run().status, 1, 'force-added .env must be blocked')
  } finally { await rm(root, { recursive:true,force:true }) }
})
