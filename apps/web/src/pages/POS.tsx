import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Printer, Search, Trash2, X } from 'lucide-react'
import { useAuth } from '../auth'
import { ReceiptView, printReceipt } from '../components/Receipt'
import { SizeChips } from '../components/SizeChips'
import { db, enqueue, getActiveCategories, productsWithSizes } from '../db'
import { inr, qtyLabel, stockQtyOfLine, typeLabel } from '../lib/format'
import { nextBillNo, uid } from '../lib/ids'
import { flushOutbox } from '../sync'
import { normalizeProductPrices } from '../lib/pricing'
import type { PaymentMode, Product, ProductType, Sale, SaleItem, StoreProfile } from '../types'

type CartLine = {
  key: string
  productId: string
  productName: string
  productType: ProductType
  sku: string
  size?: string
  quantity: number
  unit: string
  rate: number
  lineTotal: number
}

function availableStock(p: Product, size?: string) {
  if (p.type === 'garment') {
    const s = p.sizes?.find((x) => x.size === size)
    return Number(s?.quantity || 0)
  }
  return Number(p.quantity || 0)
}

export function POS() {
  const { user } = useAuth()
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const categories = useLiveQuery(() => getActiveCategories(), []) || []
  const sales = useLiveQuery(() => db.sales.toArray(), []) || []
  const store = useLiveQuery(() => db.store.get('store-1'), []) as StoreProfile | undefined
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState<'all' | string>('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState('')
  const [phone, setPhone] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [cash, setCash] = useState('')
  const [upi, setUpi] = useState('')
  const [card, setCard] = useState('')
  const [pick, setPick] = useState<Product | null>(null)
  const [pickSize, setPickSize] = useState('')
  const [pickQty, setPickQty] = useState('1')
  const [pickUnit, setPickUnit] = useState<'metre' | 'cm'>('metre')
  const [done, setDone] = useState<{ sale: Sale; items: SaleItem[] } | null>(null)
  const [err, setErr] = useState('')
  const [wholesaleMode, setWholesaleMode] = useState(false)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => {
      if (p.deletedAt) return false
      if (catFilter !== 'all' && p.categoryId !== catFilter) return false
      if (!s) return true
      const catName = categories.find((c) => c.id === p.categoryId)?.name?.toLowerCase() || ''
      return (
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.type.includes(s) ||
        catName.includes(s)
      )
    })
  }, [products, q, catFilter, categories])

  const sub = cart.reduce((a, l) => a + l.lineTotal, 0)
  const disc = Number(discount) || 0
  const grand = Math.max(0, Math.round((sub - disc) * 100) / 100)

  useEffect(() => {
    if (mode !== 'split') return
    const c = Number(cash) || 0
    const u = Number(upi) || 0
    const r = Math.max(0, Math.round((grand - c - u) * 100) / 100)
    setCard(String(r))
  }, [cash, upi, grand, mode])

  function openProduct(p: Product) {
    setErr('')
    setPick(p)
    setPickQty('1')
    if (p.type === 'garment') {
      const first = p.sizes?.find((s) => s.quantity > 0)
      setPickSize(first?.size || '')
    } else {
      setPickSize('')
    }
    setPickUnit((p.fabricSellUnit as 'metre' | 'cm') || 'metre')
  }

  function addPicked() {
    if (!pick) return
    const qty = Number(pickQty)
    if (!qty || qty <= 0) {
      setErr('Enter quantity / length')
      return
    }
    if (pick.type === 'garment' && !pickSize) {
      setErr('Size is required for garments')
      return
    }
    let unit = 'piece'
    let stockNeed = qty
    if (pick.type === 'fabric') {
      unit = pickUnit
      stockNeed = pickUnit === 'cm' ? qty / 100 : qty
    }
    const size = pick.type === 'garment' ? pickSize : undefined
    const avail = availableStock(pick, size)
    const already = cart
      .filter((c) => c.productId === pick.id && c.size === size)
      .reduce((a, c) => a + stockQtyOfLine(c.unit, c.quantity), 0)
    if (avail - already + 1e-9 < stockNeed) {
      setErr(`Not enough stock (available ${avail})`)
      return
    }
    const prices = normalizeProductPrices(pick as unknown as Record<string, unknown>)
    const rate = wholesaleMode ? prices.wholesalePrice : prices.salePrice
    const lineTotal = Math.round((pick.type === 'fabric' ? stockNeed * rate : qty * rate) * 100) / 100
    const key = `${pick.id}-${size || ''}-${unit}`
    setCart((prev) => {
      const i = prev.findIndex((x) => x.key === key)
      if (i >= 0) {
        const next = [...prev]
        const q2 = next[i].quantity + qty
        const need2 = pick.type === 'fabric' ? (unit === 'cm' ? q2 / 100 : q2) : q2
        next[i] = {
          ...next[i],
          quantity: q2,
          lineTotal: Math.round((pick.type === 'fabric' ? need2 * rate : q2 * rate) * 100) / 100,
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
          sku: pick.sku,
          size,
          quantity: qty,
          unit,
          rate,
          lineTotal,
        },
      ]
    })
    setPick(null)
    setErr('')
  }

  async function checkout() {
    setErr('')
    if (!cart.length) {
      setErr('Cart is empty')
      return
    }
    if (mode === 'split') {
      const sum = (Number(cash) || 0) + (Number(upi) || 0) + (Number(card) || 0)
      if (Math.abs(sum - grand) > 0.05) {
        setErr('Split amounts must equal total')
        return
      }
    }
    const id = uid()
    const billNo = nextBillNo(sales.map((s) => s.billNo))
    const datetime = new Date().toISOString()
    const items: SaleItem[] = cart.map((c) => ({
      id: uid(),
      saleId: id,
      productId: c.productId,
      productName: c.productName,
      productType: c.productType,
      sku: c.sku,
      size: c.size,
      quantity: c.quantity,
      unit: c.unit,
      rate: c.rate,
      lineTotal: c.lineTotal,
    }))
    const sale: Sale = {
      id,
      billNo,
      datetime,
      cashierId: user?.id || '',
      cashierName: user?.name || '',
      customerPhone: phone.trim(),
      paymentMode: mode,
      cashAmount: mode === 'cash' ? grand : mode === 'split' ? Number(cash) || 0 : 0,
      upiAmount: mode === 'upi' ? grand : mode === 'split' ? Number(upi) || 0 : 0,
      cardAmount: mode === 'card' ? grand : mode === 'split' ? Number(card) || 0 : 0,
      discount: disc,
      grandTotal: grand,
      status: 'completed',
      notes: '',
      createdAt: datetime,
    }

    await db.transaction('rw', db.sales, db.saleItems, db.products, db.productSizes, db.outbox, async () => {
      await db.sales.add(sale)
      await db.saleItems.bulkAdd(items)
      for (const it of items) {
        const delta = -stockQtyOfLine(it.unit, it.quantity)
        if (it.productType === 'garment' && it.size) {
          const row = await db.productSizes.where({ productId: it.productId, size: it.size }).first()
          if (row) await db.productSizes.update(row.id, { quantity: Number(row.quantity) + delta })
        } else {
          const p = await db.products.get(it.productId)
          if (p) {
            await db.products.update(it.productId, {
              quantity: Number(p.quantity) + delta,
              updatedAt: datetime,
            })
          }
        }
      }
      await enqueue('sale', { ...sale, items }, sale.id)
    })
    void flushOutbox()
    setCart([])
    setDiscount('')
    setPhone('')
    setCash('')
    setUpi('')
    setCard('')
    setDone({ sale, items })
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_380px]">
      <section>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, SKU, category…"
            className="lf-input min-h-[48px] pl-10 shadow-soft"
          />
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
                      {inr(
                        wholesaleMode
                          ? normalizeProductPrices(p as unknown as Record<string, unknown>).wholesalePrice
                          : normalizeProductPrices(p as unknown as Record<string, unknown>).salePrice,
                      )}
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

      <aside className="lf-card sticky bottom-20 z-10 p-4 lg:sticky lg:top-3 lg:bottom-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="lf-section-title text-base">Bill</h2>
          <button
            type="button"
            onClick={() => {
              setWholesaleMode((v) => !v)
              setCart([])
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              wholesaleMode ? 'bg-amber-500 text-white shadow-soft' : 'bg-brand-50 text-brand-800'
            }`}
            title="Clears cart when switching"
          >
            {wholesaleMode ? 'Wholesale bill' : 'Retail bill'}
          </button>
        </div>
        {err && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-700">{err}</div>}
        <div className="max-h-52 space-y-1.5 overflow-auto pr-0.5">
          {cart.length === 0 && <div className="rounded-xl bg-cream-100 px-3 py-4 text-center text-sm text-slate-500">Tap a product to add</div>}
          {cart.map((l) => (
            <div key={l.key} className="flex items-start justify-between gap-2 rounded-xl border border-brand-50 bg-cream-50 px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-brand-900">{l.productName}</div>
                <div className="text-xs text-slate-500">
                  {l.size ? `Size ${l.size} · ` : ''}
                  {qtyLabel(l.quantity, l.unit)} × {inr(l.rate)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="text-sm font-semibold">{inr(l.lineTotal)}</div>
                <button type="button" className="rounded-lg p-1 hover:bg-white" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
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
        </label>
        <label className="mt-2 block">
          <span className="lf-label">Customer phone (optional)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            className="lf-input"
          />
        </label>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-brand-800 px-3 py-2.5 text-white">
          <span className="text-sm font-medium text-white/80">Total</span>
          <span className="text-lg font-bold tracking-tight">{inr(grand)}</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(['cash', 'upi', 'card', 'split'] as PaymentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`min-h-[44px] rounded-xl text-xs font-bold uppercase tracking-wide transition ${
                mode === m ? 'bg-brand-600 text-white shadow-soft' : 'bg-brand-50 text-brand-800 hover:bg-brand-100'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {mode === 'split' && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input value={cash} onChange={(e) => setCash(e.target.value)} placeholder="Cash" className="lf-input min-h-[40px]" />
            <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="UPI" className="lf-input min-h-[40px]" />
            <input value={card} onChange={(e) => setCard(e.target.value)} placeholder="Card" className="lf-input min-h-[40px]" />
          </div>
        )}
        <button
          type="button"
          onClick={() => void checkout()}
          className="lf-btn-primary mt-3 min-h-[48px] w-full text-base"
        >
          Complete sale
        </button>
      </aside>

      {pick && (
        <div className="lf-modal-backdrop">
          <div className="lf-modal">
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
                </div>
              </div>
              <button type="button" onClick={() => setPick(null)}>
                <X />
              </button>
            </div>
            {pick.type === 'garment' && (
              <SizeChips
                sizes={pick.sizes || []}
                value={pickSize}
                onChange={setPickSize}
                showStock
                disableEmpty
                allowCustom={false}
                onlyExisting
              />
            )}
            {pick.type === 'fabric' && (
              <div className="mb-3">
                <div className="mb-1 text-sm font-medium">Length · stock {pick.quantity} m</div>
                <div className="mb-2 flex gap-2">
                  {(['metre', 'cm'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setPickUnit(u)}
                      className={`min-h-[44px] flex-1 rounded-xl border font-semibold ${
                        pickUnit === u ? 'border-brand-500 bg-brand-50' : 'border-slate-200'
                      }`}
                    >
                      {u === 'metre' ? 'Metre' : 'cm'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="block text-sm font-medium">
              {pick.type === 'fabric' ? `Enter length (${pickUnit === 'cm' ? 'cm' : 'm'})` : 'Quantity'}
              <input
                value={pickQty}
                onChange={(e) => setPickQty(e.target.value)}
                inputMode="decimal"
                className="lf-input min-h-[48px]"
              />
            </label>
            <button
              type="button"
              onClick={addPicked}
              className="lf-btn-primary mt-3 min-h-[48px] w-full"
            >
              Add to bill
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/45 p-3 backdrop-blur-[2px]">
          <div className="max-h-[95vh] w-full max-w-md overflow-auto rounded-3xl bg-white p-4 shadow-lift">
            <ReceiptView store={store} sale={done.sale} items={done.items} />
            <div className="mt-3 grid grid-cols-2 gap-2 print:hidden">
              <button
                type="button"
                onClick={printReceipt}
                className="lf-btn-primary min-h-[48px]"
              >
                <Printer className="h-4 w-4" /> Print / PDF
              </button>
              <button
                type="button"
                onClick={() => setDone(null)}
                className="lf-btn-secondary min-h-[48px]"
              >
                New sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
