import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeftRight,
  Camera,
  Pause,
  Play,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { CameraBarcodeScanner } from '../components/CameraBarcodeScanner'
import {
  attachHidScanListener,
  cartLineKey,
  findByBarcode,
  playScanBeep,
  type BarcodeHit,
} from '../lib/barcodeScan'
import { useAuth } from '../auth'
import { ColourSwatches } from '../components/ColourSwatches'
import { MetreKeypad } from '../components/MetreKeypad'
import { ReceiptView, printReceipt } from '../components/Receipt'
import { SizeChips } from '../components/SizeChips'
import { applyLocalStockDelta, consumeFabricRoll, db, enqueue, getActiveCategories, productsWithSizes } from '../db'
import { writeAudit } from '../lib/audit'
import { applyCreditSale, findCustomerByPhone, upsertCustomer } from '../lib/customers'
import { api, isRemoteSyncEnabled } from '../api'
import { inr, qtyLabel, stockQtyOfLine, typeLabel } from '../lib/format'
import { allocateDiscountAndGst, normalizeGstSettings, round2 } from '../lib/gst'
import { nextBillNo, uid } from '../lib/ids'
import { normalizeProductPrices } from '../lib/pricing'
import { buildUpiPayUri, upiQrDataUrl } from '../lib/upi'
import { coloursOf, findVariant, normalizeColour, sizesForColour } from '../lib/variants'
import { flushOutbox } from '../sync'
import {
  DEFAULT_COLOUR,
  DEFAULT_GST_SETTINGS,
  type PaymentMode,
  type PriceChannel,
  type Product,
  type ProductType,
  type Customer,
  type FabricRoll,
  type Sale,
  type SaleItem,
  type SaleLineKind,
  type StoreProfile,
} from '../types'

type CartLine = {
  key: string
  productId: string
  productName: string
  productType: ProductType
  sku: string
  size?: string
  colour?: string
  shade?: string
  barcode?: string
  quantity: number
  unit: string
  rate: number
  lineTotal: number
  mrp?: number
  lineKind: SaleLineKind
  returnOfSaleItemId?: string
  fabricRollId?: string
  fabricWidth?: string
}

function availableStock(p: Product, size?: string, colour?: string, roll?: FabricRoll | null) {
  if (p.type === 'garment') {
    const v = findVariant(p.sizes, colour, size)
    if (v) return Number(v.quantity || 0)
    const s = p.sizes?.find((x) => x.size === size)
    return Number(s?.quantity || 0)
  }
  if (p.type === 'fabric' && roll) return Number(roll.remainingMetres || 0)
  return Number(p.quantity || 0)
}

function isRemnant(roll: FabricRoll) {
  return Number(roll.remainingMetres) > 0 && Number(roll.remainingMetres) <= Number(roll.remnantThreshold || 3)
}

