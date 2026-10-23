#!/usr/bin/env node
// Runs the LOCAL photo store for development: versitygw (S3-compatible,
// Apache-2.0, `brew install versitygw`) keeping photos as plain files in a
// folder on this Mac, and makes sure the bucket exists.
//
//   npm run storage:local        # leave it running; Ctrl+C stops it
//
// Reads from .env.local (never printed): S3_ENDPOINT (must be on this
// computer, e.g. http://127.0.0.1:7070), S3_BUCKET, S3_ACCESS_KEY_ID,
// S3_SECRET_ACCESS_KEY, and S3_LOCAL_DIR (the folder for photos; default
// ~/ReturnlyDev/photos, outside the repository so photos are never committed).
// Only synthetic test photos belong here.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { makeStore, storeConfigFromEnv } from '../src/lib/storage/s3.ts'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

let cfg
try {
  cfg = storeConfigFromEnv()
} catch (e) {
  fail(`${e.message} Add the photo settings to .env.local first.`)
}
const endpoint = new URL(cfg.endpoint)
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) fail('S3_ENDPOINT must be on this computer (127.0.0.1) for the local store.')
const port = endpoint.port || '7070'

const dir = resolve(process.env.S3_LOCAL_DIR || join(homedir(), 'ReturnlyDev', 'photos'))
if (dir === ROOT || dir.startsWith(ROOT + '/')) fail('S3_LOCAL_DIR must be outside the repository, so photos can never be committed.')

const which = spawnSync('versitygw', ['--version'], { encoding: 'utf8' })
if (which.error) fail('versitygw is not installed. Run: brew install versitygw')
console.log(`• versitygw ${(which.stdout || which.stderr).trim().split('\n')[0]}`)

// Only listen on this computer: other devices on the Wi-Fi never talk to the
// store directly (the app serves photos), so it must not be reachable from them.
const help = spawnSync('versitygw', ['--help'], { encoding: 'utf8' })
const portArgs = /--port\b/.test(`${help.stdout}${help.stderr}`) ? ['--port', `127.0.0.1:${port}`] : []
if (!portArgs.length) console.log('  ! this versitygw has no --port option; using its default address')

mkdirSync(dir, { recursive: true, mode: 0o700 })
console.log(`• photos folder: ${dir}`)

const child = spawn('versitygw', [...portArgs, 'posix', dir], {
  env: { ...process.env, ROOT_ACCESS_KEY: cfg.accessKeyId, ROOT_SECRET_KEY: cfg.secretAccessKey },
  stdio: ['ignore', 'inherit', 'inherit'],
})
child.on('exit', (code) => {
  console.log(`\nversitygw stopped (exit ${code ?? 0}).`)
  process.exit(code ?? 0)
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))

// Wait until it answers, then make sure the bucket exists.
const store = makeStore(cfg)
for (let i = 0; i < 30; i++) {
  try {
    const r = await store.ensureBucket()
    console.log(`✓ bucket "${cfg.bucket}" ${r === 'created' ? 'created' : 'ready'} at ${cfg.endpoint}`)
    console.log('  Leave this running while you test; press Ctrl+C to stop it.\n')
    break
  } catch (e) {
    if (i === 29) {
      child.kill('SIGTERM')
      fail(`The photo store did not start: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}
if (!existsSync(dir)) fail('The photos folder disappeared.')
