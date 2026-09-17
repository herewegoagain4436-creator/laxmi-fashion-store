import Dexie, { type Table } from 'dexie'
import {
  DEFAULT_PRICING_SETTINGS,
  defaultCategoryIdForType,
  defaultSeedCategories,
  normalizeCategory,
  normalizeProductPrices,
  normalizePricingSettings,
  rulesFromCategory,
} from './lib/pricing'
import { makeVariantBarcode, makeVariantId, normalizeColour, normalizeVariant } from './lib/variants'
import { normalizeGstSettings } from './lib/gst'
import type {
  AuditLogEntry,
  Category,
  CategoryPricingRules,
  Customer,
  CustomerPayment,
  FabricRoll,
  HeldBill,
  OutboxItem,
  Product,
  ProductSize,
  ProductType,
  Purchase,
  PurchaseItem,
  ReturnItem,
  ReturnRecord,
  Sale,
  SaleItem,
  Snapshot,
  StockLedgerEntry,
  StoreProfile,
  User,
} from './types'
import { DEFAULT_COLOUR, DEFAULT_GST_SETTINGS, DEFAULT_REMNANT_THRESHOLD } from './types'

export type LocalUser = User & { passwordHash?: string }

export type Meta = { key: string; value: string }

const STORE_SCHEMA_V3 = {
  users: 'id, username, role',
  store: 'id',
  categories: 'id, baseType, name, sortOrder, active, deletedAt',
  products: 'id, sku, type, categoryId, name, updatedAt, deletedAt',
  productSizes: 'id, productId, [productId+size]',
  suppliers: 'id, name',
  purchases: 'id, date, supplierId, createdAt',
  purchaseItems: 'id, purchaseId, productId',
  sales: 'id, billNo, datetime, status',
  saleItems: 'id, saleId, productId',
  returns: 'id, saleId, datetime',
  returnItems: 'id, returnId, saleItemId',
  outbox: '++localId, id, type, createdAt, synced',
  meta: 'key',
} as const

const STORE_SCHEMA = {
  ...STORE_SCHEMA_V3,
  productSizes: 'id, productId, colour, barcode, [productId+colour+size]',
  heldBills: 'id, createdAt, cashierId',
  stockLedger: 'id, productId, createdAt, refId, reason',
} as const

export class LaxmiDB extends Dexie {
  users!: Table<LocalUser, string>
  store!: Table<StoreProfile, string>
  categories!: Table<Category, string>
  products!: Table<Product, string>
  productSizes!: Table<ProductSize, string>
  suppliers!: Table<SupplierLike, string>
  purchases!: Table<Purchase, string>
  purchaseItems!: Table<PurchaseItem, string>
  sales!: Table<Sale, string>
  saleItems!: Table<SaleItem, string>
  returns!: Table<ReturnRecord, string>
  returnItems!: Table<ReturnItem, string>
  outbox!: Table<OutboxItem, number>
  meta!: Table<Meta, string>
  heldBills!: Table<HeldBill, string>
  stockLedger!: Table<StockLedgerEntry, string>
  customers!: Table<Customer, string>
  customerPayments!: Table<CustomerPayment, string>
  fabricRolls!: Table<FabricRoll, string>
  auditLog!: Table<AuditLogEntry, string>

