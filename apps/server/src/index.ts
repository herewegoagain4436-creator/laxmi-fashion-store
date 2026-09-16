import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { applyStockDelta, db, DEFAULT_CATEGORY_IDS, getSnapshot, migrate, nowIso, rowCategory, rowProduct } from './db.js'
import { hashPassword, seedIfEmpty } from './seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SECRET = process.env.LAXMI_SECRET || 'laxmi-fashion-dev-secret'
const PORT = Number(process.env.PORT || 8787)
/** Shared store secret for cloud / LAN sync. Empty = not enforced (local desktop/dev). */
const SYNC_TOKEN = (process.env.LAXMI_SYNC_TOKEN || '').trim()
/** When SYNC_TOKEN is set, allow requests from loopback without token (optional local-dev bypass). Default on. */
const ALLOW_LOCALHOST_NO_TOKEN = (process.env.LAXMI_ALLOW_LOCALHOST_NO_TOKEN || '1') !== '0'

type Authed = Request & {
  user?: { id: string; username: string; role: string; name: string }
  storeTokenOk?: boolean
}

const SYNC_USER = {
  id: 'store-sync',
  username: 'sync',
  role: 'owner',
  name: 'Store Sync',
} as const

function timingSafeEqualStr(a: string, b: string) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function clientIsLoopback(req: Request) {
  const raw = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  return raw === '127.0.0.1' || raw === '::1' || raw === 'localhost'
}

function extractBearer(req: Request) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

function extractStoreToken(req: Request) {
  const x = req.headers['x-laxmi-token']
  if (typeof x === 'string' && x.trim()) return x.trim()
  if (Array.isArray(x) && x[0]) return String(x[0]).trim()
  const bearer = extractBearer(req)
  // Bearer may be either the store sync token or a user JWT (payload.sig)
  if (bearer && SYNC_TOKEN && timingSafeEqualStr(bearer, SYNC_TOKEN)) return bearer
  return ''
}

function storeTokenSatisfied(req: Request) {
  if (!SYNC_TOKEN) return true
  if (ALLOW_LOCALHOST_NO_TOKEN && clientIsLoopback(req)) return true
  const presented = extractStoreToken(req)
  return Boolean(presented && timingSafeEqualStr(presented, SYNC_TOKEN))
}

/** Require LAXMI_SYNC_TOKEN when configured (Bearer or X-Laxmi-Token). */
function requireStoreToken(req: Authed, res: Response, next: NextFunction) {
  if (!storeTokenSatisfied(req)) {
    return res.status(401).json({ error: 'Invalid or missing sync token' })
  }
  req.storeTokenOk = true
  next()
}

function signToken(user: { id: string; username: string; role: string; name: string }) {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + 30 * 24 * 3600 * 1000 }),
  ).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyToken(token: string) {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data?.id || data.exp < Date.now()) return null
    return data as { id: string; username: string; role: string; name: string }
  } catch {
    return null
  }
}

function auth(req: Authed, res: Response, next: NextFunction) {
  if (!storeTokenSatisfied(req)) {
    return res.status(401).json({ error: 'Invalid or missing sync token' })
  }
  const bearer = extractBearer(req)
  let user: Authed['user'] = undefined
  if (bearer && !(SYNC_TOKEN && timingSafeEqualStr(bearer, SYNC_TOKEN))) {
    user = verifyToken(bearer) || undefined
  }
  // Offline-first clients may sync with store token only (no user JWT yet)
  if (!user && SYNC_TOKEN && extractStoreToken(req)) {
    user = { ...SYNC_USER }
  }
  if (!user && !SYNC_TOKEN) {
    // Dev / desktop without store token: JWT required as before
    user = bearer ? verifyToken(bearer) || undefined : undefined
  }
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  req.user = user
  next()
}

function ownerOnly(req: Authed, res: Response, next: NextFunction) {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner only' })
  next()
}

migrate()
const seeded = seedIfEmpty()

