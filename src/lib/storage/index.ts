// The app's photo store, created on first use from the environment (so
// `next build` needs no credentials). Server only.
import 'server-only'
import { makeStore, storeConfigFromEnv, type PhotoStore } from './s3'

const holder = globalThis as typeof globalThis & { __returnlyPhotoStore?: PhotoStore }

export function photoStore(): PhotoStore {
  holder.__returnlyPhotoStore ??= makeStore(storeConfigFromEnv())
  return holder.__returnlyPhotoStore
}
