import type {
  Category,
  CategoryPricingRules,
  PricingSettings,
  ProductType,
} from '../types'
import { DEFAULT_CATEGORY_IDS } from '../types'

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

export const BASE_TYPE_LABELS: Record<ProductType, string> = {
  garment: 'Ready-made / Garment',
  saree: 'Saree',
  fabric: 'Than / Fabric',
}

/** Seed definitions for the three default categories. */
export function defaultSeedCategories(now = new Date().toISOString()): Category[] {
  return [
    {
      id: DEFAULT_CATEGORY_IDS.garment,
      name: 'Ready-made / Garment',
      slug: 'ready-made-garment',
      baseType: 'garment',
      ...DEFAULT_CATEGORY_RULES,
      sortOrder: 10,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: DEFAULT_CATEGORY_IDS.saree,
      name: 'Saree',
      slug: 'saree',
      baseType: 'saree',
      ...DEFAULT_CATEGORY_RULES,
      sortOrder: 20,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: DEFAULT_CATEGORY_IDS.fabric,
      name: 'Than / Fabric',
      slug: 'than-fabric',
      baseType: 'fabric',
      ...DEFAULT_CATEGORY_RULES,
      sortOrder: 30,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ]
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
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

export function rulesFromCategory(cat: Category | null | undefined): CategoryPricingRules {
  if (!cat) return { ...DEFAULT_CATEGORY_RULES }
  return {
    wholesaleMarkupPct: Number(cat.wholesaleMarkupPct ?? DEFAULT_CATEGORY_RULES.wholesaleMarkupPct),
    mrpMarkupPct: Number(cat.mrpMarkupPct ?? DEFAULT_CATEGORY_RULES.mrpMarkupPct),
    saleDiscountFromMrpPct: Number(
      cat.saleDiscountFromMrpPct ?? DEFAULT_CATEGORY_RULES.saleDiscountFromMrpPct,
    ),
  }
}

export function rulesForType(settings: PricingSettings | null | undefined, type: ProductType): CategoryPricingRules {
  const s = normalizePricingSettings(settings)
  return s[type] || DEFAULT_CATEGORY_RULES
}

/** Normalize a category row (migration / snapshot). */
export function normalizeCategory(raw: Partial<Category> & { id: string }): Category {
  const baseType = (raw.baseType || 'garment') as ProductType
  const now = new Date().toISOString()
  return {
    id: raw.id,
    name: String(raw.name || 'Category'),
    slug: raw.slug ?? slugify(String(raw.name || raw.id)),
    baseType,
    wholesaleMarkupPct: Number(raw.wholesaleMarkupPct ?? DEFAULT_CATEGORY_RULES.wholesaleMarkupPct),
    mrpMarkupPct: Number(raw.mrpMarkupPct ?? DEFAULT_CATEGORY_RULES.mrpMarkupPct),
    saleDiscountFromMrpPct: Number(
      raw.saleDiscountFromMrpPct ?? DEFAULT_CATEGORY_RULES.saleDiscountFromMrpPct,
    ),
    sortOrder: Number(raw.sortOrder ?? 100),
    active: raw.active !== false && !raw.deletedAt,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    deletedAt: raw.deletedAt ?? null,
  }
}

/** Compute wholesale, MRP, and sale from purchase cost using category or type rules. */
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

export function defaultCategoryIdForType(type: ProductType): string {
  return DEFAULT_CATEGORY_IDS[type] || DEFAULT_CATEGORY_IDS.garment
}
