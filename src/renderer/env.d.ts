/// <reference types="vite/client" />

import type { HockeyApi } from '../preload'

declare global {
  interface Window {
    hockey: HockeyApi
  }
}