const app = express()
const corsOrigins = (process.env.LAXMI_CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Laxmi-Token'],
    exposedHeaders: ['X-Laxmi-Token'],
  }),
)
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'Laxmi Fashion Wholesale Mart',
    time: nowIso(),
    syncTokenRequired: Boolean(SYNC_TOKEN),
  })
})

app.post('/api/auth/login', requireStoreToken, (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as
    | { id: string; username: string; password_hash: string; role: string; name: string }
    | undefined
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  const publicUser = { id: user.id, username: user.username, role: user.role, name: user.name }
  res.json({ token: signToken(publicUser), user: publicUser })
})

app.get('/api/auth/me', auth, (req: Authed, res) => {
  res.json({ user: req.user })
})

app.get('/api/snapshot', auth, (_req, res) => {
  res.json(getSnapshot())
})

app.put('/api/store', auth, ownerOnly, (req: Authed, res) => {
  const { name, address, phone, city, pricingSettings } = req.body || {}
  db.prepare(
    'UPDATE store_profile SET name = ?, address = ?, phone = ?, city = ?, pricing_settings = ?, updated_at = ? WHERE id = ?',
  ).run(
    String(name || 'Laxmi Fashion Wholesale Mart'),
    address ?? '',
    phone ?? '',
    city ?? '',
    pricingSettings != null ? JSON.stringify(pricingSettings) : null,
    nowIso(),
    'store-1',
  )
  res.json({ ok: true })
})

function resolveProductPrices(p: Record<string, unknown>) {
  const cost = Number(p.purchasePrice ?? p.costPrice ?? 0) || 0
  const sale = Number(p.salePrice ?? p.sellingPrice ?? 0) || 0
  const wholesale =
    p.wholesalePrice != null && Number.isFinite(Number(p.wholesalePrice))
      ? Number(p.wholesalePrice)
      : Math.round(cost * 1.2 * 100) / 100
  const mrp =
    p.mrp != null && Number.isFinite(Number(p.mrp))
      ? Number(p.mrp)
      : Math.round(cost * 2 * 100) / 100
  return { cost, sale, wholesale, mrp }
}


function resolveCategoryId(p: Record<string, unknown>): string {
  if (p.categoryId) return String(p.categoryId)
  const type = String(p.type || 'garment')
  if (type === 'saree') return DEFAULT_CATEGORY_IDS.saree
  if (type === 'fabric') return DEFAULT_CATEGORY_IDS.fabric
  return DEFAULT_CATEGORY_IDS.garment
}

function resolveTypeFromCategory(categoryId: string, fallback: string): string {
  const cat = db.prepare('SELECT base_type FROM categories WHERE id = ?').get(categoryId) as
    | { base_type: string }
    | undefined
  return cat?.base_type || fallback || 'garment'
}

function upsertCategory(c: Record<string, unknown>) {
  const id = String(c.id)
  const t = String(c.updatedAt || nowIso())
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(id)
  const active = c.active === false || c.deletedAt ? 0 : 1
  const params = {
    id,
    name: String(c.name || 'Category'),
    slug: c.slug ?? null,
    base_type: String(c.baseType || 'garment'),
    wholesale_markup_pct: Number(c.wholesaleMarkupPct ?? 20),
    mrp_markup_pct: Number(c.mrpMarkupPct ?? 100),
    sale_discount_from_mrp_pct: Number(c.saleDiscountFromMrpPct ?? 20),
    sort_order: Number(c.sortOrder ?? 100),
    active,
    created_at: String(c.createdAt || t),
    updated_at: t,
    deleted_at: c.deletedAt ?? null,
  }
  if (existing) {
    db.prepare(
      `UPDATE categories SET name=@name, slug=@slug, base_type=@base_type,
        wholesale_markup_pct=@wholesale_markup_pct, mrp_markup_pct=@mrp_markup_pct,
        sale_discount_from_mrp_pct=@sale_discount_from_mrp_pct, sort_order=@sort_order,
        active=@active, updated_at=@updated_at, deleted_at=@deleted_at WHERE id=@id`,
    ).run(params)
  } else {
    db.prepare(
      `INSERT INTO categories
        (id, name, slug, base_type, wholesale_markup_pct, mrp_markup_pct, sale_discount_from_mrp_pct,
         sort_order, active, created_at, updated_at, deleted_at)
       VALUES (@id, @name, @slug, @base_type, @wholesale_markup_pct, @mrp_markup_pct,
         @sale_discount_from_mrp_pct, @sort_order, @active, @created_at, @updated_at, @deleted_at)`,
    ).run(params)
  }
}

