import { db } from './db'
import {
  computePricesFromPurchase,
  DEFAULT_PRICING_SETTINGS,
  defaultCategoryIdForType,
  defaultSeedCategories,
  round2,
} from './lib/pricing'
import type { Product, ProductSize, Supplier } from './types'
import { DEFAULT_COLOUR } from './types'
import { makeVariantBarcode } from './lib/variants'

function withFourPrices(cost: number, sale: number, type: Product['type']): Pick<
  Product,
  'purchasePrice' | 'costPrice' | 'wholesalePrice' | 'mrp' | 'salePrice' | 'sellingPrice'
> {
  const derived = computePricesFromPurchase(cost, DEFAULT_PRICING_SETTINGS, type)
  return {
    purchasePrice: cost,
    costPrice: cost,
    wholesalePrice: derived.wholesalePrice,
    mrp: derived.mrp,
    salePrice: sale > 0 ? sale : derived.salePrice,
    sellingPrice: sale > 0 ? sale : derived.salePrice,
  }
}

export async function seedCatalogIfEmpty() {
  const n = await db.products.count()
  if (n > 0) {
    // Ensure categories exist even if products already seeded
    const cn = await db.categories.count()
    if (cn === 0) await db.categories.bulkPut(defaultSeedCategories())
    return
  }
  const t = new Date().toISOString()
  await db.categories.bulkPut(defaultSeedCategories(t))

  const sizes: ProductSize[] = []
  const products: Product[] = []

  function garment(
    id: string,
    sku: string,
    name: string,
    price: number,
    cost: number,
    sizeMap: Record<string, number>,
    low = 4,
  ) {
    products.push({
      id,
      sku,
      name,
      type: 'garment',
      categoryId: defaultCategoryIdForType('garment'),
      unit: 'piece',
      ...withFourPrices(cost, price, 'garment'),
      quantity: 0,
      lowStockThreshold: low,
      fabricSellUnit: null,
      createdAt: t,
      updatedAt: t,
    })
    for (const [size, quantity] of Object.entries(sizeMap)) {
      const colour = DEFAULT_COLOUR
      sizes.push({
        id: `${id}-${colour}-${size}`,
        productId: id,
        size,
        colour,
        quantity,
        barcode: makeVariantBarcode(sku, colour, size),
        variantSku: `${sku}-DEF-${size}`.toUpperCase(),
      })
    }
  }

  garment('p-kurti-cotton', 'G-KURTI-001', 'Cotton Kurti', 450, 280, { S: 12, M: 18, L: 20, XL: 14, XXL: 8 })
  garment('p-palazzo', 'G-PALAZZO-001', 'Ladies Palazzo', 380, 220, { M: 16, L: 18, XL: 12, XXL: 6 })
  garment('p-shirt-men', 'G-SHIRT-001', "Men's Formal Shirt", 550, 340, { S: 8, M: 14, L: 16, XL: 10, XXL: 4 })
  garment('p-nightwear', 'G-NIGHT-001', 'Free Size Nightwear', 280, 160, { 'Free size': 24 })
  garment('p-frock', 'G-FROCK-001', 'Kids Frock', 320, 190, { '22': 6, '24': 10, '26': 10, '28': 8, '32': 4 })

  const pieces: Product[] = [
    ['p-saree-cotton', 'S-COT-001', 'Cotton Saree', 'saree', 650, 420, 40, 5],
    ['p-saree-silk', 'S-SILK-001', 'Silk Saree', 'saree', 1850, 1200, 15, 5],
    ['p-saree-geo', 'S-GEO-001', 'Georgette Saree', 'saree', 890, 560, 25, 5],
    ['p-than-cotton', 'F-COT-001', 'Cotton Than', 'fabric', 85, 52, 120, 15],
    ['p-than-rayon', 'F-RAY-001', 'Rayon Print Fabric', 'fabric', 95, 60, 80, 15],
    ['p-than-geo', 'F-GEO-001', 'Georgette Fabric', 'fabric', 110, 70, 45.5, 15],
  ].map(([id, sku, name, type, price, cost, qty, low]) => {
    const tpe = type as Product['type']
    return {
      id: id as string,
      sku: sku as string,
      name: name as string,
      type: tpe,
      categoryId: defaultCategoryIdForType(tpe),
      unit: tpe === 'fabric' ? ('metre' as const) : ('piece' as const),
      ...withFourPrices(Number(cost), Number(price), tpe),
      quantity: Number(qty),
      lowStockThreshold: Number(low),
      fabricSellUnit: tpe === 'fabric' ? ('metre' as const) : null,
      createdAt: t,
      updatedAt: t,
    }
  })

  products.push(...pieces)

  for (const p of products) {
    if (p.mrp < p.salePrice) p.mrp = round2(p.salePrice * 1.25)
  }

  const supplier: Supplier = {
    id: 'sup-rajasthan',
    name: 'Rajasthan Textiles',
    phone: '9876543210',
    address: 'Jaipur, Rajasthan',
    notes: 'Primary garment & fabric supplier',
    createdAt: t,
    updatedAt: t,
  }

  await db.products.bulkPut(products)
  await db.productSizes.bulkPut(sizes)
  await db.suppliers.put(supplier)
}