  constructor() {
    super('laxmi-fashion-v1')
    this.version(1).stores({
      users: 'id, username, role',
      store: 'id',
      products: 'id, sku, type, name, updatedAt, deletedAt',
      productSizes: 'id, productId, [productId+size]',
      suppliers: 'id, name',
      purchases: 'id, date, supplierId, createdAt',
      purchaseItems: 'id, purchaseId, productId',
      sales: 'id, billNo, datetime, status',
      saleItems: 'id, saleId, productId',
      returns: 'id, saleId, datetime',
      returnItems: 'id, returnId, saleItemId',
      outbox: '++localId, id, type, createdAt, synced',
      meta: 'key',
    })
    this.version(2)
      .stores({
        users: 'id, username, role',
        store: 'id',
        products: 'id, sku, type, name, updatedAt, deletedAt',
        productSizes: 'id, productId, [productId+size]',
        suppliers: 'id, name',
        purchases: 'id, date, supplierId, createdAt',
        purchaseItems: 'id, purchaseId, productId',
        sales: 'id, billNo, datetime, status',
        saleItems: 'id, saleId, productId',
        returns: 'id, saleId, datetime',
        returnItems: 'id, returnId, saleItemId',
        outbox: '++localId, id, type, createdAt, synced',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('products')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const n = normalizeProductPrices(p)
            Object.assign(p, n)
          })
        await tx
          .table('store')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (!s.pricingSettings) s.pricingSettings = DEFAULT_PRICING_SETTINGS
            else s.pricingSettings = normalizePricingSettings(s.pricingSettings as never)
          })
      })
    this.version(3)
      .stores({ ...STORE_SCHEMA_V3 })
      .upgrade(async (tx) => {
        const catsTable = tx.table('categories')
        const existing = await catsTable.count()
        const now = new Date().toISOString()
        if (existing === 0) {
          const store = (await tx.table('store').get('store-1')) as StoreProfile | undefined
          const ps = normalizePricingSettings(store?.pricingSettings)
          const seeds = defaultSeedCategories(now).map((c) => {
            const rules = ps[c.baseType] || c
            return {
              ...c,
              wholesaleMarkupPct: rules.wholesaleMarkupPct,
              mrpMarkupPct: rules.mrpMarkupPct,
              saleDiscountFromMrpPct: rules.saleDiscountFromMrpPct,
            }
          })
          await catsTable.bulkPut(seeds)
        }
        await tx
          .table('products')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (!p.categoryId) {
              p.categoryId = defaultCategoryIdForType((p.type as ProductType) || 'garment')
            }
            const n = normalizeProductPrices(p)
            Object.assign(p, n)
          })
      })
    this.version(4)
      .stores({ ...STORE_SCHEMA })
      .upgrade(async (tx) => {
        const products = await tx.table('products').toArray()
        const skuById = new Map<string, string>()
        for (const p of products as Product[]) skuById.set(p.id, p.sku || p.id)
        await tx
          .table('productSizes')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const colour = normalizeColour(row.colour as string)
            const size = String(row.size || 'Free size')
            const productId = String(row.productId)
            row.colour = colour
            if (!row.barcode) {
              row.barcode = makeVariantBarcode(skuById.get(productId) || productId, colour, size)
            }
            if (!row.variantSku) {
              row.variantSku = `${skuById.get(productId) || productId}-${colour.slice(0, 4)}-${size}`.toUpperCase()
            }
            // Keep id stable if possible; rewrite if old size-only id
            if (!String(row.id).includes(colour) && colour !== DEFAULT_COLOUR) {
              row.id = makeVariantId(productId, colour, size)
            } else if (!row.id) {
              row.id = makeVariantId(productId, colour, size)
            }
          })
        await tx
          .table('store')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (!s.gstSettings) s.gstSettings = DEFAULT_GST_SETTINGS
            else s.gstSettings = normalizeGstSettings(s.gstSettings as never)
            if (s.maxCashierDiscount == null) s.maxCashierDiscount = 100
            if (s.maxCashierDiscountPct == null) s.maxCashierDiscountPct = 5
            if (s.upiVpa == null) s.upiVpa = ''
            if (s.barcodePrefix == null) s.barcodePrefix = ''
            if (s.remnantThreshold == null) s.remnantThreshold = DEFAULT_REMNANT_THRESHOLD
            if (s.razorpayKeyId == null) s.razorpayKeyId = ''
            if (s.razorpayKeySecret == null) s.razorpayKeySecret = ''
            if (s.razorpayWebhookSecret == null) s.razorpayWebhookSecret = ''
          })
      })
    this.version(5)
      .stores({
        ...STORE_SCHEMA,
        customers: 'id, phone, name, balance, updatedAt, deletedAt',
        customerPayments: 'id, customerId, createdAt, saleId',
        fabricRolls: 'id, productId, shade, lot, remainingMetres, updatedAt, deletedAt',
        auditLog: 'id, action, entityType, entityId, createdAt, userId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('store')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.remnantThreshold == null) s.remnantThreshold = DEFAULT_REMNANT_THRESHOLD
            if (s.razorpayKeyId == null) s.razorpayKeyId = ''
            if (s.razorpayKeySecret == null) s.razorpayKeySecret = ''
            if (s.razorpayWebhookSecret == null) s.razorpayWebhookSecret = ''
          })
        await tx
          .table('sales')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.creditAmount == null) s.creditAmount = 0
            if (s.customerId == null) s.customerId = null
          })
      })
  }
}

