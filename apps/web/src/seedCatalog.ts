import { db } from './db'
import type { Product, ProductSize, Supplier } from './types'

export async function seedCatalogIfEmpty() {
  const n = await db.products.count()
  if (n > 0) return
  const t = new Date().toISOString()
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
      unit: 'piece',
      sellingPrice: price,
      costPrice: cost,
      quantity: 0,
      lowStockThreshold: low,
      fabricSellUnit: null,
      createdAt: t,
      updatedAt: t,
    })
    for (const [size, quantity] of Object.entries(sizeMap)) {
      sizes.push({ id: `${id}-${size}`, productId: id, size, quantity })
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
  ].map(([id, sku, name, type, price, cost, qty, low]) => ({
    id: id as string,
    sku: sku as string,
    name: name as string,
    type: type as Product['type'],
    unit: type === 'fabric' ? 'metre' : 'piece',
    sellingPrice: Number(price),
    costPrice: Number(cost),
    quantity: Number(qty),
    lowStockThreshold: Number(low),
    fabricSellUnit: type === 'fabric' ? 'metre' : null,
    createdAt: t,
    updatedAt: t,
  }))

  products.push(...pieces)

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
