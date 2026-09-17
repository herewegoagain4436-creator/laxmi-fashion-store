import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Prefer LAXMI_DATA_DIR (cloud/Docker volume); LAXMI_DB overrides full file path. */
export const dataDir =
  process.env.LAXMI_DATA_DIR ||
  process.env.LAXMI_DB_DIR ||
  path.join(__dirname, '..', 'data')

const dbPath = process.env.LAXMI_DB || path.join(dataDir, 'laxmi.db')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export function nowIso() {
  return new Date().toISOString()
}

const DEFAULT_CATEGORY_RULES = {
  wholesaleMarkupPct: 20,
  mrpMarkupPct: 100,
  saleDiscountFromMrpPct: 20,
}

export const DEFAULT_CATEGORY_IDS = {
  garment: 'cat-garment',
  saree: 'cat-saree',
  fabric: 'cat-fabric',
} as const

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
      pricing_settings TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      base_type TEXT NOT NULL,
      wholesale_markup_pct REAL NOT NULL DEFAULT 20,
      mrp_markup_pct REAL NOT NULL DEFAULT 100,
      sale_discount_from_mrp_pct REAL NOT NULL DEFAULT 20,
      sort_order INTEGER NOT NULL DEFAULT 100,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
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
    CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(active);
  `)
  ensureFourPriceColumns()
  ensureCategories()
  ensureV12Columns()
  ensureV13Columns()
}

function tableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map((r) => r.name))
}

/** Add wholesale_price / mrp / pricing_settings and backfill from cost. */
function ensureFourPriceColumns() {
  const productCols = tableColumns('products')
  if (!productCols.has('wholesale_price')) {
    db.exec('ALTER TABLE products ADD COLUMN wholesale_price REAL')
  }
  if (!productCols.has('mrp')) {
    db.exec('ALTER TABLE products ADD COLUMN mrp REAL')
  }
  // Backfill only where null
  db.exec(`
    UPDATE products
    SET wholesale_price = ROUND(cost_price * 1.2, 2)
    WHERE wholesale_price IS NULL
  `)
  db.exec(`
    UPDATE products
    SET mrp = ROUND(cost_price * 2.0, 2)
    WHERE mrp IS NULL
  `)

  const storeCols = tableColumns('store_profile')
  if (!storeCols.has('pricing_settings')) {
    db.exec('ALTER TABLE store_profile ADD COLUMN pricing_settings TEXT')
  }
  const defaultPricing = JSON.stringify({
    garment: { ...DEFAULT_CATEGORY_RULES },
    saree: { ...DEFAULT_CATEGORY_RULES },
    fabric: { ...DEFAULT_CATEGORY_RULES },
  })
  db.prepare(
    `UPDATE store_profile SET pricing_settings = ? WHERE pricing_settings IS NULL OR pricing_settings = ''`,
  ).run(defaultPricing)
}

/** Seed default categories and backfill products.category_id from type. */
function ensureCategories() {
  const productCols = tableColumns('products')
  if (!productCols.has('category_id')) {
    db.exec('ALTER TABLE products ADD COLUMN category_id TEXT')
  }

  const count = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c
  if (count === 0) {
    const t = nowIso()
    // Prefer store pricing_settings if present
    let rules = {
      garment: { ...DEFAULT_CATEGORY_RULES },
      saree: { ...DEFAULT_CATEGORY_RULES },
      fabric: { ...DEFAULT_CATEGORY_RULES },
    }
    try {
      const store = db.prepare('SELECT pricing_settings FROM store_profile LIMIT 1').get() as
        | { pricing_settings?: string }
        | undefined
      if (store?.pricing_settings) {
        const parsed = JSON.parse(store.pricing_settings)
        rules = {
          garment: { ...DEFAULT_CATEGORY_RULES, ...(parsed.garment || {}) },
          saree: { ...DEFAULT_CATEGORY_RULES, ...(parsed.saree || {}) },
          fabric: { ...DEFAULT_CATEGORY_RULES, ...(parsed.fabric || {}) },
        }
      }
    } catch {
      /* keep defaults */
    }

    const ins = db.prepare(
      `INSERT INTO categories
        (id, name, slug, base_type, wholesale_markup_pct, mrp_markup_pct, sale_discount_from_mrp_pct,
         sort_order, active, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
    )
    const seeds: Array<{
      id: string
      name: string
      slug: string
      base: 'garment' | 'saree' | 'fabric'
      sort: number
    }> = [
      {
        id: DEFAULT_CATEGORY_IDS.garment,
        name: 'Ready-made / Garment',
        slug: 'ready-made-garment',
        base: 'garment',
        sort: 10,
      },
      {
        id: DEFAULT_CATEGORY_IDS.saree,
        name: 'Saree',
        slug: 'saree',
        base: 'saree',
        sort: 20,
      },
      {
        id: DEFAULT_CATEGORY_IDS.fabric,
        name: 'Than / Fabric',
        slug: 'than-fabric',
        base: 'fabric',
        sort: 30,
      },
    ]
    for (const s of seeds) {
      const r = rules[s.base]
      ins.run(
        s.id,
        s.name,
        s.slug,
        s.base,
        r.wholesaleMarkupPct,
        r.mrpMarkupPct,
        r.saleDiscountFromMrpPct,
        s.sort,
        t,
        t,
      )
    }
  }

  // Backfill products missing category_id from type
  db.prepare(
    `UPDATE products SET category_id = ? WHERE (category_id IS NULL OR category_id = '') AND type = 'garment'`,
  ).run(DEFAULT_CATEGORY_IDS.garment)
  db.prepare(
    `UPDATE products SET category_id = ? WHERE (category_id IS NULL OR category_id = '') AND type = 'saree'`,
  ).run(DEFAULT_CATEGORY_IDS.saree)
  db.prepare(
    `UPDATE products SET category_id = ? WHERE (category_id IS NULL OR category_id = '') AND type = 'fabric'`,
  ).run(DEFAULT_CATEGORY_IDS.fabric)
  db.prepare(
    `UPDATE products SET category_id = ? WHERE (category_id IS NULL OR category_id = '')`,
  ).run(DEFAULT_CATEGORY_IDS.garment)

  db.exec('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)')
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
  colour: string | null | undefined = 'Default',
  meta?: { reason?: string; refType?: string; refId?: string },
) {
  const delta = direction * stockQtyFromLine(unit, quantity)
  const col = (colour && String(colour).trim()) || 'Default'
  if (productType === 'garment' && size) {
    let row = db
      .prepare('SELECT id, quantity FROM product_sizes WHERE product_id = ? AND colour = ? AND size = ?')
      .get(productId, col, size) as { id: string; quantity: number } | undefined
    if (!row) {
      row = db
        .prepare('SELECT id, quantity FROM product_sizes WHERE product_id = ? AND size = ?')
        .get(productId, size) as { id: string; quantity: number } | undefined
    }
    if (row) {
      db.prepare('UPDATE product_sizes SET quantity = quantity + ? WHERE id = ?').run(delta, row.id)
    } else if (delta !== 0) {
      db.prepare(
        'INSERT INTO product_sizes (id, product_id, size, colour, quantity) VALUES (?, ?, ?, ?, ?)',
      ).run(`${productId}-${col}-${size}`, productId, size, col, Math.max(0, delta))
    }
  } else {
    db.prepare(
      'UPDATE products SET quantity = quantity + ?, updated_at = ? WHERE id = ?',
    ).run(delta, nowIso(), productId)
  }
  if (meta?.refId) {
    db.prepare(
      `INSERT OR IGNORE INTO stock_ledger
        (id, product_id, colour, size, delta, unit, reason, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      meta.refId + ':' + productId + ':' + col + ':' + (size || '') + ':' + String(delta),
      productId,
      col,
      size || '',
      delta,
      unit,
      meta.reason || 'adjust',
      meta.refType || '',
      meta.refId,
      nowIso(),
    )
  }
}

export function rowCategory(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    baseType: r.base_type,
    wholesaleMarkupPct: Number(r.wholesale_markup_pct),
    mrpMarkupPct: Number(r.mrp_markup_pct),
    saleDiscountFromMrpPct: Number(r.sale_discount_from_mrp_pct),
    sortOrder: Number(r.sort_order),
    active: Number(r.active) === 1 && !r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }
}

export function rowProduct(r: Record<string, unknown>) {
  const sizes = db
    .prepare(
      `SELECT id, product_id as productId, size, quantity,
              COALESCE(colour, 'Default') as colour, barcode, variant_sku as variantSku
       FROM product_sizes WHERE product_id = ? ORDER BY colour, size`,
    )
    .all(r.id) as Array<{
      id: string
      productId: string
      size: string
      quantity: number
      colour: string
      barcode: string | null
      variantSku: string | null
    }>
  const cost = Number(r.cost_price) || 0
  const sale = Number(r.selling_price) || 0
  const wholesale =
    r.wholesale_price != null && Number.isFinite(Number(r.wholesale_price))
      ? Number(r.wholesale_price)
      : Math.round(cost * 1.2 * 100) / 100
  const mrp =
    r.mrp != null && Number.isFinite(Number(r.mrp))
      ? Number(r.mrp)
      : Math.round(cost * 2 * 100) / 100
  const type = String(r.type || 'garment')
  let categoryId = r.category_id ? String(r.category_id) : ''
  if (!categoryId) {
    categoryId =
      type === 'saree'
        ? DEFAULT_CATEGORY_IDS.saree
        : type === 'fabric'
          ? DEFAULT_CATEGORY_IDS.fabric
          : DEFAULT_CATEGORY_IDS.garment
  }
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    type,
    categoryId,
    unit: r.unit,
    sellingPrice: sale,
    salePrice: sale,
    costPrice: cost,
    purchasePrice: cost,
    wholesalePrice: wholesale,
    mrp,
    quantity: r.quantity,
    lowStockThreshold: r.low_stock_threshold,
    fabricSellUnit: r.fabric_sell_unit,
    shade: r.shade ?? null,
    fabricWidth: r.fabric_width ?? null,
    remnantThreshold: r.remnant_threshold != null ? Number(r.remnant_threshold) : null,
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
  const categories = (db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as Record<
    string,
    unknown
  >[]).map(rowCategory)
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
              size, COALESCE(colour, 'Default') as colour, quantity, unit,
              unit_cost as unitCost, line_total as lineTotal,
              fabric_width as fabricWidth, shade, lot, fabric_roll_id as fabricRollId
       FROM purchase_items`,
    )
    .all()
  const sales = db
    .prepare(
      `SELECT id, bill_no as billNo, datetime, cashier_id as cashierId, cashier_name as cashierName,
              customer_phone as customerPhone, payment_mode as paymentMode,
              cash_amount as cashAmount, upi_amount as upiAmount, card_amount as cardAmount,
              discount, grand_total as grandTotal, status, notes, created_at as createdAt,
              COALESCE(price_channel, 'retail') as priceChannel,
              customer_gstin as customerGstin, upi_ref as upiRef,
              COALESCE(taxable_total, 0) as taxableTotal, COALESCE(gst_total, 0) as gstTotal,
              exchange_of_sale_id as exchangeOfSaleId,
              customer_id as customerId, COALESCE(credit_amount, 0) as creditAmount,
              void_reason as voidReason, voided_at as voidedAt, voided_by as voidedBy
       FROM sales ORDER BY datetime DESC`,
    )
    .all()
  const saleItems = db
    .prepare(
      `SELECT id, sale_id as saleId, product_id as productId, product_name as productName,
              product_type as productType, sku, size, quantity, unit, rate, line_total as lineTotal,
              COALESCE(colour, 'Default') as colour, shade, barcode, mrp,
              gst_rate as gstRate, taxable_amount as taxableAmount,
              cgst_amount as cgstAmount, sgst_amount as sgstAmount,
              COALESCE(line_kind, 'sale') as lineKind,
              return_of_sale_item_id as returnOfSaleItemId,
              fabric_roll_id as fabricRollId, fabric_width as fabricWidth
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
              product_name as productName, size, COALESCE(colour, 'Default') as colour,
              quantity, unit
       FROM return_items`,
    )
    .all()
  const customers = db
    .prepare(
      `SELECT id, phone, name, gstin, balance, notes,
              created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
       FROM customers`,
    )
    .all()
  const customerPayments = db
    .prepare(
      `SELECT id, customer_id as customerId, amount, mode, sale_id as saleId, notes,
              created_at as createdAt, created_by as createdBy
       FROM customer_payments ORDER BY datetime(created_at) DESC`,
    )
    .all()
  const fabricRolls = db
    .prepare(
      `SELECT id, product_id as productId, width, shade, lot,
              remaining_metres as remainingMetres, initial_metres as initialMetres,
              remnant_threshold as remnantThreshold, barcode,
              purchase_id as purchaseId, purchase_item_id as purchaseItemId,
              created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
       FROM fabric_rolls`,
    )
    .all()
  const auditLog = db
    .prepare(
      `SELECT id, action, entity_type as entityType, entity_id as entityId,
              user_id as userId, user_name as userName, detail, created_at as createdAt
       FROM audit_log ORDER BY datetime(created_at) DESC LIMIT 2000`,
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
          pricingSettings: (() => {
            try {
              return store.pricing_settings
                ? JSON.parse(String(store.pricing_settings))
                : undefined
            } catch {
              return undefined
            }
          })(),
          upiVpa: store.upi_vpa != null ? String(store.upi_vpa) : '',
          gstin: store.gstin != null ? String(store.gstin) : '',
          gstSettings: (() => {
            try {
              return store.gst_settings
                ? JSON.parse(String(store.gst_settings))
                : undefined
            } catch {
              return undefined
            }
          })(),
          maxCashierDiscount:
            store.max_cashier_discount != null ? Number(store.max_cashier_discount) : 100,
          maxCashierDiscountPct:
            store.max_cashier_discount_pct != null ? Number(store.max_cashier_discount_pct) : 5,
          barcodePrefix: store.barcode_prefix != null ? String(store.barcode_prefix) : '',
          remnantThreshold:
            store.remnant_threshold != null ? Number(store.remnant_threshold) : 3,
          razorpayKeyId: store.razorpay_key_id != null ? String(store.razorpay_key_id) : '',
          razorpayKeySecret:
            store.razorpay_key_secret != null ? String(store.razorpay_key_secret) : '',
          razorpayWebhookSecret:
            store.razorpay_webhook_secret != null ? String(store.razorpay_webhook_secret) : '',
        }
      : null,
    users,
    categories,
    products,
    suppliers,
    purchases,
    purchaseItems,
    sales,
    saleItems,
    returns,
    returnItems,
    customers,
    customerPayments,
    fabricRolls,
    auditLog,
    serverTime: nowIso(),
  }
}