type SupplierLike = import('./types').Supplier

export const db = new LaxmiDB()

export async function productsWithSizes() {
  const products = await db.products.filter((p) => !p.deletedAt).toArray()
  const sizes = await db.productSizes.toArray()
  const byP = new Map<string, ProductSize[]>()
  for (const s of sizes) {
    const arr = byP.get(s.productId) || []
    arr.push(s)
    byP.set(s.productId, arr)
  }
  return products.map((p) => {
    const n = normalizeProductPrices(p as unknown as Record<string, unknown>)
    const categoryId = p.categoryId || defaultCategoryIdForType(p.type)
    const sizes = (byP.get(p.id) || []).map((sz) =>
      normalizeVariant({ ...sz, productId: p.id, size: sz.size || 'Free size' }),
    )
    return { ...n, categoryId, sizes } as Product
  })
}

export async function getPricingSettings() {
  const store = await db.store.get('store-1')
  return normalizePricingSettings(store?.pricingSettings)
}

export async function getActiveCategories() {
  await ensureLocalCategories()
  const all = await db.categories.toArray()
  return all
    .filter((c) => c.active !== false && !c.deletedAt)
    .map(normalizeCategory)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export async function getAllCategories() {
  await ensureLocalCategories()
  const all = await db.categories.toArray()
  return all
    .filter((c) => !c.deletedAt)
    .map(normalizeCategory)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export async function getCategoryById(id: string | undefined | null) {
  if (!id) return undefined
  await ensureLocalCategories()
  const c = await db.categories.get(id)
  return c ? normalizeCategory(c) : undefined
}

/** Rules for a product: prefer its category, else type-level store settings. */
export async function getRulesForProduct(product: {
  categoryId?: string
  type: ProductType
}): Promise<CategoryPricingRules> {
  if (product.categoryId) {
    const cat = await getCategoryById(product.categoryId)
    if (cat) return rulesFromCategory(cat)
  }
  const settings = await getPricingSettings()
  return settings[product.type] || settings.garment
}

async function ensureLocalCategories() {
  const n = await db.categories.count()
  if (n > 0) return
  const now = new Date().toISOString()
  const store = await db.store.get('store-1')
  const ps = normalizePricingSettings(store?.pricingSettings)
  const seeds = defaultSeedCategories(now).map((c) => ({
    ...c,
    wholesaleMarkupPct: ps[c.baseType].wholesaleMarkupPct,
    mrpMarkupPct: ps[c.baseType].mrpMarkupPct,
    saleDiscountFromMrpPct: ps[c.baseType].saleDiscountFromMrpPct,
  }))
  await db.categories.bulkPut(seeds)
}

export async function applySnapshot(snap: Snapshot) {
  await db.transaction(
    'rw',
    [
      db.store,
      db.users,
      db.categories,
      db.products,
      db.productSizes,
      db.suppliers,
      db.purchases,
      db.purchaseItems,
      db.sales,
      db.saleItems,
      db.returns,
      db.returnItems,
      db.meta,
      db.heldBills,
      db.stockLedger,
      db.customers,
      db.customerPayments,
      db.fabricRolls,
      db.auditLog,
    ],
    async () => {
      if (snap.store) {
        await db.store.put({
          ...snap.store,
          pricingSettings: normalizePricingSettings(snap.store.pricingSettings),
          gstSettings: normalizeGstSettings(snap.store.gstSettings),
          maxCashierDiscount: snap.store.maxCashierDiscount ?? 100,
          maxCashierDiscountPct: snap.store.maxCashierDiscountPct ?? 5,
          upiVpa: snap.store.upiVpa || '',
          barcodePrefix: snap.store.barcodePrefix || '',
          gstin: snap.store.gstin || '',
          remnantThreshold: snap.store.remnantThreshold ?? DEFAULT_REMNANT_THRESHOLD,
          razorpayKeyId: snap.store.razorpayKeyId || '',
          razorpayKeySecret: snap.store.razorpayKeySecret || '',
          razorpayWebhookSecret: snap.store.razorpayWebhookSecret || '',
        })
      }
      for (const u of snap.users) {
        const existing = await db.users.get(u.id)
        await db.users.put({ ...existing, ...u })
      }
      await db.categories.clear()
      const cats = (snap.categories || []).map((c) => normalizeCategory(c))
      if (cats.length) await db.categories.bulkPut(cats)
      else await db.categories.bulkPut(defaultSeedCategories())

      await db.products.clear()
      await db.productSizes.clear()
      for (const p of snap.products) {
        const { sizes, ...rest } = normalizeProductPrices(p as unknown as Record<string, unknown>) as Product & {
          sizes?: ProductSize[]
        }
        const categoryId =
          rest.categoryId || defaultCategoryIdForType((rest.type as ProductType) || 'garment')
        await db.products.put({ ...rest, categoryId })
        if (sizes?.length) {
          await db.productSizes.bulkPut(
            sizes.map((sz) =>
              normalizeVariant({
                ...sz,
                productId: rest.id,
                size: sz.size || (rest.type === 'garment' ? 'Free size' : 'Free size'),
                colour: sz.colour,
              }),
            ),
          )
        }
      }
      await db.suppliers.clear()
      if (snap.suppliers.length) await db.suppliers.bulkPut(snap.suppliers)
      await db.purchases.clear()
      await db.purchaseItems.clear()
      if (snap.purchases.length) await db.purchases.bulkPut(snap.purchases)
      if (snap.purchaseItems.length) await db.purchaseItems.bulkPut(snap.purchaseItems)
      await db.sales.clear()
      await db.saleItems.clear()
      if (snap.sales.length) await db.sales.bulkPut(snap.sales)
      if (snap.saleItems.length) await db.saleItems.bulkPut(snap.saleItems)
      await db.returns.clear()
      await db.returnItems.clear()
      if (snap.returns.length) await db.returns.bulkPut(snap.returns)
      if (snap.returnItems.length) await db.returnItems.bulkPut(snap.returnItems)
      await db.customers.clear()
      if (snap.customers?.length) await db.customers.bulkPut(snap.customers)
      await db.customerPayments.clear()
      if (snap.customerPayments?.length) await db.customerPayments.bulkPut(snap.customerPayments)
      await db.fabricRolls.clear()
      if (snap.fabricRolls?.length) await db.fabricRolls.bulkPut(snap.fabricRolls)
      // Audit is append-friendly: merge by id rather than wipe history on pull
      if (snap.auditLog?.length) await db.auditLog.bulkPut(snap.auditLog)
      await db.meta.put({ key: 'lastPull', value: snap.serverTime })
    },
  )
}

export async function seedLocalIfEmpty() {
  const { seedCatalogIfEmpty } = await import('./seedCatalog')
  await seedCatalogIfEmpty()
  await ensureLocalCategories()
  const count = await db.users.count()
  if (count > 0) return
  const { passwordHash } = await import('./lib/ids')
  const t = new Date().toISOString()
  await db.users.bulkPut([
    {
      id: 'user-owner',
      username: 'owner',
      role: 'owner',
      name: 'Store Owner',
      passwordHash: await passwordHash('owner123'),
    },
    {
      id: 'user-cashier',
      username: 'cashier',
      role: 'cashier',
      name: 'Counter Cashier',
      passwordHash: await passwordHash('cashier123'),
    },
  ])
  await db.store.put({
    id: 'store-1',
    name: 'Laxmi Fashion Wholesale Mart',
    address: 'Shop 14, Textile Market',
    phone: '9876500000',
    city: 'Surat',
    updatedAt: t,
    pricingSettings: DEFAULT_PRICING_SETTINGS,
    gstSettings: DEFAULT_GST_SETTINGS,
    upiVpa: '',
    barcodePrefix: '',
    gstin: '',
    maxCashierDiscount: 100,
    maxCashierDiscountPct: 5,
    remnantThreshold: DEFAULT_REMNANT_THRESHOLD,
    razorpayKeyId: '',
    razorpayKeySecret: '',
    razorpayWebhookSecret: '',
  })
}

/** Apply local stock delta for a variant (colour×size) or product qty. Writes ledger. */
export async function applyLocalStockDelta(opts: {
  productId: string
  productType: ProductType
  colour?: string | null
  size?: string | null
  unit: string
  quantity: number
  direction: 1 | -1
  reason: StockLedgerEntry['reason']
  refType: string
  refId: string
}) {
  const deltaBase = opts.unit === 'cm' ? opts.quantity / 100 : opts.quantity
  const delta = opts.direction * deltaBase
  const t = new Date().toISOString()
  const colour = normalizeColour(opts.colour)
  const size = opts.size || ''
  if (opts.productType === 'garment' && size) {
    let row = await db.productSizes.where({ productId: opts.productId }).filter((r) => normalizeColour(r.colour) === colour && r.size === size).first()
    if (!row) {
      // fallback size-only legacy
      row = await db.productSizes.where({ productId: opts.productId, size }).first()
    }
    if (row) {
      await db.productSizes.update(row.id, { quantity: Number(row.quantity) + delta })
    } else {
      const id = makeVariantId(opts.productId, colour, size)
      await db.productSizes.put({
        id,
        productId: opts.productId,
        colour,
        size,
        quantity: Math.max(0, delta),
        barcode: null,
        variantSku: null,
      })
    }
  } else {
    const p = await db.products.get(opts.productId)
    if (p) await db.products.update(opts.productId, { quantity: Number(p.quantity) + delta, updatedAt: t })
  }
  const ledger: StockLedgerEntry = {
    id: crypto.randomUUID(),
    productId: opts.productId,
    colour,
    size,
    delta,
    unit: opts.unit,
    reason: opts.reason,
    refType: opts.refType,
    refId: opts.refId,
    createdAt: t,
  }
  await db.stockLedger.put(ledger)
  return ledger
}

export async function enqueue(type: OutboxItem['type'], payload: unknown, id?: string) {
  const item: OutboxItem = {
    id: id || crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    synced: 0,
    tries: 0,
  }
  await db.outbox.add(item)
}

export async function pendingCount() {
  return db.outbox.where('synced').equals(0).count()
}

/** Deduct metres from a fabric roll; also updates product.quantity. */
export async function consumeFabricRoll(opts: {
  rollId: string
  metres: number
  refType: string
  refId: string
}) {
  const roll = await db.fabricRolls.get(opts.rollId)
  if (!roll) throw new Error('Fabric roll not found')
  const metres = Number(opts.metres) || 0
  if (metres <= 0) return roll
  const remaining = Math.round((Number(roll.remainingMetres) - metres) * 1000) / 1000
  const t = new Date().toISOString()
  await db.fabricRolls.update(opts.rollId, {
    remainingMetres: remaining,
    updatedAt: t,
  })
  const p = await db.products.get(roll.productId)
  if (p) {
    await db.products.update(roll.productId, {
      quantity: Math.max(0, Number(p.quantity) - metres),
      updatedAt: t,
    })
  }
  await db.stockLedger.put({
    id: crypto.randomUUID(),
    productId: roll.productId,
    colour: roll.shade || DEFAULT_COLOUR,
    size: `ROLL:${roll.width}`,
    delta: -metres,
    unit: 'metre',
    reason: 'sale',
    refType: opts.refType,
    refId: opts.refId,
    createdAt: t,
  })
  // Sale sync owns server-side roll delta — do not enqueue here (avoids double-decrement).
  return { ...roll, remainingMetres: remaining, updatedAt: t }
}

export async function productsWithRolls() {
  const products = await productsWithSizes()
  const rolls = await db.fabricRolls.filter((r) => !r.deletedAt).toArray()
  const byP = new Map<string, FabricRoll[]>()
  for (const r of rolls) {
    const arr = byP.get(r.productId) || []
    arr.push(r)
    byP.set(r.productId, arr)
  }
  return products.map((p) => ({ ...p, rolls: byP.get(p.id) || [] }))
}
