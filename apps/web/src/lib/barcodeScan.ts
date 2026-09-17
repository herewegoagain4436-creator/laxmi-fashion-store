import type { Product, ProductSize } from '../types'
import { normalizeColour } from './variants'

export type BarcodeHit = {
  product: Product
  variant?: ProductSize
}

const INTER_KEY_MS = 80
const MIN_LEN = 3

/** Play a short success/error beep via Web Audio (no asset file). */
export function playScanBeep(kind: 'ok' | 'err' = 'ok') {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = kind === 'ok' ? 880 : 220
    g.gain.value = 0.08
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'ok' ? 0.12 : 0.22))
    o.stop(ctx.currentTime + (kind === 'ok' ? 0.13 : 0.23))
    void ctx.resume()
    setTimeout(() => void ctx.close(), 400)
  } catch {
    /* ignore */
  }
}

export function findByBarcode(products: Product[], rawCode: string): BarcodeHit[] {
  const code = rawCode.trim()
  if (!code) return []
  const lower = code.toLowerCase()
  const hits: BarcodeHit[] = []
  for (const p of products) {
    if (p.deletedAt) continue
    if (p.type === 'garment') {
      for (const v of p.sizes || []) {
        if ((v.barcode || '').trim().toLowerCase() === lower) {
          hits.push({ product: p, variant: v })
        }
      }
    } else {
      // Non-garment: treat product SKU or a synthetic size barcode as match
      if (p.sku.trim().toLowerCase() === lower) {
        hits.push({ product: p })
      }
      const vHit = (p.sizes || []).find((v) => (v.barcode || '').trim().toLowerCase() === lower)
      if (vHit) hits.push({ product: p, variant: vHit })
    }
  }
  return hits
}

/**
 * Document-level keyboard-wedge listener.
 * Rapid key bursts ending in Enter are treated as scans.
 * Slow typing inside editable fields is left alone.
 */
export function attachHidScanListener(opts: {
  onScan: (code: string) => void
  /** Return true to ignore (e.g. modal open that shouldn't scan). */
  shouldIgnore?: () => boolean
}): () => void {
  let buf = ''
  let lastTs = 0
  let rapid = false

  function isEditableTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false
    if (t.dataset.scanCapture === '1') return false
    const tag = t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (t.isContentEditable) return true
    return Boolean(t.closest('[contenteditable="true"]'))
  }

  function onKeyDown(e: KeyboardEvent) {
    if (opts.shouldIgnore?.()) return
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const now = Date.now()
    const gap = now - lastTs
    lastTs = now

    if (gap > INTER_KEY_MS) {
      buf = ''
      rapid = false
    } else if (buf.length >= 1) {
      rapid = true
    }

    if (e.key === 'Enter') {
      if (buf.length >= MIN_LEN && (rapid || buf.length >= 8)) {
        e.preventDefault()
        e.stopPropagation()
        const code = buf
        buf = ''
        rapid = false
        opts.onScan(code)
      } else {
        buf = ''
        rapid = false
      }
      return
    }

    if (e.key.length !== 1) return

    // Human typing in qty/cash/etc. — don't accumulate unless already in a rapid burst
    if (isEditableTarget(e.target) && !rapid && buf.length === 0) {
      return
    }

    // Once a rapid scan starts while focused in a field, swallow keys so they don't pollute inputs
    if (rapid || (!isEditableTarget(e.target) && gap <= INTER_KEY_MS)) {
      if (rapid) {
        e.preventDefault()
      }
    }

    buf += e.key
    if (buf.length >= MIN_LEN && gap <= INTER_KEY_MS) rapid = true
  }

  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}

export function cartLineKey(
  productId: string,
  colour: string | undefined,
  size: string | undefined,
  unit: string,
) {
  return `${productId}-${normalizeColour(colour)}-${size || ''}-${unit}-sale`
}
