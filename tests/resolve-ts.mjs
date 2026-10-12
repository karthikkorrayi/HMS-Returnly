// Lets `node --test` import app modules the way Next.js does:
// "@/…" → src/…, and extensionless relative imports → .ts / .tsx.
// Used by `npm test` (--import ./tests/resolve-ts.mjs).
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath, pathToFileURL } from 'node:url'
      const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)}
      export async function resolve(specifier, context, next) {
        let spec = specifier
        if (spec.startsWith('@/')) spec = SRC + spec.slice(2)
        else if (!(spec.startsWith('./') || spec.startsWith('../'))) return next(specifier, context)
        const base = spec.startsWith('file:') ? spec : new URL(spec, context.parentURL).href
        const path = fileURLToPath(base)
        if (existsSync(path) && !path.endsWith('/')) return next(base, context)
        for (const ext of ['.ts', '.tsx', '/index.ts']) {
          if (existsSync(path + ext)) return next(pathToFileURL(path + ext).href, context)
        }
        return next(specifier, context)
      }
    `),
  import.meta.url
)
