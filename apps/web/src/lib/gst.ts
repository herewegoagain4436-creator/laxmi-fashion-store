import { DEFAULT_GST_SETTINGS, type GstSettings, type ProductType } from '../types'

export function normalizeGstSettings(raw?: Partial<GstSettings> | null): GstSettings {
  return {
    apparelThreshold: Number(raw?.apparelThreshold ?? DEFAULT_GST_SETTINGS.apparelThreshold) || 2500,
    apparelLowRate: Number(raw?.apparelLowRate ?? DEFAULT_GST_SETTINGS.apparelLowRate) || 5,
    apparelHighRate: Number(raw?.apparelHighRate ?? DEFAULT_GST_SETTINGS.apparelHighRate) || 18,
    fabricRate: Number(raw?.fabricRate ?? DEFAULT_GST_SETTINGS.fabricRate) || 5,
  }
}

export function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Inclusive sale price → taxable (ex-GST) for a known rate.
 * taxable = inclusive / (1 + rate/100)
 */
export function reverseCalcTaxable(inclusive: number, ratePct: number) {
  const r = Number(ratePct) || 0
  if (r <= 0) return round2(inclusive)
  return round2(inclusive / (1 + r / 100))
}

/**
 * Pick apparel GST rate from **pre-GST taxable value per piece**.
 * If inclusive price is given, we iterate: try low rate first; if taxable > threshold use high.
 */
export function apparelRateForInclusiveUnit(
  inclusiveUnit: number,
  settings: GstSettings = DEFAULT_GST_SETTINGS,
): number {
  const s = normalizeGstSettings(settings)
  const lowTaxable = reverseCalcTaxable(inclusiveUnit, s.apparelLowRate)
  if (lowTaxable <= s.apparelThreshold + 1e-9) return s.apparelLowRate
  return s.apparelHighRate
}

export function rateForLine(opts: {
  productType: ProductType
  /** Inclusive unit rate (after line discount allocation if any). */
  inclusiveUnit: number
  settings?: GstSettings | null
}): number {
  const s = normalizeGstSettings(opts.settings)
  if (opts.productType === 'fabric') return s.fabricRate
  // saree + garment: apparel slab on per-piece taxable
  return apparelRateForInclusiveUnit(opts.inclusiveUnit, s)
}

export type GstLineBreakdown = {
  inclusiveTotal: number
  gstRate: number
  taxableAmount: number
  gstAmount: number
  cgstAmount: number
  sgstAmount: number
}

/**
 * Per-line GST after discount.
 * `inclusiveTotal` is the customer-facing line total (GST-inclusive).
 * For return lines pass negative inclusiveTotal.
 */
export function breakdownInclusiveLine(
  inclusiveTotal: number,
  productType: ProductType,
  quantity: number,
  settings?: GstSettings | null,
): GstLineBreakdown {
  const qty = Math.abs(Number(quantity) || 1) || 1
  const sign = inclusiveTotal < 0 ? -1 : 1
  const absTotal = Math.abs(inclusiveTotal)
  const unitIncl = absTotal / qty
  const gstRate = rateForLine({ productType, inclusiveUnit: unitIncl, settings })
  const taxableAmount = sign * reverseCalcTaxable(absTotal, gstRate)
  const gstAmount = sign * round2(absTotal - Math.abs(taxableAmount))
  const half = round2(Math.abs(gstAmount) / 2) * sign
  return {
    inclusiveTotal: round2(inclusiveTotal),
    gstRate,
    taxableAmount: round2(taxableAmount),
    gstAmount: round2(gstAmount),
    cgstAmount: half,
    sgstAmount: round2(gstAmount - half),
  }
}

/** Allocate bill-level discount across positive sale lines proportionally, then GST each. */
export function allocateDiscountAndGst(
  lines: Array<{
    key: string
    productType: ProductType
    lineTotal: number
    quantity: number
    lineKind?: 'sale' | 'return'
  }>,
  billDiscount: number,
  settings?: GstSettings | null,
): Map<string, GstLineBreakdown> {
  const map = new Map<string, GstLineBreakdown>()
  const saleLines = lines.filter((l) => (l.lineKind || 'sale') === 'sale' && l.lineTotal > 0)
  const saleSub = saleLines.reduce((a, l) => a + l.lineTotal, 0)
  const disc = Math.max(0, Number(billDiscount) || 0)
  for (const l of lines) {
    let inclusive = l.lineTotal
    if ((l.lineKind || 'sale') === 'sale' && saleSub > 0 && disc > 0 && l.lineTotal > 0) {
      inclusive = round2(l.lineTotal - (l.lineTotal / saleSub) * disc)
    }
    map.set(l.key, breakdownInclusiveLine(inclusive, l.productType, l.quantity, settings))
  }
  return map
}