export function POS() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const categories = useLiveQuery(() => getActiveCategories(), []) || []
  const sales = useLiveQuery(() => db.sales.toArray(), []) || []
  const allSaleItems = useLiveQuery(() => db.saleItems.toArray(), []) || []
  const held = useLiveQuery(() => db.heldBills.orderBy('createdAt').reverse().toArray(), []) || []
  const store = useLiveQuery(() => db.store.get('store-1'), []) as StoreProfile | undefined
  const fabricRolls =
    useLiveQuery(() => db.fabricRolls.filter((r) => !r.deletedAt && Number(r.remainingMetres) > 0).toArray(), []) ||
    []
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deletedAt).toArray(), []) || []
  const searchRef = useRef<HTMLInputElement>(null)

  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState<'all' | string>('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState('')
  const [phone, setPhone] = useState('')
  const [customerGstin, setCustomerGstin] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [cash, setCash] = useState('')
  const [upi, setUpi] = useState('')
  const [card, setCard] = useState('')
  const [cashTendered, setCashTendered] = useState('')
  const [upiRef, setUpiRef] = useState('')
  const [upiQr, setUpiQr] = useState('')
  const [pick, setPick] = useState<Product | null>(null)
  const [pickColour, setPickColour] = useState(DEFAULT_COLOUR)
  const [pickSize, setPickSize] = useState('')
  const [pickQty, setPickQty] = useState('1')
  const [pickShade, setPickShade] = useState('')
  const [pickRollId, setPickRollId] = useState('')
  const [pickUnit, setPickUnit] = useState<'metre' | 'cm'>('metre')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [rzOrderId, setRzOrderId] = useState('')
  const [voidSaleId, setVoidSaleId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [done, setDone] = useState<{ sale: Sale; items: SaleItem[] } | null>(null)
  const [err, setErr] = useState('')
  const [wholesaleMode, setWholesaleMode] = useState(false)
  const [mobileTab, setMobileTab] = useState<'cart' | 'catalog'>('cart')
  const [exchangeSale, setExchangeSale] = useState<Sale | null>(null)
  const [exchangeQty, setExchangeQty] = useState<Record<string, string>>({})
  const [exchangeReason, setExchangeReason] = useState('')
  const [showExchange, setShowExchange] = useState(false)
  const [exchangeQuery, setExchangeQuery] = useState('')
  const [showHold, setShowHold] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [scanToast, setScanToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [disambig, setDisambig] = useState<BarcodeHit[] | null>(null)
  const productsRef = useRef(products)
  productsRef.current = products
  const cartRef = useRef(cart)
  cartRef.current = cart
  const wholesaleRef = useRef(wholesaleMode)
  wholesaleRef.current = wholesaleMode

  const gstSettings = normalizeGstSettings(store?.gstSettings || DEFAULT_GST_SETTINGS)
  const priceChannel: PriceChannel = wholesaleMode ? 'wholesale' : 'retail'

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => {
      if (p.deletedAt) return false
      if (catFilter !== 'all' && p.categoryId !== catFilter) return false
      if (!s) return true
      const catName = categories.find((c) => c.id === p.categoryId)?.name?.toLowerCase() || ''
      const barcodes = (p.sizes || []).map((x) => (x.barcode || '').toLowerCase())
      return (
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.type.includes(s) ||
        catName.includes(s) ||
        barcodes.some((b) => b.includes(s) || b === s)
      )
    })
  }, [products, q, catFilter, categories])


  const gstMap = useMemo(
    () =>
      allocateDiscountAndGst(
        cart.map((c) => ({
          key: c.key,
          productType: c.productType,
          lineTotal: c.lineTotal,
          quantity: c.quantity,
          lineKind: c.lineKind,
        })),
        Number(discount) || 0,
        gstSettings,
      ),
    [cart, discount, gstSettings],
  )

  const sub = cart.reduce((a, l) => a + l.lineTotal, 0)
  const disc = Number(discount) || 0
  const grand = Math.max(0, round2(sub - disc))
  const taxableTotal = [...gstMap.values()].reduce((a, g) => a + g.taxableAmount, 0)
  const gstTotal = [...gstMap.values()].reduce((a, g) => a + g.gstAmount, 0)

  const upiDue = mode === 'upi' ? grand : mode === 'split' ? Number(upi) || 0 : 0

  useEffect(() => {
    if (mode !== 'split') return
    const c = Number(cash) || 0
    const u = Number(upi) || 0
    const r = Math.max(0, round2(grand - c - u))
    setCard(String(r))
  }, [cash, upi, grand, mode])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (upiDue <= 0 || !store?.upiVpa) {
        setUpiQr('')
        return
      }
      const uri = buildUpiPayUri({
        vpa: store.upiVpa,
        amount: upiDue,
        payeeName: store.name || 'Laxmi Fashion',
        note: `Bill ${store.name || 'LF'}`,
      })
      const url = await upiQrDataUrl(uri)
      if (!cancelled) setUpiQr(url)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [upiDue, store?.upiVpa, store?.name])

  function openProduct(p: Product, colour?: string, size?: string) {
    setErr('')
    setPick(p)
    setPickQty(p.type === 'fabric' ? '' : '1')
    setPickShade(p.shade || '')
    const rollsFor = fabricRolls.filter((r) => r.productId === p.id)
    setPickRollId(rollsFor[0]?.id || '')
    if (rollsFor[0]?.shade) setPickShade(rollsFor[0].shade)
    setPickUnit((p.fabricSellUnit as 'metre' | 'cm') || 'metre')
    if (p.type === 'garment') {
      const cols = coloursOf(p.sizes || [])
      const col = colour ? normalizeColour(colour) : cols[0] || DEFAULT_COLOUR
      setPickColour(col)
      const forCol = sizesForColour(p.sizes || [], col)
      const first = size
        ? forCol.find((s) => s.size === size)
        : forCol.find((s) => s.quantity > 0) || forCol[0]
      setPickSize(first?.size || '')
    } else {
      setPickColour(DEFAULT_COLOUR)
      setPickSize('')
    }
    setMobileTab('cart')
  }


  function showToast(kind: 'ok' | 'err', text: string) {
    setScanToast({ kind, text })
    window.setTimeout(() => setScanToast(null), 2200)
  }

  function addVariantToCart(product: Product, colour?: string, size?: string, qty = 1) {
    const prices = normalizeProductPrices(product as unknown as Record<string, unknown>)
    const rate = wholesaleRef.current ? prices.wholesalePrice : prices.salePrice
    const unit = product.type === 'fabric' ? 'metre' : 'piece'
    const col = product.type === 'garment' ? normalizeColour(colour) : DEFAULT_COLOUR
    const sz = product.type === 'garment' ? size : undefined
    const variant = product.type === 'garment' ? findVariant(product.sizes, col, sz) : undefined
    const avail = availableStock(product, sz, col)
    const key = cartLineKey(product.id, col, sz, unit)
    const already = cartRef.current
      .filter((c) => c.lineKind === 'sale' && c.key === key)
      .reduce((a, c) => a + stockQtyOfLine(c.unit, c.quantity), 0)
    if (avail - already + 1e-9 < qty) {
      playScanBeep('err')
      showToast('err', `Not enough stock for ${product.name} (avail ${avail})`)
      setErr(`Not enough stock (available ${avail})`)
      return false
    }
    setCart((prev) => {
      const i = prev.findIndex((x) => x.key === key)
      if (i >= 0) {
        const next = [...prev]
        const q2 = next[i].quantity + qty
        next[i] = { ...next[i], quantity: q2, lineTotal: round2(q2 * rate) }
        return next
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          productName: product.name,
          productType: product.type,
          sku: variant?.variantSku || product.sku,
          size: sz,
          colour: col,
          shade: product.type === 'fabric' ? product.shade || undefined : undefined,
          barcode: variant?.barcode || undefined,
          quantity: qty,
          unit,
          rate,
          lineTotal: round2(qty * rate),
          mrp: prices.mrp,
          lineKind: 'sale' as const,
        },
      ]
    })
    setErr('')
    setMobileTab('cart')
    return true
  }

  const handleBarcodeScan = useCallback(
    (raw: string) => {
      const code = raw.trim()
      if (!code) return
      const hits = findByBarcode(productsRef.current, code)
      if (!hits.length) {
        playScanBeep('err')
        showToast('err', `Barcode not found: ${code}`)
        setErr(`Barcode not found: ${code}`)
        return
      }
      if (hits.length > 1) {
        playScanBeep('err')
        setDisambig(hits)
        showToast('err', `${hits.length} matches — pick one`)
        return
      }
      const hit = hits[0]
      // Exact variant with colour+size → add directly (increment if duplicate)
      if (hit.product.type === 'garment' && hit.variant?.size) {
        const ok = addVariantToCart(hit.product, hit.variant.colour, hit.variant.size, 1)
        if (ok) {
          playScanBeep('ok')
          showToast('ok', `Added ${hit.product.name} · ${hit.variant.size}`)
        }
        setCameraOpen(false)
        return
      }
      // Fabric/saree or parent-only → open picker
      if (hit.product.type !== 'garment') {
        openProduct(hit.product)
        playScanBeep('ok')
        showToast('ok', `Opened ${hit.product.name}`)
        setCameraOpen(false)
        return
      }
      openProduct(hit.product, hit.variant?.colour, hit.variant?.size)
      playScanBeep('ok')
      showToast('ok', `Select size/colour for ${hit.product.name}`)
      setCameraOpen(false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    return attachHidScanListener({
      onScan: handleBarcodeScan,
      shouldIgnore: () => Boolean(cameraOpen || done || showExchange || showHold),
    })
  }, [handleBarcodeScan, cameraOpen, done, showExchange, showHold])

  function addPicked() {
    if (!pick) return
    const qty = Number(pickQty)
    if (!qty || qty <= 0) {
      setErr(pick.type === 'fabric' ? 'Enter length in metres' : 'Enter quantity')
      return
    }
    if (pick.type === 'garment' && !pickSize) {
      setErr('Size is required for garments')
      return
    }
    let unit = 'piece'
    let stockNeed = qty
    const selectedRoll =
      pick.type === 'fabric' && pickRollId
        ? fabricRolls.find((r) => r.id === pickRollId) || null
        : null
    if (pick.type === 'fabric') {
      unit = 'metre'
      stockNeed = pickUnit === 'cm' ? qty / 100 : qty
      unit = pickUnit === 'cm' ? 'cm' : 'metre'
    }
    const size = pick.type === 'garment' ? pickSize : undefined
    const colour = pick.type === 'garment' ? normalizeColour(pickColour) : DEFAULT_COLOUR
    const variant = pick.type === 'garment' ? findVariant(pick.sizes, colour, size) : undefined
    const avail = availableStock(pick, size, colour, selectedRoll)
    const already = cart
      .filter(
        (c) =>
          c.lineKind === 'sale' &&
          c.productId === pick.id &&
          c.size === size &&
          normalizeColour(c.colour) === colour &&
          (c.fabricRollId || '') === (selectedRoll?.id || ''),
      )
      .reduce((a, c) => a + stockQtyOfLine(c.unit, c.quantity), 0)
    if (avail - already + 1e-9 < stockNeed) {
      setErr(`Not enough stock (available ${avail}${selectedRoll ? ' m on roll' : ''})`)
      return
    }
    const prices = normalizeProductPrices(pick as unknown as Record<string, unknown>)
    if (wholesaleMode && !isOwner) {
      // cashiers need owner for wholesale — still allow if already toggled by owner session
    }
    const rate = wholesaleMode ? prices.wholesalePrice : prices.salePrice
    const billQty = pick.type === 'fabric' ? (pickUnit === 'cm' ? qty : qty) : qty
    const lineTotal =
      pick.type === 'fabric'
        ? round2(stockNeed * rate)
        : round2(billQty * rate)
    const rollShade = selectedRoll?.shade || pickShade || pick.shade || undefined
    const key = `${pick.id}-${colour}-${size || ''}-${unit}-${selectedRoll?.id || ''}-sale`
    setCart((prev) => {
      const i = prev.findIndex((x) => x.key === key)
      if (i >= 0) {
        const next = [...prev]
        const q2 = next[i].quantity + billQty
        const need2 = pick.type === 'fabric' ? (unit === 'cm' ? q2 / 100 : q2) : q2
        next[i] = {
          ...next[i],
          quantity: q2,
          lineTotal: round2(pick.type === 'fabric' ? need2 * rate : q2 * rate),
        }
        return next
      }
      return [
        ...prev,
        {
          key,
          productId: pick.id,
          productName: pick.name,
          productType: pick.type,
          sku: variant?.variantSku || pick.sku,
          size,
          colour,
          shade: pick.type === 'fabric' ? rollShade : undefined,
          barcode: variant?.barcode || selectedRoll?.barcode || undefined,
          quantity: billQty,
          unit,
          rate,
          lineTotal,
          mrp: prices.mrp,
          lineKind: 'sale',
          fabricRollId: selectedRoll?.id,
          fabricWidth: selectedRoll?.width || pick.fabricWidth || undefined,
        },
      ]
    })
    setPick(null)
    setErr('')
    setMobileTab('cart')
  }

  function validateDiscount(): string | null {
    const d = Number(discount) || 0
    if (d <= 0) return null
    if (isOwner) return null
    const maxAbs = Number(store?.maxCashierDiscount ?? 100)
    const maxPct = Number(store?.maxCashierDiscountPct ?? 5)
    const saleSub = cart.filter((c) => c.lineKind === 'sale').reduce((a, c) => a + c.lineTotal, 0)
    if (d > maxAbs + 1e-9) return `Cashier discount capped at ${inr(maxAbs)}`
    if (saleSub > 0 && (d / saleSub) * 100 > maxPct + 1e-9)
      return `Cashier discount capped at ${maxPct}%`
    return null
  }

  async function checkout() {
    setErr('')
    if (!cart.length) {
      setErr('Cart is empty')
      return
    }
    const discErr = validateDiscount()
    if (discErr) {
      setErr(discErr)
      return
    }
    if (mode === 'split') {
      const sum = (Number(cash) || 0) + (Number(upi) || 0) + (Number(card) || 0)
      if (Math.abs(sum - grand) > 0.05) {
        setErr('Split amounts must equal total')
        return
      }
    }
    if ((mode === 'upi' || (mode === 'split' && (Number(upi) || 0) > 0)) && !upiRef.trim() && !rzOrderId) {
      setErr('Enter UPI UTR / reference to confirm payment')
      return
    }
    if (mode === 'credit' && !phone.trim() && !customerId) {
      setErr('Attach customer phone for udhaar / credit sale')
      return
    }
    if (wholesaleMode && !isOwner) {
      setErr('Wholesale billing requires owner login')
      return
    }

    const id = uid()
    const billNo = nextBillNo(sales.map((s) => s.billNo))
    const datetime = new Date().toISOString()
    const items: SaleItem[] = cart.map((c) => {
      const g = gstMap.get(c.key)!
      return {
        id: uid(),
        saleId: id,
        productId: c.productId,
        productName: c.productName,
        productType: c.productType,
        sku: c.sku,
        size: c.size,
        colour: c.colour,
        shade: c.shade,
        barcode: c.barcode,
        quantity: c.lineKind === 'return' ? -Math.abs(c.quantity) : c.quantity,
        unit: c.unit,
        rate: c.rate,
        lineTotal: c.lineKind === 'return' ? -Math.abs(c.lineTotal) : c.lineTotal,
        mrp: c.mrp,
        gstRate: g.gstRate,
        taxableAmount: g.taxableAmount,
        cgstAmount: g.cgstAmount,
        sgstAmount: g.sgstAmount,
        lineKind: c.lineKind,
        returnOfSaleItemId: c.returnOfSaleItemId,
        fabricRollId: c.fabricRollId,
        fabricWidth: c.fabricWidth,
      }
    })
    let linkedCustomerId = customerId
    if ((mode === 'credit' || phone.trim()) && phone.trim()) {
      const existing = customerId
        ? customers.find((c) => c.id === customerId)
        : await findCustomerByPhone(phone)
      const cust = existing
        ? existing
        : await upsertCustomer({
            phone: phone.trim(),
            name: customerName.trim() || phone.trim(),
            gstin: customerGstin.trim(),
          })
      linkedCustomerId = cust.id
    }
    const creditAmt =
      mode === 'credit'
        ? grand
        : mode === 'split'
          ? Number(creditAmount) || 0
          : 0
    const sale: Sale = {
      id,
      billNo,
      datetime,
      cashierId: user?.id || '',
      cashierName: user?.name || '',
      customerPhone: phone.trim(),
      customerGstin: customerGstin.trim(),
      paymentMode: mode,
      cashAmount: mode === 'cash' ? grand : mode === 'split' ? Number(cash) || 0 : 0,
      upiAmount: mode === 'upi' ? grand : mode === 'split' ? Number(upi) || 0 : 0,
      cardAmount: mode === 'card' ? grand : mode === 'split' ? Number(card) || 0 : 0,
      discount: disc,
      grandTotal: grand,
      status: 'completed',
      notes: exchangeReason ? `Exchange: ${exchangeReason}` : '',
      createdAt: datetime,
      priceChannel,
      upiRef: upiRef.trim() || rzOrderId,
      taxableTotal: round2(taxableTotal),
      gstTotal: round2(gstTotal),
      exchangeOfSaleId: exchangeSale?.id || null,
      customerId: linkedCustomerId || null,
      creditAmount: creditAmt,
    }

    await db.transaction(
      'rw',
      [
        db.sales,
        db.saleItems,
        db.products,
        db.productSizes,
        db.outbox,
        db.stockLedger,
        db.returns,
        db.returnItems,
        db.fabricRolls,
        db.customers,
        db.auditLog,
      ],
      async () => {
        await db.sales.add(sale)
        await db.saleItems.bulkAdd(items)
        for (const it of items) {
          const kind = it.lineKind || 'sale'
          const absQty = Math.abs(it.quantity)
          if (it.fabricRollId && kind === 'sale' && it.productType === 'fabric') {
            const metres = it.unit === 'cm' ? absQty / 100 : absQty
            await consumeFabricRoll({ rollId: it.fabricRollId, metres, refType: 'sale', refId: sale.id })
          } else {
            await applyLocalStockDelta({
              productId: it.productId,
              productType: it.productType,
              colour: it.colour,
              size: it.size,
              unit: it.unit,
              quantity: absQty,
              direction: kind === 'return' ? 1 : -1,
              reason: kind === 'return' ? 'return' : 'sale',
              refType: 'sale',
              refId: sale.id,
            })
          }
        }
        if (linkedCustomerId && creditAmt > 0) {
          await applyCreditSale(linkedCustomerId, creditAmt, sale.id)
          await writeAudit({
            action: 'credit_sale',
            entityType: 'sale',
            entityId: sale.id,
            userId: user?.id,
            userName: user?.name,
            detail: { creditAmt, customerId: linkedCustomerId, billNo },
          })
        }
        if (disc > 0) {
          const maxAbs = Number(store?.maxCashierDiscount ?? 100)
          if (disc >= maxAbs || disc >= grand * 0.1) {
            await writeAudit({
              action: 'discount',
              entityType: 'sale',
              entityId: sale.id,
              userId: user?.id,
              userName: user?.name,
              detail: { discount: disc, grandTotal: grand, billNo },
            })
          }
        }
        if (exchangeSale) {
          await db.sales.update(exchangeSale.id, { status: 'partial_return' })
        }
        await enqueue('sale', { ...sale, items }, sale.id)
      },
    )
    void flushOutbox()
    setCart([])
    setDiscount('')
    setPhone('')
    setCustomerGstin('')
    setCustomerId(null)
    setCustomerName('')
    setCreditAmount('')
    setCash('')
    setUpi('')
    setCard('')
    setCashTendered('')
    setUpiRef('')
    setRzOrderId('')
    setExchangeSale(null)
    setExchangeReason('')
    setDone({ sale, items })
  }

  async function holdBill() {
    if (!cart.length) {
      setErr('Nothing to hold')
      return
    }
    const id = uid()
    await db.heldBills.put({
      id,
      label: phone.trim() || `Hold ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      payload: {
        cart,
        discount,
        phone,
        customerGstin,
        wholesaleMode,
        mode,
        cash,
        upi,
        card,
        exchangeSaleId: exchangeSale?.id,
        exchangeReason,
      },
      createdAt: new Date().toISOString(),
      cashierId: user?.id,
    })
    setCart([])
    setDiscount('')
    setPhone('')
    setErr('')
    setShowHold(false)
  }

  async function recallBill(id: string) {
    const row = await db.heldBills.get(id)
    if (!row) return
    const p = row.payload as {
      cart: CartLine[]
      discount: string
      phone: string
      customerGstin?: string
      wholesaleMode: boolean
      mode: PaymentMode
      cash: string
      upi: string
      card: string
      exchangeSaleId?: string
      exchangeReason?: string
    }
    setCart(p.cart || [])
    setDiscount(p.discount || '')
    setPhone(p.phone || '')
    setCustomerGstin(p.customerGstin || '')
    setWholesaleMode(Boolean(p.wholesaleMode))
    setMode(p.mode || 'cash')
    setCash(p.cash || '')
    setUpi(p.upi || '')
    setCard(p.card || '')
    setExchangeReason(p.exchangeReason || '')
    if (p.exchangeSaleId) {
      const s = sales.find((x) => x.id === p.exchangeSaleId) || null
      setExchangeSale(s)
    }
    await db.heldBills.delete(id)
    setShowHold(false)
    setMobileTab('cart')
  }

  function addExchangeReturns() {
    if (!exchangeSale) return
    const items = allSaleItems.filter((i) => i.saleId === exchangeSale.id)
    const next: CartLine[] = []
    for (const it of items) {
      const n = Number(exchangeQty[it.id] || 0)
      if (n <= 0) continue
      next.push({
        key: `ret-${it.id}-${n}`,
        productId: it.productId,
        productName: it.productName,
        productType: it.productType,
        sku: it.sku,
        size: it.size || undefined,
        colour: it.colour || DEFAULT_COLOUR,
        barcode: it.barcode || undefined,
        quantity: n,
        unit: it.unit,
        rate: it.rate,
        lineTotal: -round2((it.lineTotal / it.quantity) * n),
        mrp: it.mrp,
        lineKind: 'return',
        returnOfSaleItemId: it.id,
      })
    }
    if (!next.length) {
      setErr('Select return quantities')
      return
    }
    setCart((c) => [...c, ...next])
    setShowExchange(false)
    setMobileTab('cart')
    setErr('')
  }

  const exchangeMatches = useMemo(() => {
    const s = exchangeQuery.trim().toLowerCase()
    const list = sales.filter((x) => x.status !== 'held')
    if (!s) return list.slice(0, 8)
    return list
      .filter(
        (x) =>
          x.billNo.toLowerCase().includes(s) || (x.customerPhone || '').includes(s),
      )
      .slice(0, 12)
  }, [exchangeQuery, sales])

  const changeDue =
    mode === 'cash' && cashTendered
      ? Math.max(0, round2((Number(cashTendered) || 0) - grand))
      : 0

  const catalogPane = (
    <section className="min-w-0">
      <div className="mb-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const s = q.trim()
                if (s.length >= 3) {
                  e.preventDefault()
                  handleBarcodeScan(s)
                  setQ('')
                }
              }
            }}
            placeholder="Search or scan barcode…"
            className="lf-input min-h-[48px] pl-10 shadow-soft"
            autoFocus
            data-scan-capture="1"
          />
        </div>
        <button
          type="button"
          className="lf-btn-primary min-h-[48px] min-w-[48px] shrink-0 px-3"
          title="Camera barcode scan"
          onClick={() => setCameraOpen(true)}
        >
          <Camera className="h-5 w-5" />
          <span className="hidden sm:inline">Scan</span>
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCatFilter('all')}
          className={catFilter === 'all' ? 'lf-chip-active' : 'lf-chip-idle'}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCatFilter(c.id)}
            className={catFilter === c.id ? 'lf-chip-active' : 'lf-chip-idle'}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {filtered.map((p) => {
          const stock =
            p.type === 'garment'
              ? (p.sizes || []).reduce((a, s) => a + Number(s.quantity), 0)
              : Number(p.quantity)
          const prices = normalizeProductPrices(p as unknown as Record<string, unknown>)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openProduct(p)}
              className="rounded-2xl border border-brand-100/80 bg-white p-2.5 text-left shadow-soft transition hover:border-brand-300 hover:shadow-card active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-brand-900">{p.name}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {p.sku} · {categories.find((c) => c.id === p.categoryId)?.name || typeLabel(p.type)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold text-brand-700">
                    {inr(wholesaleMode ? prices.wholesalePrice : prices.salePrice)}
                  </div>
                  <div className="text-[10px] font-medium text-slate-500">
                    {p.type === 'fabric' ? `${stock} m` : `${stock} pcs`}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )

  const billPane = (
    <aside className="lf-card flex flex-col p-4 lg:sticky lg:top-3 lg:max-h-[calc(100vh-5rem)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="lf-section-title text-base">Bill</h2>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (!isOwner && !wholesaleMode) {
                setErr('Only owner can switch to Wholesale')
                return
              }
              if (cart.length && !confirm('Switch channel clears cart. Continue?')) return
              setWholesaleMode((v) => !v)
              setCart([])
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              wholesaleMode ? 'bg-blue-600 text-white shadow-soft' : 'bg-brand-50 text-brand-800'
            }`}
            title={isOwner ? 'Owner: retail ↔ wholesale' : 'Owner only'}
          >
            {wholesaleMode ? 'Wholesale' : 'Retail'}
          </button>
          <button
            type="button"
            className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800"
            onClick={() => void holdBill()}
            title="Hold bill"
          >
            <Pause className="mr-0.5 inline h-3 w-3" /> Hold
          </button>
          <button
            type="button"
            className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800"
            onClick={() => setShowHold(true)}
          >
            <Play className="mr-0.5 inline h-3 w-3" /> Recall
          </button>
          <button
            type="button"
            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700"
            onClick={() => {
              setShowExchange(true)
              setExchangeQuery('')
            }}
          >
            <ArrowLeftRight className="mr-0.5 inline h-3 w-3" /> Return
          </button>
        </div>
      </div>
      {err && (
        <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-700">
          {err}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5 lg:max-h-56">
        {cart.length === 0 && (
          <div className="rounded-xl bg-cream-100 px-3 py-4 text-center text-sm text-slate-500">
            Scan or tap a product to add
          </div>
        )}
        {cart.map((l) => (
          <div
            key={l.key}
            className={`flex items-start justify-between gap-2 rounded-xl border px-2.5 py-2 ${
              l.lineKind === 'return'
                ? 'border-red-100 bg-red-50'
                : 'border-brand-50 bg-cream-50'
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-brand-900">
                {l.lineKind === 'return' ? '↩ ' : ''}
                {l.productName}
              </div>
              <div className="text-xs text-slate-500">
                {l.colour && l.colour !== DEFAULT_COLOUR ? `${l.colour} · ` : ''}
                {l.size ? `Size ${l.size} · ` : ''}
                {l.shade ? `Shade ${l.shade} · ` : ''}
                {qtyLabel(l.quantity, l.unit)} × {inr(l.rate)}
                {l.mrp != null && l.mrp > 0 ? ` · MRP ${inr(l.mrp)}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className={`text-sm font-semibold ${l.lineTotal < 0 ? 'text-red-700' : ''}`}>
                {inr(l.lineTotal)}
              </div>
              <button
                type="button"
                className="rounded-lg p-1 hover:bg-white"
                onClick={() => {
                  if (!isOwner && l.lineKind === 'sale' && cart.filter((x) => x.lineKind === 'sale').length <= 1) {
                    // limited void: cashiers can remove lines but warn
                  }
                  setCart((c) => c.filter((x) => x.key !== l.key))
                }}
              >
                <Trash2 className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="lf-label">Discount (optional)</span>
        <input
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          inputMode="decimal"
          className="lf-input"
        />
        {!isOwner && (
          <span className="text-[10px] text-slate-500">
            Cashier cap {inr(store?.maxCashierDiscount ?? 100)} / {store?.maxCashierDiscountPct ?? 5}%
          </span>
        )}
      </label>
      <label className="mt-2 block">
        <span className="lf-label">Customer phone {mode === 'credit' ? '(required for udhaar)' : '(optional)'}</span>
        <input
          value={phone}
          onChange={(e) => {
            const v = e.target.value
            setPhone(v)
            const hit = customers.find((c) => c.phone === v.trim())
            if (hit) {
              setCustomerId(hit.id)
              setCustomerName(hit.name)
              setCustomerGstin(hit.gstin || '')
            } else {
              setCustomerId(null)
            }
          }}
          inputMode="tel"
          className="lf-input"
          list="lf-customer-phones"
        />
        <datalist id="lf-customer-phones">
          {customers.map((c) => (
            <option key={c.id} value={c.phone}>
              {c.name}
            </option>
          ))}
        </datalist>
      </label>
      {(mode === 'credit' || customerId) && (
        <label className="mt-2 block">
          <span className="lf-label">Customer name</span>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="lf-input"
            placeholder="Name for ledger"
          />
        </label>
      )}
      {(wholesaleMode || mode === 'credit') && (
        <label className="mt-2 block">
          <span className="lf-label">Customer GSTIN (optional)</span>
          <input
            value={customerGstin}
            onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
            className="lf-input font-mono uppercase"
            placeholder="22AAAAA0000A1Z5"
          />
        </label>
      )}
      {mode === 'credit' && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Full bill will be posted as udhaar
          {customerId ? ` · balance now ${customers.find((c) => c.id === customerId)?.balance ?? 0}` : ''}
        </div>
      )}
      <div className="mt-3 rounded-2xl bg-brand-800 px-3 py-2.5 text-white">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white/80">Total (incl.)</span>
          <span className="text-2xl font-bold tracking-tight tabular-nums">{inr(grand)}</span>
        </div>
        {isOwner && (
          <div className="mt-1 text-[11px] text-white/60">
            Taxable {inr(taxableTotal)} · GST {inr(gstTotal)} (internal)
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {(['cash', 'upi', 'credit', 'split'] as PaymentMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`min-h-[48px] rounded-xl text-xs font-bold uppercase tracking-wide transition ${
              mode === m ? 'bg-brand-600 text-white shadow-soft' : 'bg-brand-50 text-brand-800 hover:bg-brand-100'
            }`}
          >
            {m === 'credit' ? 'udhaar' : m}
          </button>
        ))}
      </div>
      {mode === 'cash' && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-xs">
            Tendered
            <input
              value={cashTendered}
              onChange={(e) => setCashTendered(e.target.value)}
              inputMode="decimal"
              className="lf-input min-h-[44px]"
            />
          </label>
          <div className="rounded-xl bg-green-50 px-2 py-1 text-center">
            <div className="text-[10px] uppercase text-green-700">Change</div>
            <div className="text-lg font-bold tabular-nums text-green-800">{inr(changeDue)}</div>
          </div>
        </div>
      )}
      {mode === 'split' && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <input value={cash} onChange={(e) => setCash(e.target.value)} placeholder="Cash" className="lf-input min-h-[40px]" />
          <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="UPI" className="lf-input min-h-[40px]" />
          <input value={card} onChange={(e) => setCard(e.target.value)} placeholder="Card" className="lf-input min-h-[40px]" />
        </div>
      )}
      {(mode === 'upi' || (mode === 'split' && upiDue > 0)) && (
        <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 p-2 text-center">
          {store?.upiVpa ? (
            <>
              {upiQr && <img src={upiQr} alt="UPI QR" className="mx-auto h-40 w-40 rounded-lg bg-white p-1" />}
              <div className="mt-1 text-xs font-semibold text-blue-900">
                Pay {inr(upiDue)} · {store.upiVpa}
              </div>
            </>
          ) : (
            <div className="text-xs text-amber-800">Set UPI ID in Settings to show QR</div>
          )}
          <input
            className="lf-input mt-2 min-h-[44px]"
            placeholder="UTR / UPI ref (required)"
            value={upiRef}
            onChange={(e) => setUpiRef(e.target.value)}
          />
          {store?.razorpayKeyId ? (
            <button
              type="button"
              className="lf-btn-secondary mt-2 w-full text-sm"
              onClick={() => {
                void (async () => {
                  try {
                    if (!isRemoteSyncEnabled()) {
                      setErr('Razorpay intent needs Cloud/LAN sync server')
                      return
                    }
                    const res = await api<{ orderId: string; keyId: string }>('/api/payments/razorpay/create-order', {
                      method: 'POST',
                      body: JSON.stringify({ amount: upiDue, receipt: `pos-${Date.now()}` }),
                    })
                    setRzOrderId(String(res.orderId || ''))
                    setUpiRef(String(res.orderId || ''))
                    setErr('')
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Razorpay unavailable — use static QR + UTR')
                  }
                })()
              }}
            >
              {rzOrderId ? `Razorpay order ${rzOrderId}` : 'Create Razorpay UPI intent'}
            </button>
          ) : null}
        </div>
      )}
      <button type="button" onClick={() => void checkout()} className="lf-btn-primary mt-3 min-h-[52px] w-full text-base">
        {mode === 'credit' ? `Udhaar ${inr(grand)}` : `Pay ${inr(grand)}`}
      </button>
    </aside>
  )


  async function softVoidSale() {
    if (!done || !isOwner) return
    const reason = voidReason.trim() || window.prompt('Void reason (required)') || ''
    if (!reason.trim()) return
    const sale = done.sale
    const items = done.items
    const t = new Date().toISOString()
    await db.transaction(
      'rw',
      [db.sales, db.products, db.productSizes, db.fabricRolls, db.customers, db.stockLedger, db.outbox, db.auditLog],
      async () => {
        for (const it of items) {
          if ((it.lineKind || 'sale') === 'return') continue
          const absQty = Math.abs(it.quantity)
          if (it.fabricRollId && it.productType === 'fabric') {
            const metres = it.unit === 'cm' ? absQty / 100 : absQty
            const roll = await db.fabricRolls.get(it.fabricRollId)
            if (roll) {
              await db.fabricRolls.update(roll.id, {
                remainingMetres: Number(roll.remainingMetres) + metres,
                updatedAt: t,
              })
            }
            const prod = await db.products.get(it.productId)
            if (prod) {
              await db.products.update(it.productId, {
                quantity: Number(prod.quantity) + metres,
                updatedAt: t,
              })
            }
          } else {
            await applyLocalStockDelta({
              productId: it.productId,
              productType: it.productType,
              colour: it.colour,
              size: it.size,
              unit: it.unit,
              quantity: absQty,
              direction: 1,
              reason: 'adjust',
              refType: 'void',
              refId: sale.id,
            })
          }
        }
        const credit = Number(sale.creditAmount || 0)
        if (sale.customerId && credit > 0) {
          const c = await db.customers.get(sale.customerId)
          if (c) {
            const balance = Math.round((Number(c.balance) - credit) * 100) / 100
            await db.customers.update(c.id, { balance, updatedAt: t })
            await enqueue('customer', { ...c, balance, updatedAt: t }, c.id)
          }
        }
        const voided = {
          ...sale,
          status: 'voided' as const,
          voidReason: reason,
          voidedAt: t,
          voidedBy: user?.id || null,
        }
        await db.sales.put(voided)
        await writeAudit({
          action: 'void',
          entityType: 'sale',
          entityId: sale.id,
          userId: user?.id,
          userName: user?.name,
          detail: { reason, billNo: sale.billNo, grandTotal: sale.grandTotal },
        })
        await enqueue('sale', { ...voided, items }, sale.id)
      },
    )
    void flushOutbox()
    setDone(null)
    setVoidReason('')
  }


  return (
    <div>
      {/* Mobile: cart-first tabs */}
      <div className="mb-3 flex gap-2 lg:hidden">
        <button
          type="button"
          className={`min-h-[44px] flex-1 rounded-xl text-sm font-bold ${mobileTab === 'cart' ? 'bg-brand-700 text-white' : 'bg-white text-brand-800'}`}
          onClick={() => setMobileTab('cart')}
        >
          Bill ({cart.length})
        </button>
        <button
          type="button"
          className={`min-h-[44px] flex-1 rounded-xl text-sm font-bold ${mobileTab === 'catalog' ? 'bg-brand-700 text-white' : 'bg-white text-brand-800'}`}
          onClick={() => setMobileTab('catalog')}
        >
          + Add
        </button>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_400px]">
        <div className={mobileTab === 'catalog' ? 'block' : 'hidden lg:block'}>{catalogPane}</div>
        <div className={mobileTab === 'cart' ? 'block' : 'hidden lg:block'}>{billPane}</div>
      </div>

      {scanToast && (
        <div
          className={`fixed left-1/2 top-16 z-[90] max-w-sm -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
            scanToast.kind === 'ok' ? 'bg-emerald-700 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {scanToast.text}
        </div>
      )}

      <CameraBarcodeScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetect={handleBarcodeScan}
      />

      {disambig && (
        <div className="lf-modal-backdrop z-[85]">
          <div className="lf-modal">
            <h2 className="mb-2 text-lg font-bold text-brand-800">Multiple barcode matches</h2>
            <p className="mb-3 text-sm text-slate-600">Pick the correct variant to add to the bill.</p>
            <div className="max-h-72 space-y-2 overflow-auto">
              {disambig.map((h, i) => (
                <button
                  key={`${h.product.id}-${h.variant?.id || i}`}
                  type="button"
                  className="lf-btn-secondary w-full justify-start text-left"
                  onClick={() => {
                    setDisambig(null)
                    if (h.product.type === 'garment' && h.variant?.size) {
                      const ok = addVariantToCart(h.product, h.variant.colour, h.variant.size, 1)
                      if (ok) {
                        playScanBeep('ok')
                        showToast('ok', `Added ${h.product.name}`)
                      }
                    } else {
                      openProduct(h.product, h.variant?.colour, h.variant?.size)
                    }
                  }}
                >
                  <span className="font-semibold">{h.product.name}</span>
                  <span className="text-xs text-slate-500">
                    {[h.variant?.colour, h.variant?.size, h.variant?.barcode || h.product.sku]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="lf-btn-ghost mt-3 w-full" onClick={() => setDisambig(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pick && (
        <div className="lf-modal-backdrop">
          <div className="lf-modal max-h-[92vh] overflow-auto">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="text-lg font-bold tracking-tight text-brand-900">{pick.name}</div>
                <div className="text-sm text-slate-500">
                  {typeLabel(pick.type)} ·{' '}
                  {inr(
                    wholesaleMode
                      ? normalizeProductPrices(pick as unknown as Record<string, unknown>).wholesalePrice
                      : normalizeProductPrices(pick as unknown as Record<string, unknown>).salePrice,
                  )}
                  {pick.type === 'fabric' ? ' / m' : ''}
                  {wholesaleMode ? ' (wholesale)' : ' (sale)'}
                  {' · '}MRP{' '}
                  {inr(normalizeProductPrices(pick as unknown as Record<string, unknown>).mrp)}
                </div>
              </div>
              <button type="button" onClick={() => setPick(null)}>
                <X />
              </button>
            </div>
            {pick.type === 'garment' && (
              <div className="space-y-3">
                <ColourSwatches
                  colours={coloursOf(pick.sizes || [])}
                  value={pickColour}
                  onChange={(c) => {
                    setPickColour(c)
                    const forCol = sizesForColour(pick.sizes || [], c)
                    const first = forCol.find((s) => s.quantity > 0) || forCol[0]
                    setPickSize(first?.size || '')
                  }}
                  stockByColour={Object.fromEntries(
                    coloursOf(pick.sizes || []).map((c) => [
                      c,
                      sizesForColour(pick.sizes || [], c).reduce((a, s) => a + Number(s.quantity), 0),
                    ]),
                  )}
                />
                <SizeChips
                  sizes={sizesForColour(pick.sizes || [], pickColour).map((s) => ({
                    size: s.size,
                    quantity: s.quantity,
                  }))}
                  value={pickSize}
                  onChange={setPickSize}
                  showStock
                  disableEmpty
                  allowCustom={false}
                  onlyExisting
                />
              </div>
            )}
            {pick.type === 'fabric' && (
              <div className="mb-3 space-y-3">
                <div className="text-sm text-slate-600">Stock {pick.quantity} m available</div>
                {(() => {
                  const rolls = fabricRolls.filter((r) => r.productId === pick.id)
                  if (!rolls.length) {
                    return (
                      <label className="block text-sm">
                        Shade (optional)
                        <input
                          className="lf-input"
                          value={pickShade}
                          onChange={(e) => setPickShade(e.target.value)}
                          placeholder="e.g. 243"
                        />
                      </label>
                    )
                  }
                  return (
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Select roll / shade</div>
                      <div className="max-h-40 space-y-1 overflow-auto">
                        {rolls.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setPickRollId(r.id)
                              setPickShade(r.shade || '')
                            }}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                              pickRollId === r.id
                                ? 'border-brand-500 bg-brand-50'
                                : 'border-brand-100 bg-white'
                            }`}
                          >
                            <span>
                              {r.shade || 'No shade'} · {r.width}&quot;
                              {r.lot ? ` · Lot ${r.lot}` : ''}
                              {isRemnant(r) ? (
                                <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">
                                  REMNANT
                                </span>
                              ) : null}
                            </span>
                            <span className="font-mono font-semibold">{r.remainingMetres} m</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <MetreKeypad
                  value={pickQty}
                  onChange={setPickQty}
                  unitLabel={
                    pickRollId
                      ? `MTR · ${(fabricRolls.find((r) => r.id === pickRollId)?.shade || pickShade || 'roll').slice(0, 12)}`
                      : 'MTR'
                  }
                />
              </div>
            )}
            {pick.type === 'saree' && (
              <label className="mt-2 block text-sm font-medium">
                Quantity
                <input
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                  inputMode="numeric"
                  className="lf-input min-h-[48px]"
                />
              </label>
            )}
            {pick.type === 'garment' && (
              <label className="mt-3 block text-sm font-medium">
                Quantity
                <input
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                  inputMode="numeric"
                  className="lf-input min-h-[48px]"
                />
              </label>
            )}
            <button type="button" onClick={addPicked} className="lf-btn-primary mt-3 min-h-[48px] w-full">
              Add to bill
            </button>
          </div>
        </div>
      )}

      {showExchange && (
        <div className="lf-modal-backdrop">
          <div className="lf-modal max-h-[90vh] overflow-auto">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-brand-900">Return / exchange</h3>
              <button type="button" onClick={() => setShowExchange(false)}>
                <X />
              </button>
            </div>
            {!exchangeSale ? (
              <>
                <input
                  className="lf-input mb-2"
                  placeholder="Bill no or phone"
                  value={exchangeQuery}
                  onChange={(e) => setExchangeQuery(e.target.value)}
                />
                <div className="space-y-1">
                  {exchangeMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="block w-full rounded-xl border p-2 text-left text-sm"
                      onClick={() => {
                        setExchangeSale(s)
                        setExchangeQty({})
                      }}
                    >
                      <div className="flex justify-between font-semibold">
                        <span>{s.billNo}</span>
                        <span>{inr(s.grandTotal)}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(s.datetime).toLocaleString('en-IN')}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-2 text-sm font-semibold">Return from {exchangeSale.billNo}</div>
                {allSaleItems
                  .filter((i) => i.saleId === exchangeSale.id && (i.lineKind || 'sale') === 'sale')
                  .map((it) => (
                    <div key={it.id} className="mb-2 rounded-lg bg-cream p-2 text-sm">
                      <div className="font-medium">
                        {it.productName}{' '}
                        {it.colour && it.colour !== DEFAULT_COLOUR ? it.colour : ''}{' '}
                        {it.size ? `(${it.size})` : ''}
                      </div>
                      <div className="text-xs text-slate-500">
                        Sold {qtyLabel(it.quantity, it.unit)} @ {inr(it.rate)}
                      </div>
                      <input
                        className="mt-1 lf-input min-h-[40px]"
                        placeholder="Return qty"
                        value={exchangeQty[it.id] || ''}
                        onChange={(e) => setExchangeQty((p) => ({ ...p, [it.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                <input
                  className="lf-input mb-2"
                  placeholder="Reason"
                  value={exchangeReason}
                  onChange={(e) => setExchangeReason(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="lf-btn-secondary min-h-[44px]" onClick={() => setExchangeSale(null)}>
                    Back
                  </button>
                  <button type="button" className="lf-btn-primary min-h-[44px]" onClick={addExchangeReturns}>
                    Add returns to cart
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Then add replacement items. Customer pays the net difference.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {showHold && (
        <div className="lf-modal-backdrop">
          <div className="lf-modal">
            <div className="mb-2 flex justify-between">
              <h3 className="font-bold">Recall held bill</h3>
              <button type="button" onClick={() => setShowHold(false)}>
                <X />
              </button>
            </div>
            {held.length === 0 && <div className="text-sm text-slate-500">No held bills</div>}
            {held.map((h) => (
              <button
                key={h.id}
                type="button"
                className="mb-1 block w-full rounded-xl border p-2 text-left text-sm"
                onClick={() => void recallBill(h.id)}
              >
                <div className="font-semibold">{h.label}</div>
                <div className="text-xs text-slate-500">{new Date(h.createdAt).toLocaleString('en-IN')}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/45 p-3 backdrop-blur-[2px]">
          <div className="max-h-[95vh] w-full max-w-md overflow-auto rounded-3xl bg-white p-4 shadow-lift">
            <ReceiptView store={store} sale={done.sale} items={done.items} />
            <div className="mt-3 grid grid-cols-2 gap-2 print:hidden">
              <button type="button" onClick={printReceipt} className="lf-btn-primary min-h-[48px]">
                <Printer className="h-4 w-4" /> Print / PDF
              </button>
              <button type="button" onClick={() => setDone(null)} className="lf-btn-secondary min-h-[48px]">
                New sale
              </button>
            </div>
            {isOwner && done.sale.status !== 'voided' && (
              <div className="mt-2 print:hidden">
                <input
                  className="lf-input mb-2"
                  placeholder="Void reason"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                />
                <button
                  type="button"
                  className="w-full rounded-xl border border-red-200 bg-red-50 py-2 text-sm font-semibold text-red-700"
                  onClick={() => void softVoidSale()}
                >
                  Soft void bill (restock)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