function upsertProduct(p: Record<string, unknown>) {
  const id = String(p.id)
  const existing = db.prepare('SELECT id, quantity FROM products WHERE id = ?').get(id) as
    | { id: string; quantity: number }
    | undefined
  const t = String(p.updatedAt || nowIso())
  const { cost, sale, wholesale, mrp } = resolveProductPrices(p)
  const categoryId = resolveCategoryId(p)
  const type = resolveTypeFromCategory(categoryId, String(p.type || 'garment'))
  // Never last-write-wins stock qty from product sync — keep server qty on update.
  const keepQty = existing ? Number(existing.quantity) : Number(p.quantity ?? 0)
  if (existing) {
    db.prepare(
      `UPDATE products SET sku=@sku, name=@name, type=@type, category_id=@category_id, unit=@unit,
        selling_price=@selling_price, cost_price=@cost_price,
        wholesale_price=@wholesale_price, mrp=@mrp,
        low_stock_threshold=@low_stock_threshold, fabric_sell_unit=@fabric_sell_unit,
        shade=@shade,
        updated_at=@updated_at, deleted_at=@deleted_at WHERE id=@id`,
    ).run({
      id,
      sku: p.sku,
      name: p.name,
      type,
      category_id: categoryId,
      unit: p.unit,
      selling_price: sale,
      cost_price: cost,
      wholesale_price: wholesale,
      mrp,
      low_stock_threshold: p.lowStockThreshold ?? 5,
      fabric_sell_unit: p.fabricSellUnit ?? null,
      shade: p.shade ?? null,
      updated_at: t,
      deleted_at: p.deletedAt ?? null,
    })
  } else {
    db.prepare(
      `INSERT INTO products (id, sku, name, type, category_id, unit, selling_price, cost_price,
        wholesale_price, mrp, quantity,
        low_stock_threshold, fabric_sell_unit, shade, created_at, updated_at, deleted_at)
       VALUES (@id, @sku, @name, @type, @category_id, @unit, @selling_price, @cost_price,
        @wholesale_price, @mrp, @quantity,
        @low_stock_threshold, @fabric_sell_unit, @shade, @created_at, @updated_at, @deleted_at)`,
    ).run({
      id,
      sku: p.sku,
      name: p.name,
      type,
      category_id: categoryId,
      unit: p.unit,
      selling_price: sale,
      cost_price: cost,
      wholesale_price: wholesale,
      mrp,
      quantity: keepQty,
      low_stock_threshold: p.lowStockThreshold ?? 5,
      fabric_sell_unit: p.fabricSellUnit ?? null,
      shade: p.shade ?? null,
      created_at: p.createdAt || t,
      updated_at: t,
      deleted_at: p.deletedAt ?? null,
    })
  }
  const sizes =
    (p.sizes as Array<{
      id?: string
      size: string
      colour?: string
      quantity?: number
      barcode?: string
      variantSku?: string
    }>) || []
  for (const s of sizes) {
    const colour = (s.colour && String(s.colour).trim()) || 'Default'
    const size = String(s.size)
    const vid = s.id || `${id}-${colour}-${size}`
    const existingSz = db
      .prepare('SELECT id, quantity FROM product_sizes WHERE id = ?')
      .get(vid) as { id: string; quantity: number } | undefined
    const legacy = !existingSz
      ? (db
          .prepare('SELECT id, quantity FROM product_sizes WHERE product_id = ? AND size = ? AND (colour IS NULL OR colour = ? OR colour = \'Default\')')
          .get(id, size, colour) as { id: string; quantity: number } | undefined)
      : undefined
    const row = existingSz || legacy
    if (row) {
      // Preserve quantity — only update metadata (barcode / colour / sku)
      db.prepare(
        `UPDATE product_sizes SET colour = ?, barcode = COALESCE(?, barcode),
          variant_sku = COALESCE(?, variant_sku) WHERE id = ?`,
      ).run(colour, s.barcode ?? null, s.variantSku ?? null, row.id)
    } else {
      // New variant: allow initial qty from payload (first create)
      db.prepare(
        `INSERT INTO product_sizes (id, product_id, size, colour, quantity, barcode, variant_sku)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(vid, id, size, colour, s.quantity ?? 0, s.barcode ?? null, s.variantSku ?? null)
    }
  }
}

function upsertSupplier(s: Record<string, unknown>) {
  const id = String(s.id)
  const t = String(s.updatedAt || nowIso())
  const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id)
  if (existing) {
    db.prepare(
      `UPDATE suppliers SET name=?, phone=?, address=?, notes=?, updated_at=?, deleted_at=? WHERE id=?`,
    ).run(s.name, s.phone ?? '', s.address ?? '', s.notes ?? '', t, s.deletedAt ?? null, id)
  } else {
    db.prepare(
      `INSERT INTO suppliers (id, name, phone, address, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, s.name, s.phone ?? '', s.address ?? '', s.notes ?? '', s.createdAt || t, t, s.deletedAt ?? null)
  }
}

function createPurchase(p: Record<string, unknown>) {
  const id = String(p.id)
  const exists = db.prepare('SELECT id FROM purchases WHERE id = ?').get(id)
  if (exists) return { id, duplicate: true }
  const items = (p.items as Array<Record<string, unknown>>) || []
  const costUpdates = (p.costUpdates as Array<{ productId: string; costPrice: number }>) || []
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO purchases (id, supplier_id, bill_no, date, total, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      p.supplierId ?? null,
      p.billNo ?? '',
      p.date,
      p.total ?? 0,
      p.notes ?? '',
      p.createdBy ?? null,
      p.createdAt || nowIso(),
    )
    const ins = db.prepare(
      `INSERT INTO purchase_items (id, purchase_id, product_id, product_name, size, colour, quantity, unit, unit_cost, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const latestCost = new Map<string, number>()
    for (const it of items) {
      ins.run(
        it.id || crypto.randomUUID(),
        id,
        it.productId,
        it.productName ?? '',
        it.size ?? null,
        (it.colour as string) || 'Default',
        it.quantity,
        it.unit ?? 'piece',
        it.unitCost,
        it.lineTotal,
      )
      if (it.productId != null && it.unitCost != null && Number.isFinite(Number(it.unitCost))) {
        latestCost.set(String(it.productId), Number(it.unitCost))
      }
      const prod = db.prepare('SELECT type FROM products WHERE id = ?').get(it.productId as string) as
        | { type: string }
        | undefined
      if (prod) {
        applyStockDelta(
          String(it.productId),
          prod.type,
          (it.size as string) || null,
          String(it.unit || (prod.type === 'fabric' ? 'metre' : 'piece')),
          Number(it.quantity),
          1,
          (it.colour as string) || 'Default',
          { reason: 'purchase', refType: 'purchase', refId: id },
        )
      }
    }
    type PricePack = {
      purchasePrice: number
      wholesalePrice?: number
      mrp?: number
      salePrice?: number
    }
    const latestPrices = new Map<string, PricePack>()
    for (const [productId, costPrice] of latestCost) {
      latestPrices.set(productId, { purchasePrice: costPrice })
    }
    for (const cu of costUpdates as Array<Record<string, unknown>>) {
      if (cu?.productId == null) continue
      const purchase = Number(cu.purchasePrice ?? cu.costPrice)
      if (!Number.isFinite(purchase)) continue
      const pack: PricePack = { purchasePrice: purchase }
      if (cu.wholesalePrice != null && Number.isFinite(Number(cu.wholesalePrice))) {
        pack.wholesalePrice = Number(cu.wholesalePrice)
      }
      if (cu.mrp != null && Number.isFinite(Number(cu.mrp))) {
        pack.mrp = Number(cu.mrp)
      }
      if (cu.salePrice != null || cu.sellingPrice != null) {
        const s = Number(cu.salePrice ?? cu.sellingPrice)
        if (Number.isFinite(s)) pack.salePrice = s
      }
      latestPrices.set(String(cu.productId), pack)
    }
    const t = nowIso()
    const updCost = db.prepare(
      `UPDATE products SET cost_price = ?, wholesale_price = COALESCE(?, wholesale_price),
        mrp = COALESCE(?, mrp), selling_price = COALESCE(?, selling_price), updated_at = ?
       WHERE id = ?`,
    )
    for (const [productId, pack] of latestPrices) {
      const wholesale =
        pack.wholesalePrice != null
          ? pack.wholesalePrice
          : Math.round(pack.purchasePrice * 1.2 * 100) / 100
      const mrp =
        pack.mrp != null ? pack.mrp : Math.round(pack.purchasePrice * 2 * 100) / 100
      const sale = pack.salePrice != null ? pack.salePrice : null
      updCost.run(pack.purchasePrice, wholesale, mrp, sale, t, productId)
    }
  })
  tx()
  return { id, duplicate: false }
}

function createSale(s: Record<string, unknown>) {
  const id = String(s.id)
  const exists = db.prepare('SELECT id FROM sales WHERE id = ?').get(id)
  if (exists) return { id, duplicate: true }
  const items = (s.items as Array<Record<string, unknown>>) || []
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sales (id, bill_no, datetime, cashier_id, cashier_name, customer_phone,
        payment_mode, cash_amount, upi_amount, card_amount, discount, grand_total, status, notes, created_at,
        price_channel, customer_gstin, upi_ref, taxable_total, gst_total, exchange_of_sale_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      s.billNo,
      s.datetime,
      s.cashierId ?? null,
      s.cashierName ?? '',
      s.customerPhone ?? '',
      s.paymentMode,
      s.cashAmount ?? 0,
      s.upiAmount ?? 0,
      s.cardAmount ?? 0,
      s.discount ?? 0,
      s.grandTotal,
      s.status || 'completed',
      s.notes ?? '',
      s.createdAt || nowIso(),
      s.priceChannel || 'retail',
      s.customerGstin ?? '',
      s.upiRef ?? '',
      s.taxableTotal ?? 0,
      s.gstTotal ?? 0,
      s.exchangeOfSaleId ?? null,
    )
    const ins = db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, product_type, sku, size, quantity, unit, rate, line_total,
        colour, shade, barcode, mrp, gst_rate, taxable_amount, cgst_amount, sgst_amount, line_kind, return_of_sale_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const it of items) {
      const lineKind = String(it.lineKind || 'sale')
      const qty = Number(it.quantity)
      ins.run(
        it.id || crypto.randomUUID(),
        id,
        it.productId,
        it.productName,
        it.productType,
        it.sku ?? '',
        it.size ?? null,
        qty,
        it.unit,
        it.rate,
        it.lineTotal,
        (it.colour as string) || 'Default',
        it.shade ?? null,
        it.barcode ?? null,
        it.mrp ?? null,
        it.gstRate ?? null,
        it.taxableAmount ?? null,
        it.cgstAmount ?? null,
        it.sgstAmount ?? null,
        lineKind,
        it.returnOfSaleItemId ?? null,
      )
      // Return lines restock; sale lines deplete
      const dir: 1 | -1 = lineKind === 'return' ? 1 : -1
      applyStockDelta(
        String(it.productId),
        String(it.productType),
        (it.size as string) || null,
        String(it.unit),
        Math.abs(qty),
        dir,
        (it.colour as string) || 'Default',
        { reason: lineKind === 'return' ? 'return' : 'sale', refType: 'sale', refId: id },
      )
    }
    if (s.exchangeOfSaleId) {
      db.prepare('UPDATE sales SET status = ? WHERE id = ?').run('partial_return', String(s.exchangeOfSaleId))
    }
  })
  tx()
  return { id, duplicate: false }
}

function createReturn(r: Record<string, unknown>) {
  const id = String(r.id)
  const exists = db.prepare('SELECT id FROM returns WHERE id = ?').get(id)
  if (exists) return { id, duplicate: true }
  const items = (r.items as Array<Record<string, unknown>>) || []
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO returns (id, sale_id, datetime, reason, refund_amount, refund_mode, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      r.saleId,
      r.datetime,
      r.reason ?? '',
      r.refundAmount,
      r.refundMode ?? 'cash',
      r.createdBy ?? null,
      r.createdAt || nowIso(),
    )
    const ins = db.prepare(
      `INSERT INTO return_items (id, return_id, sale_item_id, product_id, product_name, size, colour, quantity, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const it of items) {
      ins.run(
        it.id || crypto.randomUUID(),
        id,
        it.saleItemId,
        it.productId,
        it.productName ?? '',
        it.size ?? null,
        (it.colour as string) || 'Default',
        it.quantity,
        it.unit ?? 'piece',
      )
      const saleItem = db
        .prepare('SELECT product_type, colour FROM sale_items WHERE id = ?')
        .get(it.saleItemId as string) as { product_type: string; colour?: string } | undefined
      const type =
        (it.productType as string) ||
        saleItem?.product_type ||
        (db.prepare('SELECT type FROM products WHERE id = ?').get(it.productId as string) as { type: string } | undefined)
          ?.type ||
        'saree'
      applyStockDelta(
        String(it.productId),
        type,
        (it.size as string) || null,
        String(it.unit || 'piece'),
        Number(it.quantity),
        1,
        (it.colour as string) || saleItem?.colour || 'Default',
        { reason: 'return', refType: 'return', refId: id },
      )
    }
    const saleId = String(r.saleId)
    const orig = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').all(saleId) as { id: string }[]
    const returned = db
      .prepare(
        `SELECT ri.sale_item_id as id, SUM(ri.quantity) as q
         FROM return_items ri JOIN returns r2 ON r2.id = ri.return_id
         WHERE r2.sale_id = ? GROUP BY ri.sale_item_id`,
      )
      .all(saleId) as { id: string; q: number }[]
    const map = Object.fromEntries(returned.map((x) => [x.id, x.q]))
    const origQtys = db
      .prepare('SELECT id, quantity FROM sale_items WHERE sale_id = ?')
      .all(saleId) as { id: string; quantity: number }[]
    const allReturned = origQtys.every((x) => (map[x.id] || 0) >= x.quantity - 1e-9)
    db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(allReturned ? 'returned' : 'partial_return', saleId)
  })
  tx()
  return { id, duplicate: false }
}

app.post('/api/sync', auth, (req: Authed, res) => {
  const body = req.body || {}
  const results: Record<string, unknown> = { categories: [], products: [], suppliers: [], purchases: [], sales: [], returns: [] }
  try {
    const tx = db.transaction(() => {
      for (const c of body.categories || []) {
        upsertCategory(c)
        ;(results.categories as unknown[]).push({ id: c.id, ok: true })
      }
      for (const p of body.products || []) {
        upsertProduct(p)
        ;(results.products as unknown[]).push({ id: p.id, ok: true })
      }
      for (const s of body.suppliers || []) {
        upsertSupplier(s)
        ;(results.suppliers as unknown[]).push({ id: s.id, ok: true })
      }
      for (const p of body.purchases || []) {
        ;(results.purchases as unknown[]).push(createPurchase(p))
      }
      for (const s of body.sales || []) {
        ;(results.sales as unknown[]).push(createSale(s))
      }
      for (const r of body.returns || []) {
        ;(results.returns as unknown[]).push(createReturn(r))
      }
      if (body.store && req.user?.role === 'owner') {
        const st = body.store
        db.prepare(
          `UPDATE store_profile SET name=?, address=?, phone=?, city=?, pricing_settings=?,
            upi_vpa=?, gstin=?, gst_settings=?, max_cashier_discount=?, max_cashier_discount_pct=?,
            updated_at=? WHERE id=?`,
        ).run(
          st.name,
          st.address ?? '',
          st.phone ?? '',
          st.city ?? '',
          st.pricingSettings != null ? JSON.stringify(st.pricingSettings) : null,
          st.upiVpa ?? '',
          st.gstin ?? '',
          st.gstSettings != null ? JSON.stringify(st.gstSettings) : null,
          st.maxCashierDiscount ?? 100,
          st.maxCashierDiscountPct ?? 5,
          st.updatedAt || nowIso(),
          st.id || 'store-1',
        )
        results.store = { ok: true }
      }
    })
    tx()
    res.json({ ok: true, results, snapshot: getSnapshot() })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Sync failed', detail: String(err) })
  }
})


app.get('/api/categories', auth, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, name')
    .all() as Record<string, unknown>[]
  res.json(rows.map(rowCategory))
})

