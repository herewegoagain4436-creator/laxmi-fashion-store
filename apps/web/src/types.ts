export type Role = 'owner' | 'cashier'
export type ProductType = 'garment' | 'saree' | 'fabric'
export type PaymentMode = 'cash' | 'upi' | 'card' | 'split'
export type SaleStatus = 'completed' | 'returned' | 'partial_return'

export type User = {
  id: string
  username: string
  role: Role
  name: string
}

export type StoreProfile = {
  id: string
  name: string
  address: string
  phone: string
  city: string
  updatedAt: string
}

export type ProductSize = {
  id: string
  productId: string
  size: string
  quantity: number
}

export type Product = {
  id: string
  sku: string
  name: string
  type: ProductType
  unit: 'piece' | 'metre'
  sellingPrice: number
  costPrice: number
  quantity: number
  lowStockThreshold: number
  fabricSellUnit: 'metre' | 'cm' | null
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
  quantity: number
  unit: string
  unitCost: number
  lineTotal: number
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
  quantity: number
  unit: string
  rate: number
  lineTotal: number
}

export type Sale = {
  id: string
  billNo: string
  datetime: string
  cashierId: string
  cashierName: string
  customerPhone: string
  paymentMode: PaymentMode
  cashAmount: number
  upiAmount: number
  cardAmount: number
  discount: number
  grandTotal: number
  status: SaleStatus
  notes: string
  createdAt: string
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
  quantity: number
  unit: string
  productType?: ProductType
}

export type OutboxItem = {
  localId?: number
  id: string
  type: 'product' | 'supplier' | 'purchase' | 'sale' | 'return' | 'store'
  payload: unknown
  createdAt: string
  synced: number
  tries: number
  error?: string
}

export type Snapshot = {
  store: StoreProfile | null
  users: User[]
  products: Product[]
  suppliers: Supplier[]
  purchases: Purchase[]
  purchaseItems: PurchaseItem[]
  sales: Sale[]
  saleItems: SaleItem[]
  returns: ReturnRecord[]
  returnItems: ReturnItem[]
  serverTime: string
}

export const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'Free size'] as const
