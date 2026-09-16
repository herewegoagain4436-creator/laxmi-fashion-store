/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { DesktopBridge } from './lib/appUpdate'

declare global {
  interface Window {
    laxmiDesktop?: DesktopBridge
  }
}

export {}
