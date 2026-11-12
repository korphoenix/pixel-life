import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const staged = process.argv.includes('--staged')
const blockedFolders = new Set(['node_modules','.nuxt','.output','.git','.vercel','private-assets','uploads','backups','coverage'])
const prohibited = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|private-assets|uploads|backups|\.nuxt|\.output|node_modules|\.vercel)(?:\/|$)|\.(?:pem|key|p12|pfx|sqlite\w*|db|log)$/i
const exempt = path => path === '.env.example'
const knownSecrets = []
if (existsSync(resolve(root, '.env'))) {
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1].includes('PUBLIC') || !/(?:KEY|SECRET|TOKEN|PASSWORD)/.test(match[1])) continue
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
    if (value.length >= 16) knownSecrets.push(value)
  }
}
const problems = []
const patterns = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]{6,}@/i
]
function inspect(path, bytes) {
  if (prohibited.test(path) && !exempt(path)) { problems.push(`${path}: private/generated file must not be committed`); return }
  const text = bytes.toString('utf8')
  if (patterns.some(pattern => pattern.test(text)) || knownSecrets.some(secret => text.includes(secret))) {
    problems.push(`${path}: possible credential detected (value hidden)`)
  }
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role') problems.push(`${path}: privileged Supabase credential detected (value hidden)`) } catch {}
  }
}
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name)
    const item = lstatSync(path)
    if (item.isSymbolicLink()) continue
    if (item.isDirectory()) { if (!blockedFolders.has(name)) walk(path); continue }
    const local = relative(root, path).replaceAll('\\', '/')
    if ((local === '.env' || local.startsWith('.env.')) && !exempt(local)) continue
    inspect(local, readFileSync(path))
  }
}
if (staged) {
  try {
    const paths = execFileSync('git', ['diff','--cached','--name-only','--diff-filter=ACMR','-z'], { cwd: root, stdio: ['ignore','pipe','pipe'] }).toString().split('\0').filter(Boolean)
    for (const path of paths) inspect(path, execFileSync('git', ['show', `:${path}`], { cwd: root, maxBuffer: 25 * 1024 * 1024, stdio: ['ignore','pipe','pipe'] }))
  } catch { console.error('Staged security scan failed; ensure Git is initialized. No credentials were printed.'); process.exit(1) }
} else {
  walk(root)
  // Also inspect everything already tracked, even if a later .gitignore hides it.
  let paths = []
  try { paths = execFileSync('git', ['ls-files','-z'], { cwd: root, stdio: ['ignore','pipe','pipe'] }).toString().split('\0').filter(Boolean) } catch {}
  for (const path of paths) {
    if (prohibited.test(path) && !exempt(path)) problems.push(`${path}: private/generated file is tracked by Git`)
  }
}
if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1) }
console.log(staged ? 'Staged-file security scan passed.' : 'Source security scan passed. Local credentials and private assets were excluded.')
