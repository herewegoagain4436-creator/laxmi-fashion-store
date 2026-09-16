import { DEFAULT_COLOUR, type ProductSize } from '../types'

export function normalizeColour(c?: string | null) {
  const v = (c || '').trim()
  return v || DEFAULT_COLOUR
}

export function variantKey(colour: string, size: string) {
  return `${normalizeColour(colour)}::${size}`
}

export function makeVariantId(productId: string, colour: string, size: string) {
  const c = normalizeColour(colour).replace(/\s+/g, '-')
  const s = size.replace(/\s+/g, '-')
  return `${productId}-${c}-${s}`
}

export function makeVariantBarcode(productSku: string, colour: string, size: string) {
  const sku = (productSku || 'SKU').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
  const c = normalizeColour(colour).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'DEF'
  const s = size.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'FS'
  return `${sku}-${c}-${s}`
}

export function normalizeVariant(raw: Partial<ProductSize> & { productId: string; size: string }): ProductSize {
  const colour = normalizeColour(raw.colour)
  const size = String(raw.size || 'Free size')
  const id = raw.id || makeVariantId(raw.productId, colour, size)
  return {
    id,
    productId: raw.productId,
    size,
    colour,
    quantity: Number(raw.quantity) || 0,
    barcode: raw.barcode ?? null,
    variantSku: raw.variantSku ?? null,
  }
}

export function coloursOf(sizes: ProductSize[]): string[] {
  const set = new Set<string>()
  for (const s of sizes) set.add(normalizeColour(s.colour))
  return [...set].sort((a, b) => {
    if (a === DEFAULT_COLOUR) return -1
    if (b === DEFAULT_COLOUR) return 1
    return a.localeCompare(b)
  })
}

export function sizesForColour(sizes: ProductSize[], colour: string): ProductSize[] {
  const c = normalizeColour(colour)
  return sizes.filter((s) => normalizeColour(s.colour) === c)
}

export function findVariant(
  sizes: ProductSize[] | undefined,
  colour: string | undefined | null,
  size: string | undefined | null,
) {
  if (!sizes?.length) return undefined
  const c = normalizeColour(colour)
  const sz = size || ''
  return sizes.find((s) => normalizeColour(s.colour) === c && s.size === sz)
}

/** Build colour × size matrix rows from colour list + size list (qty 0). */
export function buildMatrix(
  productId: string,
  productSku: string,
  colours: string[],
  sizes: string[],
  qtyMap?: Record<string, number>,
): ProductSize[] {
  const out: ProductSize[] = []
  const cols = colours.length ? colours.map(normalizeColour) : [DEFAULT_COLOUR]
  const szs = sizes.length ? sizes : ['Free size']
  for (const colour of cols) {
    for (const size of szs) {
      const key = variantKey(colour, size)
      out.push(
        normalizeVariant({
          productId,
          colour,
          size,
          quantity: qtyMap?.[key] ?? 0,
          barcode: makeVariantBarcode(productSku, colour, size),
          variantSku: `${productSku}-${normalizeColour(colour).slice(0, 4)}-${size}`.toUpperCase(),
        }),
      )
    }
  }
  return out
}
