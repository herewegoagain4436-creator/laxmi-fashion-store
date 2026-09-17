export type Role = 'owner' | 'cashier'
/** Stock behaviour base type (sizes / piece / metre). */
export type ProductType = 'garment' | 'saree' | 'fabric'
export type PaymentMode = 'cash' | 'upi' | 'card' | 'split' | 'credit'
export type SaleStatus = 'completed' | 'returned' | 'partial_return' | 'held' | 'voided'
export type PriceChannel = 'retail' | 'wholesale'
export type SaleLineKind = 'sale' | 'return'

export type User = {
  id: string
  username: string
  role: Role
  name: string
}

/** Markup / discount % used to derive wholesale, MRP, sale from purchase cost. */
export type CategoryPricingRules = {
  wholesaleMarkupPct: number
  mrpMarkupPct: number
  saleDiscountFromMrpPct: number
}

/** @deprecated Prefer per-category pricing on Category. Kept for backward compatibility. */
export type PricingSettings = {
  garment: CategoryPricingRules
  saree: CategoryPricingRules
  fabric: CategoryPricingRules
}

/**
 * Admin-managed product category.
 * baseType controls stock behaviour; pricing % drive auto-calc.
 */
export type Category = {
  id: string
  name: string
  slug?: string | null
  baseType: ProductType
  wholesaleMarkupPct: number
  mrpMarkupPct: number
  saleDiscountFromMrpPct: number
  sortOrder: number
  active: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

/** Apparel GST slab + fabric flat rate (Notification 9/2025 defaults). */
export type GstSettings = {
  /** Pre-GST taxable value threshold per piece for apparel (default 2500). */
  apparelThreshold: number
  apparelLowRate: number
  apparelHighRate: number
  fabricRate: number
}

export type StoreProfile = {
  id: string
  name: string
  address: string
  phone: string
  city: string
  updatedAt: string
  /** @deprecated Prefer Category pricing fields */
  pricingSettings?: PricingSettings
  /** UPI VPA / UPI ID shown on amount-specific QR */
  upiVpa?: string
  /** Shop GSTIN (optional; used on owner tax reports) */
  gstin?: string
  gstSettings?: GstSettings
  /** Max ₹ discount a cashier may apply on a bill (0 = none without owner). */
  maxCashierDiscount?: number
  /** Max % of subtotal a cashier may discount. */
  maxCashierDiscountPct?: number
  /** Optional prefix prepended to auto-generated variant barcodes. */
  barcodePrefix?: string
  /** Default remnant alert threshold (metres) for fabric rolls */
  remnantThreshold?: number
  /** Razorpay Key ID (optional UPI gateway) */
  razorpayKeyId?: string
  /** Razorpay Key Secret — stored locally; only sent to own sync server */
  razorpayKeySecret?: string
  /** Razorpay webhook secret (server-side verify) */
  razorpayWebhookSecret?: string
}

/** Colour × size stock row (variant). colour defaults to "Default" for migrated stock. */
export type ProductSize = {
  id: string
  productId: string
  size: string
  colour: string
  quantity: number
  /** Variant barcode (unique per colour×size). */
  barcode?: string | null
  /** Optional variant SKU suffix / code. */
  variantSku?: string | null
}

/**
 * Four distinct prices per product:
 * - purchasePrice / costPrice — what we paid the supplier
 * - wholesalePrice — when selling wholesale
 * - mrp — MRP
 * - salePrice / sellingPrice — retail to consumers (Sale ≠ wholesale)
 */
export type Product = {
  id: string
  sku: string
  name: string
  /** Stock behaviour — kept in sync with category.baseType */
  type: ProductType
  /** Required going forward; maps to Category */
  categoryId: string
  unit: 'piece' | 'metre'
  /** @deprecated prefer salePrice — kept in sync for compatibility */
  sellingPrice: number
  /** Retail selling price to consumers */
  salePrice: number
  /** @deprecated prefer purchasePrice — kept in sync for compatibility */
  costPrice: number
  /** What we paid the supplier */
  purchasePrice: number
  wholesalePrice: number
  mrp: number
  quantity: number
  lowStockThreshold: number
  fabricSellUnit: 'metre' | 'cm' | null
  /** Optional default shade for fabric/than */
  shade?: string | null
  /** Default than width (inches) when rolls omit width */
  fabricWidth?: string | null
  /** Alert when any roll remaining metres fall below this (default 3) */
  remnantThreshold?: number | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  sizes?: ProductSize[]
}

export type Supplier = {
  id: string
  name: string
  phone: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type PurchaseItem = {
  id: string
  purchaseId: string
  productId: string
  productName: string
  size?: string | null
  colour?: string | null
  quantity: number
  unit: string
  unitCost: number
  lineTotal: number
  fabricWidth?: string | null
  shade?: string | null
  lot?: string | null
  fabricRollId?: string | null
}

export type Purchase = {
  id: string
  supplierId: string
  billNo: string
  date: string
  total: number
  notes: string
  createdBy?: string
  createdAt: string
}

export type SaleItem = {
  id: string
  saleId: string
  productId: string
  productName: string
  productType: ProductType
  sku: string
  size?: string | null
  colour?: string | null
  shade?: string | null
  barcode?: string | null
  quantity: number
  unit: string
  rate: number
  lineTotal: number
  mrp?: number
  /** GST rate applied after discount (5 or 18 typically). */
  gstRate?: number
  taxableAmount?: number
  cgstAmount?: number
  sgstAmount?: number
  lineKind?: SaleLineKind
  /** When lineKind=return, original sale item id if known. */
  returnOfSaleItemId?: string | null
  /** Fabric roll consumed (than billing) */
  fabricRollId?: string | null
  fabricWidth?: string | null
}

export type Sale = {
  id: string
  billNo: string
  datetime: string
  cashierId: string
  cashierName: string
  customerPhone: string
  customerGstin?: string
  paymentMode: PaymentMode
  cashAmount: number
  upiAmount: number
  cardAmount: number
  discount: number
  grandTotal: number
  status: SaleStatus
  notes: string
  createdAt: string
  priceChannel?: PriceChannel
  upiRef?: string
  taxableTotal?: number
  gstTotal?: number
  /** Original bill id when this sale includes exchange returns. */
  exchangeOfSaleId?: string | null
  /** Linked customer for udhaar / credit */
  customerId?: string | null
  /** Amount put on credit / udhaar */
  creditAmount?: number
  /** Soft-void reason when status=voided */
  voidReason?: string | null
  voidedAt?: string | null
  voidedBy?: string | null
}

export type ReturnRecord = {
  id: string
  saleId: string
  datetime: string
  reason: string
  refundAmount: number
  refundMode: string
  createdBy?: string
  createdAt: string
}

export type ReturnItem = {
  id: string
  returnId: string
  saleItemId: string
  productId: string
  productName: string
  size?: string | null
  colour?: string | null
  quantity: number
  unit: string
  productType?: ProductType
}

/** Append-only stock movement (sync-safe; avoids LWW on qty). */
export type StockLedgerEntry = {
  id: string
  productId: string
  colour: string
  size: string
  delta: number
  unit: string
  reason: 'sale' | 'return' | 'purchase' | 'adjust' | 'seed'
  refType: string
  refId: string
  createdAt: string
  deviceId?: string
}

export type HeldBill = {
  id: string
  label: string
  payload: unknown
  createdAt: string
  cashierId?: string
}

export type OutboxItem = {
  localId?: number
  id: string
  type: 'product' | 'supplier' | 'purchase' | 'sale' | 'return' | 'store' | 'category' | 'stock_ledger' | 'customer' | 'customer_payment' | 'fabric_roll' | 'audit'
  payload: unknown
  createdAt: string
  synced: number
  tries: number
  error?: string
}

export type Snapshot = {
  store: StoreProfile | null
  users: User[]
  categories: Category[]
  products: Product[]
  suppliers: Supplier[]
  purchases: Purchase[]
  purchaseItems: PurchaseItem[]
  sales: Sale[]
  saleItems: SaleItem[]
  returns: ReturnRecord[]
  returnItems: ReturnItem[]
  customers?: Customer[]
  customerPayments?: CustomerPayment[]
  fabricRolls?: FabricRoll[]
  auditLog?: AuditLogEntry[]
  serverTime: string
}

export const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'Free size'] as const

/** Migrated / unspecified colour axis value. */
export const DEFAULT_COLOUR = 'Default'

export const DEFAULT_GST_SETTINGS: GstSettings = {
  apparelThreshold: 2500,
  apparelLowRate: 5,
  apparelHighRate: 18,
  fabricRate: 5,
}

/** Stable IDs for the three default seed categories. */
export const DEFAULT_CATEGORY_IDS = {
  garment: 'cat-garment',
  saree: 'cat-saree',
  fabric: 'cat-fabric',
} as const

/** Fabric roll / than width inches (common Indian market). */
export type FabricWidth = '44' | '54' | '60'

export type FabricRoll = {
  id: string
  productId: string
  width: FabricWidth | string
  shade: string
  lot: string
  /** Remaining length in metres */
  remainingMetres: number
  /** Original length when received */
  initialMetres: number
  remnantThreshold: number
  barcode?: string | null
  purchaseId?: string | null
  purchaseItemId?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type Customer = {
  id: string
  phone: string
  name: string
  gstin?: string
  /** Outstanding udhaar balance (positive = customer owes shop) */
  balance: number
  notes?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type CustomerPayment = {
  id: string
  customerId: string
  amount: number
  mode: 'cash' | 'upi' | 'card' | 'adjust'
  saleId?: string | null
  notes?: string
  createdAt: string
  createdBy?: string
}

export type AuditAction =
  | 'void'
  | 'discount'
  | 'return'
  | 'stock_adjust'
  | 'price_edit'
  | 'credit_sale'
  | 'credit_payment'
  | 'sale_void'

export type AuditLogEntry = {
  id: string
  action: AuditAction | string
  entityType: string
  entityId: string
  userId?: string
  userName?: string
  detail: string
  createdAt: string
}

export const FABRIC_WIDTHS = ['44', '54', '60'] as const

export const DEFAULT_REMNANT_THRESHOLD = 3
