import crypto from 'node:crypto'
import { db, nowIso } from './db.js'

export function hashPassword(password: string) {
  return crypto.createHash('sha256').update('laxmi-v1:' + password).digest('hex')
}

const STANDARD = ['S', 'M', 'L', 'XL', 'XXL'] as const

export function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  if (n.c > 0) return false

  const t = nowIso()
  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  insertUser.run('user-owner', 'owner', hashPassword('owner123'), 'owner', 'Store Owner', t)
  insertUser.run('user-cashier', 'cashier', hashPassword('cashier123'), 'cashier', 'Counter Cashier', t)

  const defaultPricing = JSON.stringify({
    garment: { wholesaleMarkupPct: 20, mrpMarkupPct: 100, saleDiscountFromMrpPct: 20 },
    saree: { wholesaleMarkupPct: 20, mrpMarkupPct: 100, saleDiscountFromMrpPct: 20 },
    fabric: { wholesaleMarkupPct: 20, mrpMarkupPct: 100, saleDiscountFromMrpPct: 20 },
  })
  db.prepare(
    'INSERT INTO store_profile (id, name, address, phone, city, pricing_settings, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'store-1',
    'Laxmi Fashion Wholesale Mart',
    'Shop 14, Textile Market',
    '9876500000',
    'Surat',
    defaultPricing,
    t,
  )

  db.prepare(
    `INSERT INTO suppliers (id, name, phone, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'sup-rajasthan',
    'Rajasthan Textiles',
    '9876543210',
    'Jaipur, Rajasthan',
    'Primary garment & fabric supplier',
    t,
    t,
  )

  const insertProduct = db.prepare(
    `INSERT INTO products
      (id, sku, name, type, unit, selling_price, cost_price, wholesale_price, mrp, quantity, low_stock_threshold, fabric_sell_unit, created_at, updated_at)
     VALUES (@id, @sku, @name, @type, @unit, @selling_price, @cost_price, @wholesale_price, @mrp, @quantity, @low_stock_threshold, @fabric_sell_unit, @created_at, @updated_at)`,
  )
  function four(cost: number, sale: number) {
    return {
      selling_price: sale,
      cost_price: cost,
      wholesale_price: Math.round(cost * 1.2 * 100) / 100,
      mrp: Math.round(cost * 2 * 100) / 100,
    }
  }
  const insertSize = db.prepare(
    'INSERT INTO product_sizes (id, product_id, size, quantity) VALUES (?, ?, ?, ?)',
  )

  const garments: Array<{
    id: string
    sku: string
    name: string
    price: number
    cost: number
    sizes: Record<string, number>
    extra?: Record<string, number>
  }> = [
    {
      id: 'p-kurti-cotton',
      sku: 'G-KURTI-001',
      name: 'Cotton Kurti',
      price: 450,
      cost: 280,
      sizes: { S: 12, M: 18, L: 20, XL: 14, XXL: 8 },
    },
    {
      id: 'p-palazzo',
      sku: 'G-PALAZZO-001',
      name: 'Ladies Palazzo',
      price: 380,
      cost: 220,
      sizes: { S: 0, M: 16, L: 18, XL: 12, XXL: 6 },
    },
    {
      id: 'p-shirt-men',
      sku: 'G-SHIRT-001',
      name: "Men's Formal Shirt",
      price: 550,
      cost: 340,
      sizes: { S: 8, M: 14, L: 16, XL: 10, XXL: 4 },
    },
    {
      id: 'p-nightwear',
      sku: 'G-NIGHT-001',
      name: 'Free Size Nightwear',
      price: 280,
      cost: 160,
      sizes: { 'Free size': 24 },
    },
    {
      id: 'p-frock',
      sku: 'G-FROCK-001',
      name: 'Kids Frock',
      price: 320,
      cost: 190,
      sizes: { '22': 6, '24': 10, '26': 10, '28': 8, '32': 4 },
    },
  ]

  for (const g of garments) {
    insertProduct.run({
      id: g.id,
      sku: g.sku,
      name: g.name,
      type: 'garment',
      unit: 'piece',
      ...four(g.cost, g.price),
      quantity: 0,
      low_stock_threshold: 4,
      fabric_sell_unit: null,
      created_at: t,
      updated_at: t,
    })
    for (const [size, qty] of Object.entries(g.sizes)) {
      insertSize.run(`${g.id}-${size}`, g.id, size, qty)
    }
    // ensure standard chips exist even if 0 (except products that use custom/free only)
    if (g.id !== 'p-nightwear' && g.id !== 'p-frock') {
      for (const s of STANDARD) {
        if (g.sizes[s] == null) insertSize.run(`${g.id}-${s}`, g.id, s, 0)
      }
    }
  }

  const sarees = [
    { id: 'p-saree-cotton', sku: 'S-COT-001', name: 'Cotton Saree', price: 650, cost: 420, qty: 40 },
    { id: 'p-saree-silk', sku: 'S-SILK-001', name: 'Silk Saree', price: 1850, cost: 1200, qty: 15 },
    { id: 'p-saree-geo', sku: 'S-GEO-001', name: 'Georgette Saree', price: 890, cost: 560, qty: 25 },
  ]
  for (const s of sarees) {
    insertProduct.run({
      id: s.id,
      sku: s.sku,
      name: s.name,
      type: 'saree',
      unit: 'piece',
      ...four(s.cost, s.price),
      quantity: s.qty,
      low_stock_threshold: 5,
      fabric_sell_unit: null,
      created_at: t,
      updated_at: t,
    })
  }

  const fabrics = [
    { id: 'p-than-cotton', sku: 'F-COT-001', name: 'Cotton Than', price: 85, cost: 52, qty: 120, sell: 'metre' },
    { id: 'p-than-rayon', sku: 'F-RAY-001', name: 'Rayon Print Fabric', price: 95, cost: 60, qty: 80, sell: 'metre' },
    { id: 'p-than-geo', sku: 'F-GEO-001', name: 'Georgette Fabric', price: 110, cost: 70, qty: 45.5, sell: 'metre' },
  ]
  for (const f of fabrics) {
    insertProduct.run({
      id: f.id,
      sku: f.sku,
      name: f.name,
      type: 'fabric',
      unit: 'metre',
      ...four(f.cost, f.price),
      quantity: f.qty,
      low_stock_threshold: 15,
      fabric_sell_unit: f.sell,
      created_at: t,
      updated_at: t,
    })
  }

  return true
}
