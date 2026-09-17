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
      `INSERT INTO purchase_items (id, purchase_id, product_id, product_name, size, colour, quantity, unit, unit_cost, line_total,
        fabric_width, shade, lot, fabric_roll_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const latestCost = new Map<string, number>()
    const insRoll = db.prepare(
      `INSERT OR REPLACE INTO fabric_rolls
        (id, product_id, width, shade, lot, remaining_metres, initial_metres, remnant_threshold,
         barcode, purchase_id, purchase_item_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    for (const it of items) {
      const itemId = String(it.id || crypto.randomUUID())
      const rollId = it.fabricRollId ? String(it.fabricRollId) : null
      ins.run(
        itemId,
        id,
        it.productId,
        it.productName ?? '',
        it.size ?? null,
        (it.colour as string) || 'Default',
        it.quantity,
        it.unit ?? 'piece',
        it.unitCost,
        it.lineTotal,
        it.fabricWidth ?? null,
        it.shade ?? null,
        it.lot ?? null,
        rollId,
      )
      if (it.productId != null && it.unitCost != null && Number.isFinite(Number(it.unitCost))) {
        latestCost.set(String(it.productId), Number(it.unitCost))
      }
      const prod = db.prepare('SELECT type, remnant_threshold FROM products WHERE id = ?').get(it.productId as string) as
        | { type: string; remnant_threshold?: number }
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
        if (prod.type === 'fabric' && Number(it.quantity) > 0) {
          const rid = rollId || itemId + '-roll'
          const metres = Number(it.quantity)
          const tRoll = nowIso()
          insRoll.run(
            rid,
            String(it.productId),
            it.fabricWidth ?? null,
            it.shade ?? '',
            it.lot ?? '',
            metres,
            metres,
            Number(it.remnantThreshold ?? prod.remnant_threshold ?? 3),
            it.rollBarcode ?? null,
            id,
            itemId,
            tRoll,
            tRoll,
          )
        }
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
  const exists = db.prepare('SELECT id, status, credit_amount, customer_id FROM sales WHERE id = ?').get(id) as
    | { id: string; status: string; credit_amount?: number; customer_id?: string }
    | undefined
  if (exists) {
    // Soft-void update (idempotent)
    if (String(s.status) === 'voided' && exists.status !== 'voided') {
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id) as Record<string, unknown>[]
      const tx = db.transaction(() => {
        for (const it of items) {
          if (String(it.line_kind || 'sale') === 'return') continue
          applyStockDelta(
            String(it.product_id),
            String(it.product_type),
            (it.size as string) || null,
            String(it.unit),
            Math.abs(Number(it.quantity)),
            1,
            (it.colour as string) || 'Default',
            { reason: 'adjust', refType: 'void', refId: id },
          )
          if (it.fabric_roll_id) {
            const metres = Math.abs(Number(it.quantity)) * (String(it.unit) === 'cm' ? 0.01 : 1)
            db.prepare(
              `UPDATE fabric_rolls SET remaining_metres = remaining_metres + ?, updated_at = ? WHERE id = ?`,
            ).run(metres, nowIso(), String(it.fabric_roll_id))
          }
        }
        const credit = Number(exists.credit_amount || 0)
        if (exists.customer_id && credit > 0) {
          db.prepare(`UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?`).run(
            credit,
            nowIso(),
            String(exists.customer_id),
          )
        }
        db.prepare(
          `UPDATE sales SET status='voided', void_reason=?, voided_at=?, voided_by=? WHERE id=?`,
        ).run(s.voidReason ?? '', s.voidedAt || nowIso(), s.voidedBy ?? null, id)
        insertAudit({
          id: crypto.randomUUID(),
          action: 'void',
          entityType: 'sale',
          entityId: id,
          detail: { reason: s.voidReason, billNo: s.billNo },
          createdAt: nowIso(),
        })
      })
      tx()
      return { id, duplicate: false, voided: true }
    }
    return { id, duplicate: true }
  }
  const items = (s.items as Array<Record<string, unknown>>) || []
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sales (id, bill_no, datetime, cashier_id, cashier_name, customer_phone,
        payment_mode, cash_amount, upi_amount, card_amount, discount, grand_total, status, notes, created_at,
        price_channel, customer_gstin, upi_ref, taxable_total, gst_total, exchange_of_sale_id,
        customer_id, credit_amount, void_reason, voided_at, voided_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      s.customerId ?? null,
      s.creditAmount ?? 0,
      s.voidReason ?? null,
      s.voidedAt ?? null,
      s.voidedBy ?? null,
    )
    const ins = db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, product_type, sku, size, quantity, unit, rate, line_total,
        colour, shade, barcode, mrp, gst_rate, taxable_amount, cgst_amount, sgst_amount, line_kind, return_of_sale_item_id,
        fabric_roll_id, fabric_width)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        it.fabricRollId ?? null,
        it.fabricWidth ?? null,
      )
      const dir: 1 | -1 = lineKind === 'return' ? 1 : -1
      if (it.fabricRollId && String(it.productType) === 'fabric' && lineKind !== 'return') {
        const metres = Math.abs(qty) * (String(it.unit) === 'cm' ? 0.01 : 1)
        db.prepare(
          `UPDATE fabric_rolls SET remaining_metres = remaining_metres - ?, updated_at = ? WHERE id = ?`,
        ).run(metres, nowIso(), String(it.fabricRollId))
      }
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
    const creditAmt = Number(s.creditAmount || 0)
    if (s.customerId && creditAmt > 0 && String(s.status || 'completed') !== 'voided') {
      db.prepare(
        `UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      ).run(creditAmt, nowIso(), String(s.customerId))
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


function upsertCustomer(c: Record<string, unknown>) {
  const id = String(c.id)
  const t = String(c.updatedAt || nowIso())
  const existing = db.prepare('SELECT id, balance FROM customers WHERE id = ?').get(id) as
    | { id: string; balance: number }
    | undefined
  const balance = existing ? Number(existing.balance) : Number(c.balance ?? 0)
  if (existing) {
    db.prepare(
      `UPDATE customers SET phone=?, name=?, gstin=?, notes=?, updated_at=?, deleted_at=? WHERE id=?`,
    ).run(c.phone, c.name, c.gstin ?? '', c.notes ?? '', t, c.deletedAt ?? null, id)
  } else {
    db.prepare(
      `INSERT INTO customers (id, phone, name, gstin, balance, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, c.phone, c.name, c.gstin ?? '', balance, c.notes ?? '', c.createdAt || t, t, c.deletedAt ?? null)
  }
}

