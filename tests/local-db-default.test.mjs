// npm run db:local:setup finds the local server from .env.local when
// LOCAL_PG_URL is not set (e.g. Postgres.app on 5433 next to Homebrew on 5432).
import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultAdminUrl } from '../scripts/local-db-setup.mjs'

test('uses the host and port of DATABASE_URL in .env.local', () => {
  assert.equal(defaultAdminUrl('X=1\nDATABASE_URL=postgresql://app_user@localhost:5433/returnly_dev\n'), 'postgresql://localhost:5433/postgres')
  assert.equal(defaultAdminUrl('DATABASE_URL="postgresql://app_user@127.0.0.1/returnly_dev"'), 'postgresql://127.0.0.1:5432/postgres')
})

test('falls back to localhost:5432, and never to a remote server', () => {
  assert.equal(defaultAdminUrl(''), 'postgresql://localhost:5432/postgres')
  assert.equal(defaultAdminUrl(undefined), 'postgresql://localhost:5432/postgres')
  assert.equal(defaultAdminUrl('DATABASE_URL=postgresql://app_user:x@db.example.com:5432/returnly'), 'postgresql://localhost:5432/postgres')
  assert.equal(defaultAdminUrl('DATABASE_URL=not a url'), 'postgresql://localhost:5432/postgres')
})
