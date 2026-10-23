// A minimal S3 client for the private photo bucket: put, get, delete and
// (for local setup) create the bucket. Works with any S3-compatible store:
// versitygw on a developer's Mac, Railway's bucket in staging/production.
// Requests are signed with AWS Signature V4 (aws4fetch, no other code).
// No Next.js imports, so tests can use it directly.
import { AwsClient } from 'aws4fetch'

export class StorageError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export type StoreConfig = {
  /** e.g. http://127.0.0.1:7070 (versitygw) or the provider's https endpoint. */
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  /** true: http://host/bucket/key (versitygw). false: http://bucket.host/key. */
  pathStyle?: boolean
}

export type PhotoStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  /** null when the object does not exist. */
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>
  delete(key: string): Promise<void>
  ensureBucket(): Promise<'created' | 'exists'>
}

// Keys are always {property_id}/{item_id}/{uuid}.jpg; refuse anything else so a
// bug can never address another object or path.
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/

export function makeStore(cfg: StoreConfig): PhotoStore {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket)) throw new StorageError('Invalid bucket name.')
  const endpoint = new URL(cfg.endpoint)
  const pathStyle = cfg.pathStyle ?? true
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region || 'us-east-1',
    retries: 2,
  })

  const bucketUrl = () => {
    const u = new URL(endpoint)
    if (pathStyle) u.pathname = `/${cfg.bucket}/`
    else u.host = `${cfg.bucket}.${u.host}`
    return u
  }
  const objectUrl = (key: string) => {
    if (!KEY.test(key)) throw new StorageError('Invalid photo key.')
    return new URL(key, bucketUrl())
  }
  const fail = async (what: string, res: Response): Promise<never> => {
    const text = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
    throw new StorageError(`${what} failed (HTTP ${res.status})${text ? ': ' + text : ''}`, res.status)
  }

  return {
    async put(key, body, contentType) {
      const res = await client.fetch(objectUrl(key), {
        method: 'PUT',
        body: body as BodyInit,
        headers: { 'content-type': contentType, 'content-length': String(body.byteLength) },
      })
      if (!res.ok) await fail('Photo upload', res)
    },
    async get(key) {
      const res = await client.fetch(objectUrl(key), { method: 'GET' })
      if (res.status === 404) return null
      if (!res.ok) await fail('Photo download', res)
      return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' }
    },
    async delete(key) {
      const res = await client.fetch(objectUrl(key), { method: 'DELETE' })
      // S3 answers 204 whether or not the object existed.
      if (!res.ok && res.status !== 404) await fail('Photo delete', res)
    },
    async ensureBucket() {
      const head = await client.fetch(bucketUrl(), { method: 'HEAD' })
      if (head.ok) return 'exists'
      if (head.status !== 404) await fail('Bucket check', head)
      const res = await client.fetch(bucketUrl(), { method: 'PUT' })
      if (!res.ok) await fail('Bucket creation', res)
      return 'created'
    },
  }
}

/** Store settings from the environment (server only). Throws if any are missing. */
export function storeConfigFromEnv(env: Record<string, string | undefined> = process.env): StoreConfig {
  const need = (k: string) => {
    const v = env[k]
    if (!v) throw new StorageError(`${k} is not set.`)
    return v
  }
  return {
    endpoint: need('S3_ENDPOINT'),
    bucket: need('S3_BUCKET'),
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    region: env.S3_REGION || 'us-east-1',
    pathStyle: (env.S3_PATH_STYLE ?? 'true') !== 'false',
  }
}
