import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.LAXMI_DB || path.join(dataDir, 'laxmi.db')
export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export function nowIso() {
  return new Date().toISOString()
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      city TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      unit TEXT NOT NULL,
      selling_price REAL NOT NULL,
      cost_price REAL NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      low_stock_threshold REAL NOT NULL DEFAULT 5,
      fabric_sell_unit TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS product_sizes (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      UNIQUE(product_id, size),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      bill_no TEXT,
      date TEXT NOT NULL,
      total REAL NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT,
      size TEXT,
      quantity REAL NOT NULL,
      unit TEXT,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      bill_no TEXT NOT NULL,
      datetime TEXT NOT NULL,
      cashier_id TEXT,
      cashier_name TEXT,
      customer_phone TEXT,
      payment_mode TEXT NOT NULL,
      cash_amount REAL NOT NULL DEFAULT 0,
      upi_amount REAL NOT NULL DEFAULT 0,
      card_amount REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_type TEXT NOT NULL,
      sku TEXT,
      size TEXT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      rate REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS returns (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      datetime TEXT NOT NULL,
      reason TEXT,
      refund_amount REAL NOT NULL,
      refund_mode TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      sale_item_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT,
      size TEXT,
      quantity REAL NOT NULL,
      unit TEXT,
      FOREIGN KEY (return_id) REFERENCES returns(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sales_datetime ON sales(datetime);
    CREATE INDEX IF NOT EXISTS idx_sales_bill ON sales(bill_no);
    CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
    CREATE INDEX IF NOT EXISTS idx_sizes_product ON product_sizes(product_id);
  `)
}

export function stockQtyFromLine(unit: string, quantity: number) {
  if (unit === 'cm') return quantity / 100
  return quantity
}

export function applyStockDelta(
  productId: string,
  productType: string,
  size: string | null | undefined,
  unit: string,
  quantity: number,
  direction: 1 | -1,
) {
  const delta = direction * stockQtyFromLine(unit, quantity)
  if (productType === 'garment' && size) {
    const row = db
      .prepare('SELECT id, quantity FROM product_sizes WHERE product_id = ? AND size = ?')
      .get(productId, size) as { id: string; quantity: number } | undefined
    if (row) {
      db.prepare('UPDATE product_sizes SET quantity = quantity + ? WHERE id = ?').run(delta, row.id)
    } else if (delta !== 0) {
      db.prepare(
        'INSERT INTO product_sizes (id, product_id, size, quantity) VALUES (?, ?, ?, ?)',
      ).run(`${productId}-${size}`, productId, size, Math.max(0, delta))
    }
  } else {
    db.prepare(
      'UPDATE products SET quantity = quantity + ?, updated_at = ? WHERE id = ?',
    ).run(delta, nowIso(), productId)
  }
}

export function rowProduct(r: Record<string, unknown>) {
  const sizes = db
    .prepare(
      'SELECT id, product_id as productId, size, quantity FROM product_sizes WHERE product_id = ? ORDER BY size',
    )
    .all(r.id) as Array<{ id: string; productId: string; size: string; quantity: number }>
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    type: r.type,
    unit: r.unit,
    sellingPrice: r.selling_price,
    costPrice: r.cost_price,
    quantity: r.quantity,
    lowStockThreshold: r.low_stock_threshold,
    fabricSellUnit: r.fabric_sell_unit,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    sizes,
  }
}

export function getSnapshot() {
  const store = db.prepare('SELECT * FROM store_profile LIMIT 1').get() as Record<string, unknown> | undefined
  const users = db
    .prepare('SELECT id, username, role, name, created_at as createdAt FROM users')
    .all()
  const products = (db.prepare('SELECT * FROM products').all() as Record<string, unknown>[]).map(rowProduct)
  const suppliers = db
    .prepare(
      `SELECT id, name, phone, address, notes,
              created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
       FROM suppliers`,
    )
    .all()
  const purchases = db
    .prepare(
      `SELECT id, supplier_id as supplierId, bill_no as billNo, date, total, notes,
              created_by as createdBy, created_at as createdAt
       FROM purchases ORDER BY datetime(created_at) DESC`,
    )
    .all()
  const purchaseItems = db
    .prepare(
      `SELECT id, purchase_id as purchaseId, product_id as productId, product_name as productName,
              size, quantity, unit, unit_cost as unitCost, line_total as lineTotal
       FROM purchase_items`,
    )
    .all()
  const sales = db
    .prepare(
      `SELECT id, bill_no as billNo, datetime, cashier_id as cashierId, cashier_name as cashierName,
              customer_phone as customerPhone, payment_mode as paymentMode,
              cash_amount as cashAmount, upi_amount as upiAmount, card_amount as cardAmount,
              discount, grand_total as grandTotal, status, notes, created_at as createdAt
       FROM sales ORDER BY datetime DESC`,
    )
    .all()
  const saleItems = db
    .prepare(
      `SELECT id, sale_id as saleId, product_id as productId, product_name as productName,
              product_type as productType, sku, size, quantity, unit, rate, line_total as lineTotal
       FROM sale_items`,
    )
    .all()
  const returns = db
    .prepare(
      `SELECT id, sale_id as saleId, datetime, reason, refund_amount as refundAmount,
              refund_mode as refundMode, created_by as createdBy, created_at as createdAt
       FROM returns ORDER BY datetime DESC`,
    )
    .all()
  const returnItems = db
    .prepare(
      `SELECT id, return_id as returnId, sale_item_id as saleItemId, product_id as productId,
              product_name as productName, size, quantity, unit
       FROM return_items`,
    )
    .all()

  return {
    store: store
      ? {
          id: store.id,
          name: store.name,
          address: store.address,
          phone: store.phone,
          city: store.city,
          updatedAt: store.updated_at,
        }
      : null,
    users,
    products,
    suppliers,
    purchases,
    purchaseItems,
    sales,
    saleItems,
    returns,
    returnItems,
    serverTime: nowIso(),
  }
}
