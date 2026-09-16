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
import type {
  Category,
  CategoryPricingRules,
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
  StoreProfile,
  User,
} from './types'

export type LocalUser = User & { passwordHash?: string }

export type Meta = { key: string; value: string }

const STORE_SCHEMA = {
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
      .stores({ ...STORE_SCHEMA })
      .upgrade(async (tx) => {
        const catsTable = tx.table('categories')
        const existing = await catsTable.count()
        const now = new Date().toISOString()
        if (existing === 0) {
          // Copy pricing from store if available
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
    return { ...n, categoryId, sizes: byP.get(p.id) || [] } as Product
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
    ],
    async () => {
      if (snap.store) {
        await db.store.put({
          ...snap.store,
          pricingSettings: normalizePricingSettings(snap.store.pricingSettings),
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
        if (sizes?.length) await db.productSizes.bulkPut(sizes)
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
  })
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
