import { execFileSync } from 'node:child_process'
try {
  execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  console.log('Local pre-commit credential checks enabled.')
} catch { console.error('Initialize this project with git init, then run npm run security:install again.'); process.exit(1) }
