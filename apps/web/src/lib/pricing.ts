import type { CategoryPricingRules, PricingSettings, ProductType } from '../types'

export const DEFAULT_CATEGORY_RULES: CategoryPricingRules = {
  wholesaleMarkupPct: 20,
  mrpMarkupPct: 100,
  saleDiscountFromMrpPct: 20,
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  garment: { ...DEFAULT_CATEGORY_RULES },
  saree: { ...DEFAULT_CATEGORY_RULES },
  fabric: { ...DEFAULT_CATEGORY_RULES },
}

export function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function normalizePricingSettings(raw?: Partial<PricingSettings> | null): PricingSettings {
  const merge = (c?: Partial<CategoryPricingRules> | null): CategoryPricingRules => ({
    wholesaleMarkupPct: Number(c?.wholesaleMarkupPct ?? DEFAULT_CATEGORY_RULES.wholesaleMarkupPct),
    mrpMarkupPct: Number(c?.mrpMarkupPct ?? DEFAULT_CATEGORY_RULES.mrpMarkupPct),
    saleDiscountFromMrpPct: Number(c?.saleDiscountFromMrpPct ?? DEFAULT_CATEGORY_RULES.saleDiscountFromMrpPct),
  })
  return {
    garment: merge(raw?.garment),
    saree: merge(raw?.saree),
    fabric: merge(raw?.fabric),
  }
}

export function rulesForType(settings: PricingSettings | null | undefined, type: ProductType): CategoryPricingRules {
  const s = normalizePricingSettings(settings)
  return s[type] || DEFAULT_CATEGORY_RULES
}

/** Compute wholesale, MRP, and sale from purchase cost using category rules. */
export function computePricesFromPurchase(
  purchase: number,
  settings: PricingSettings | CategoryPricingRules | null | undefined,
  type?: ProductType,
): { wholesalePrice: number; mrp: number; salePrice: number } {
  const cost = Number(purchase) || 0
  let rules: CategoryPricingRules
  if (settings && 'garment' in settings) {
    rules = rulesForType(settings as PricingSettings, type || 'garment')
  } else if (settings && 'wholesaleMarkupPct' in settings) {
    rules = {
      wholesaleMarkupPct: Number((settings as CategoryPricingRules).wholesaleMarkupPct),
      mrpMarkupPct: Number((settings as CategoryPricingRules).mrpMarkupPct),
      saleDiscountFromMrpPct: Number((settings as CategoryPricingRules).saleDiscountFromMrpPct),
    }
  } else {
    rules = DEFAULT_CATEGORY_RULES
  }
  const wholesalePrice = round2(cost * (1 + rules.wholesaleMarkupPct / 100))
  const mrp = round2(cost * (1 + rules.mrpMarkupPct / 100))
  const salePrice = round2(mrp * (1 - rules.saleDiscountFromMrpPct / 100))
  return { wholesalePrice, mrp, salePrice }
}

/** Fill missing four-price fields on a product-like object (migration / normalize). */
export function normalizeProductPrices<T extends Record<string, unknown>>(p: T): T & {
  purchasePrice: number
  costPrice: number
  wholesalePrice: number
  mrp: number
  salePrice: number
  sellingPrice: number
} {
  const cost = Number(p.purchasePrice ?? p.costPrice ?? 0) || 0
  const sale = Number(p.salePrice ?? p.sellingPrice ?? 0) || 0
  const wholesale =
    p.wholesalePrice != null && Number.isFinite(Number(p.wholesalePrice))
      ? Number(p.wholesalePrice)
      : round2(cost * 1.2)
  const mrp =
    p.mrp != null && Number.isFinite(Number(p.mrp)) ? Number(p.mrp) : round2(cost * 2)
  return {
    ...p,
    purchasePrice: cost,
    costPrice: cost,
    wholesalePrice: wholesale,
    mrp,
    salePrice: sale,
    sellingPrice: sale,
  }
}

export const CATEGORY_LABELS: Record<ProductType, string> = {
  garment: 'Garment / ready-made',
  saree: 'Saree',
  fabric: 'Fabric / than',
}