/** Colour / barcode / GST / UPI / ledger columns for v1.2. */
export function ensureV12Columns() {
  const addCol = (table: string, col: string, ddl: string) => {
    const cols = tableColumns(table)
    if (!cols.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }

  addCol('product_sizes', 'colour', "colour TEXT NOT NULL DEFAULT 'Default'")
  addCol('product_sizes', 'barcode', 'barcode TEXT')
  addCol('product_sizes', 'variant_sku', 'variant_sku TEXT')

  // Rebuild uniqueness is hard in SQLite; keep old UNIQUE(product_id,size) and rely on id PK.
  // Backfill colour
  db.exec(`UPDATE product_sizes SET colour = 'Default' WHERE colour IS NULL OR colour = ''`)

  // Generate barcodes where missing
  const rows = db
    .prepare(
      `SELECT ps.id, ps.product_id, ps.size, ps.colour, ps.barcode, p.sku
       FROM product_sizes ps JOIN products p ON p.id = ps.product_id
       WHERE ps.barcode IS NULL OR ps.barcode = ''`,
    )
    .all() as Array<{ id: string; product_id: string; size: string; colour: string; sku: string }>
  const updBc = db.prepare('UPDATE product_sizes SET barcode = ?, variant_sku = ? WHERE id = ?')
  for (const r of rows) {
    const sku = String(r.sku || 'SKU').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
    const c = String(r.colour || 'Default').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'DEF'
    const s = String(r.size || 'FS').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)
    const barcode = `${sku}-${c}-${s}`
    const variantSku = `${r.sku}-${String(r.colour || 'Default').slice(0, 4)}-${r.size}`.toUpperCase()
    updBc.run(barcode, variantSku, r.id)
  }

  addCol('products', 'shade', 'shade TEXT')

  addCol('purchase_items', 'colour', "colour TEXT DEFAULT 'Default'")

  addCol('sales', 'price_channel', "price_channel TEXT DEFAULT 'retail'")
  addCol('sales', 'customer_gstin', 'customer_gstin TEXT')
  addCol('sales', 'upi_ref', 'upi_ref TEXT')
  addCol('sales', 'taxable_total', 'taxable_total REAL DEFAULT 0')
  addCol('sales', 'gst_total', 'gst_total REAL DEFAULT 0')
  addCol('sales', 'exchange_of_sale_id', 'exchange_of_sale_id TEXT')

  addCol('sale_items', 'colour', "colour TEXT DEFAULT 'Default'")
  addCol('sale_items', 'shade', 'shade TEXT')
  addCol('sale_items', 'barcode', 'barcode TEXT')
  addCol('sale_items', 'mrp', 'mrp REAL')
  addCol('sale_items', 'gst_rate', 'gst_rate REAL')
  addCol('sale_items', 'taxable_amount', 'taxable_amount REAL')
  addCol('sale_items', 'cgst_amount', 'cgst_amount REAL')
  addCol('sale_items', 'sgst_amount', 'sgst_amount REAL')
  addCol('sale_items', 'line_kind', "line_kind TEXT DEFAULT 'sale'")
  addCol('sale_items', 'return_of_sale_item_id', 'return_of_sale_item_id TEXT')

  addCol('return_items', 'colour', "colour TEXT DEFAULT 'Default'")

  addCol('store_profile', 'upi_vpa', 'upi_vpa TEXT')
  addCol('store_profile', 'gstin', 'gstin TEXT')
  addCol('store_profile', 'gst_settings', 'gst_settings TEXT')
  addCol('store_profile', 'max_cashier_discount', 'max_cashier_discount REAL DEFAULT 100')
  addCol('store_profile', 'max_cashier_discount_pct', 'max_cashier_discount_pct REAL DEFAULT 5')
  addCol('store_profile', 'barcode_prefix', 'barcode_prefix TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_ledger (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      colour TEXT NOT NULL DEFAULT 'Default',
      size TEXT NOT NULL DEFAULT '',
      delta REAL NOT NULL,
      unit TEXT,
      reason TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      created_at TEXT NOT NULL,
      device_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_product ON stock_ledger(product_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_ref ON stock_ledger(ref_id);
    CREATE INDEX IF NOT EXISTS idx_sizes_barcode ON product_sizes(barcode);
  `)

  const defaultGst = JSON.stringify({
    apparelThreshold: 2500,
    apparelLowRate: 5,
    apparelHighRate: 18,
    fabricRate: 5,
  })
  db.prepare(
    `UPDATE store_profile SET gst_settings = ? WHERE gst_settings IS NULL OR gst_settings = ''`,
  ).run(defaultGst)
}

/** Customers, fabric rolls, audit, credit, Razorpay — v1.3 */
export function ensureV13Columns() {
  const addCol = (table: string, col: string, ddl: string) => {
    const cols = tableColumns(table)
    if (!cols.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }

  addCol('products', 'fabric_width', 'fabric_width TEXT')
  addCol('products', 'remnant_threshold', 'remnant_threshold REAL')

  addCol('purchase_items', 'fabric_width', 'fabric_width TEXT')
  addCol('purchase_items', 'shade', 'shade TEXT')
  addCol('purchase_items', 'lot', 'lot TEXT')
  addCol('purchase_items', 'fabric_roll_id', 'fabric_roll_id TEXT')

  addCol('sales', 'customer_id', 'customer_id TEXT')
  addCol('sales', 'credit_amount', 'credit_amount REAL DEFAULT 0')
  addCol('sales', 'void_reason', 'void_reason TEXT')
  addCol('sales', 'voided_at', 'voided_at TEXT')
  addCol('sales', 'voided_by', 'voided_by TEXT')

  addCol('sale_items', 'fabric_roll_id', 'fabric_roll_id TEXT')
  addCol('sale_items', 'fabric_width', 'fabric_width TEXT')

  addCol('store_profile', 'remnant_threshold', 'remnant_threshold REAL DEFAULT 3')
  addCol('store_profile', 'razorpay_key_id', 'razorpay_key_id TEXT')
  addCol('store_profile', 'razorpay_key_secret', 'razorpay_key_secret TEXT')
  addCol('store_profile', 'razorpay_webhook_secret', 'razorpay_webhook_secret TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      gstin TEXT,
      balance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

    CREATE TABLE IF NOT EXISTS customer_payments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      mode TEXT NOT NULL,
      sale_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_cust_pay_customer ON customer_payments(customer_id);

    CREATE TABLE IF NOT EXISTS fabric_rolls (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      width TEXT,
      shade TEXT,
      lot TEXT,
      remaining_metres REAL NOT NULL DEFAULT 0,
      initial_metres REAL NOT NULL DEFAULT 0,
      remnant_threshold REAL NOT NULL DEFAULT 3,
      barcode TEXT,
      purchase_id TEXT,
      purchase_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_rolls_product ON fabric_rolls(product_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_order_id TEXT,
      sale_id TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'created',
      qr_payload TEXT,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}