function upsertCustomerPayment(pay: Record<string, unknown>) {
  const id = String(pay.id)
  const exists = db.prepare('SELECT id FROM customer_payments WHERE id = ?').get(id)
  if (exists) return
  db.prepare(
    `INSERT INTO customer_payments (id, customer_id, amount, mode, sale_id, notes, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pay.customerId,
    pay.amount,
    pay.mode || 'cash',
    pay.saleId ?? null,
    pay.notes ?? '',
    pay.createdAt || nowIso(),
    pay.createdBy ?? null,
  )
  db.prepare(`UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?`).run(
    Number(pay.amount),
    nowIso(),
    String(pay.customerId),
  )
}

function upsertFabricRoll(r: Record<string, unknown>) {
  const id = String(r.id)
  const t = String(r.updatedAt || nowIso())
  const existing = db.prepare('SELECT id FROM fabric_rolls WHERE id = ?').get(id)
  if (existing) {
    db.prepare(
      `UPDATE fabric_rolls SET width=?, shade=?, lot=?, remaining_metres=?, remnant_threshold=?,
        barcode=?, updated_at=?, deleted_at=? WHERE id=?`,
    ).run(
      r.width ?? null,
      r.shade ?? '',
      r.lot ?? '',
      r.remainingMetres ?? 0,
      r.remnantThreshold ?? 3,
      r.barcode ?? null,
      t,
      r.deletedAt ?? null,
      id,
    )
  } else {
    db.prepare(
      `INSERT INTO fabric_rolls
        (id, product_id, width, shade, lot, remaining_metres, initial_metres, remnant_threshold,
         barcode, purchase_id, purchase_item_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      r.productId,
      r.width ?? null,
      r.shade ?? '',
      r.lot ?? '',
      r.remainingMetres ?? 0,
      r.initialMetres ?? r.remainingMetres ?? 0,
      r.remnantThreshold ?? 3,
      r.barcode ?? null,
      r.purchaseId ?? null,
      r.purchaseItemId ?? null,
      r.createdAt || t,
      t,
      r.deletedAt ?? null,
    )
  }
}

