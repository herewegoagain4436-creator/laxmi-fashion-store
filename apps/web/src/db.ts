import Dexie, { type Table } from 'dexie'
import type {
  OutboxItem,
  Product,
  ProductSize,
  Purchase,
  PurchaseItem,
  ReturnItem,
  ReturnRecord,
  Sale,
  SaleItem,
  Snapshot,
  StoreProfile,
  Supplier,
  User,
} from './types'

export type LocalUser = User & { passwordHash?: string }

export type Meta = { key: string; value: string }

export class LaxmiDB extends Dexie {
  users!: Table<LocalUser, string>
  store!: Table<StoreProfile, string>
  products!: Table<Product, string>
  productSizes!: Table<ProductSize, string>
  suppliers!: Table<Supplier, string>
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
  }
}

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
  return products.map((p) => ({ ...p, sizes: byP.get(p.id) || [] }))
}

export async function applySnapshot(snap: Snapshot) {
  await db.transaction(
    'rw',
    [
      db.store,
      db.users,
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
      if (snap.store) await db.store.put(snap.store)
      for (const u of snap.users) {
        const existing = await db.users.get(u.id)
        await db.users.put({ ...existing, ...u })
      }
      await db.products.clear()
      await db.productSizes.clear()
      for (const p of snap.products) {
        const { sizes, ...rest } = p
        await db.products.put(rest)
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