app.post('/api/categories', auth, ownerOnly, (req: Authed, res) => {
  upsertCategory(req.body)
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.body.id) as Record<string, unknown>
  res.json(rowCategory(row))
})

app.get('/api/products', auth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY name').all() as Record<
    string,
    unknown
  >[]
  res.json(rows.map(rowProduct))
})

app.post('/api/products', auth, ownerOnly, (req: Authed, res) => {
  upsertProduct(req.body)
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.body.id) as Record<string, unknown>
  res.json(rowProduct(row))
})

app.delete('/api/products/:id', auth, ownerOnly, (req, res) => {
  db.prepare('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), req.params.id)
  res.json({ ok: true })
})

app.get('/api/reports/today', auth, (req: Authed, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner only' })
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const iso = start.toISOString()
  const sales = db
    .prepare(
      `SELECT payment_mode as paymentMode, cash_amount as cashAmount, upi_amount as upiAmount,
              card_amount as cardAmount, grand_total as grandTotal, status
       FROM sales WHERE datetime >= ? AND status != 'returned'`,
    )
    .all(iso) as Array<Record<string, number | string>>
  let count = 0
  let total = 0
  let cash = 0
  let upi = 0
  let card = 0
  for (const s of sales) {
    count++
    total += Number(s.grandTotal)
    cash += Number(s.cashAmount)
    upi += Number(s.upiAmount)
    card += Number(s.cardAmount)
  }
  res.json({ count, total, cash, upi, card, date: iso.slice(0, 10) })
})

function mountWebStatic() {
  const webDist =
    process.env.LAXMI_WEB_DIST || path.join(__dirname, '..', '..', 'web', 'dist')
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }
  return webDist
}

export type StartServerOptions = {
  port?: number
  host?: string
}

export async function startServer(options: StartServerOptions = {}) {
  const port = options.port ?? PORT
  const host = options.host ?? process.env.HOST ?? '0.0.0.0'
  const webDist = mountWebStatic()
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.log(`Laxmi Fashion server http://${host}:${port}`)
      if (webDist && fs.existsSync(webDist)) console.log(`Serving UI from ${webDist}`)
      if (SYNC_TOKEN) console.log('Store sync token: required (Bearer or X-Laxmi-Token)')
      else console.log('Store sync token: not set (dev / local desktop)')
      if (seeded) console.log('Seeded owner/owner123 and cashier/cashier123')
      resolve()
    })
    server.on('error', reject)
  })
  return { port, host }
}

const isDirectRun = (() => {
  try {
    return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isDirectRun) {
  startServer().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