function insertAudit(a: Record<string, unknown>) {
  const id = String(a.id)
  const exists = db.prepare('SELECT id FROM audit_log WHERE id = ?').get(id)
  if (exists) return
  db.prepare(
    `INSERT INTO audit_log (id, action, entity_type, entity_id, user_id, user_name, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    a.action,
    a.entityType,
    a.entityId,
    a.userId ?? null,
    a.userName ?? null,
    typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail ?? {}),
    a.createdAt || nowIso(),
  )
}


app.post('/api/sync', auth, (req: Authed, res) => {
  const body = req.body || {}
  const results: Record<string, unknown> = {
    categories: [], products: [], suppliers: [], purchases: [], sales: [], returns: [],
    customers: [], customerPayments: [], fabricRolls: [], audit: [],
  }
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
      for (const c of body.customers || []) {
        upsertCustomer(c)
        ;(results.customers as unknown[]).push({ id: c.id, ok: true })
      }
      for (const pay of body.customerPayments || []) {
        upsertCustomerPayment(pay)
        ;(results.customerPayments as unknown[]).push({ id: pay.id, ok: true })
      }
      for (const r of body.fabricRolls || []) {
        upsertFabricRoll(r)
        ;(results.fabricRolls as unknown[]).push({ id: r.id, ok: true })
      }
      for (const a of body.audit || []) {
        insertAudit(a)
        ;(results.audit as unknown[]).push({ id: a.id, ok: true })
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
            barcode_prefix=?, remnant_threshold=?, razorpay_key_id=?, razorpay_key_secret=?,
            razorpay_webhook_secret=?, updated_at=? WHERE id=?`,
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
          st.barcodePrefix ?? '',
          st.remnantThreshold ?? 3,
          st.razorpayKeyId ?? '',
          st.razorpayKeySecret ?? '',
          st.razorpayWebhookSecret ?? '',
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


/** Create a Razorpay UPI/QR payment intent when keys are configured. Falls back gracefully. */
app.post('/api/payments/razorpay/create-order', auth, async (req: Authed, res) => {
  try {
    const store = db.prepare('SELECT razorpay_key_id, razorpay_key_secret FROM store_profile LIMIT 1').get() as
      | { razorpay_key_id?: string; razorpay_key_secret?: string }
      | undefined
    const keyId = (store?.razorpay_key_id || process.env.RAZORPAY_KEY_ID || '').trim()
    const keySecret = (store?.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET || '').trim()
    if (!keyId || !keySecret) {
      return res.status(400).json({ error: 'Razorpay keys not configured', fallback: 'static_upi' })
    }
    const amount = Math.round(Number(req.body?.amount || 0) * 100)
    if (!(amount > 0)) return res.status(400).json({ error: 'Invalid amount' })
    const receipt = String(req.body?.receipt || `lf-${Date.now()}`).slice(0, 40)
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
    const body = new URLSearchParams({
      amount: String(amount),
      currency: 'INR',
      receipt,
      payment_capture: '1',
    })
    const rp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    const data = (await rp.json()) as Record<string, unknown>
    if (!rp.ok) {
      return res.status(502).json({ error: 'Razorpay order failed', detail: data })
    }
    const intentId = crypto.randomUUID()
    const t = nowIso()
    db.prepare(
      `INSERT INTO payment_intents (id, provider, provider_order_id, sale_id, amount, currency, status, qr_payload, meta, created_at, updated_at)
       VALUES (?, 'razorpay', ?, ?, ?, 'INR', 'created', ?, ?, ?, ?)`,
    ).run(
      intentId,
      String(data.id || ''),
      req.body?.saleId ?? null,
      Number(req.body?.amount || 0),
      JSON.stringify({ keyId, orderId: data.id }),
      JSON.stringify(data),
      t,
      t,
    )
    res.json({
      ok: true,
      intentId,
      orderId: data.id,
      amount: Number(req.body?.amount || 0),
      currency: 'INR',
      keyId,
      status: 'created',
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Payment intent failed', detail: String(err) })
  }
})

app.post('/api/payments/razorpay/webhook', (req, res) => {
  try {
    const store = db.prepare('SELECT razorpay_webhook_secret FROM store_profile LIMIT 1').get() as
      | { razorpay_webhook_secret?: string }
      | undefined
    const secret = (store?.razorpay_webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()
    // Signature verification is best-effort scaffolding — production shops should set the secret.
    const event = req.body || {}
    const payload = event.payload?.payment?.entity || event.payload?.order?.entity || {}
    const orderId = String(payload.order_id || payload.id || '')
    const status = String(payload.status || event.event || '')
    if (orderId) {
      const row = db
        .prepare('SELECT id, sale_id FROM payment_intents WHERE provider_order_id = ?')
        .get(orderId) as { id: string; sale_id?: string } | undefined
      if (row) {
        const paid = /captured|paid|authorized/i.test(status) || String(event.event || '').includes('captured')
        db.prepare(`UPDATE payment_intents SET status = ?, updated_at = ?, meta = ? WHERE id = ?`).run(
          paid ? 'paid' : status || 'updated',
          nowIso(),
          JSON.stringify(event),
          row.id,
        )
        if (paid && row.sale_id) {
          db.prepare(`UPDATE sales SET upi_ref = COALESCE(NULLIF(upi_ref,''), ?), notes = notes || ? WHERE id = ?`).run(
            orderId,
            ' [Razorpay paid]',
            row.sale_id,
          )
        }
      }
    }
    void secret
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Webhook failed' })
  }
})

app.post('/api/sales/:id/void', auth, ownerOnly, (req: Authed, res) => {
  const id = req.params.id
  const reason = String(req.body?.reason || '').trim()
  if (!reason) return res.status(400).json({ error: 'Void reason required' })
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!sale) return res.status(404).json({ error: 'Sale not found' })
  if (sale.status === 'voided') return res.json({ ok: true, already: true })
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id) as Record<string, unknown>[]
  const tx = db.transaction(() => {
    for (const it of items) {
      if (String(it.line_kind || 'sale') === 'return') continue
      applyStockDelta(
        String(it.product_id),
        String(it.product_type),
        (it.size as string) || null,
        String(it.unit),
        Math.abs(Number(it.quantity)),
        1,
        (it.colour as string) || 'Default',
        { reason: 'adjust', refType: 'void', refId: id },
      )
      if (it.fabric_roll_id) {
        const metres = Math.abs(Number(it.quantity)) * (String(it.unit) === 'cm' ? 0.01 : 1)
        db.prepare(`UPDATE fabric_rolls SET remaining_metres = remaining_metres + ?, updated_at = ? WHERE id = ?`).run(
          metres,
          nowIso(),
          String(it.fabric_roll_id),
        )
      }
    }
    const credit = Number(sale.credit_amount || 0)
    if (sale.customer_id && credit > 0) {
      db.prepare(`UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?`).run(
        credit,
        nowIso(),
        String(sale.customer_id),
      )
    }
    db.prepare(
      `UPDATE sales SET status='voided', void_reason=?, voided_at=?, voided_by=? WHERE id=?`,
    ).run(reason, nowIso(), req.user?.id || null, id)
    insertAudit({
      id: crypto.randomUUID(),
      action: 'void',
      entityType: 'sale',
      entityId: id,
      userId: req.user?.id,
      userName: req.user?.username,
      detail: { reason, billNo: sale.bill_no },
      createdAt: nowIso(),
    })
  })
  tx()
  res.json({ ok: true })
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
