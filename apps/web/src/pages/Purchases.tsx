import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Trash2, X } from 'lucide-react'
import { db, enqueue, getRulesForProduct, productsWithSizes } from '../db'
import { useAuth } from '../auth'
import { inr, qtyLabel, typeLabel } from '../lib/format'
import { uid } from '../lib/ids'
import { computePricesFromPurchase, normalizeProductPrices, round2 as r2 } from '../lib/pricing'
import { flushOutbox } from '../sync'
import { STANDARD_SIZES, type Product } from '../types'

type Line = {
  key: string
  productId: string
  productName: string
  type: string
  size?: string
  quantity: number
  unit: string
  unitCost: number
  wholesalePrice: number
  mrp: number
  salePrice: number
  lineTotal: number
}

function round2(n: number) {
  return r2(n)
}

export function Purchases() {
  const { user } = useAuth()
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.deletedAt).toArray(), []) || []
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const purchases = useLiveQuery(() => db.purchases.orderBy('createdAt').reverse().toArray(), []) || []
  const items = useLiveQuery(() => db.purchaseItems.toArray(), []) || []

  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [billNo, setBillNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pick, setPick] = useState<Product | null>(null)
  const [size, setSize] = useState('')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [wholesale, setWholesale] = useState('')
  const [mrp, setMrp] = useState('')
  const [sale, setSale] = useState('')
  const [derivedTouched, setDerivedTouched] = useState(false)
  const [fabricUnit, setFabricUnit] = useState<'metre' | 'cm'>('metre')
  const [sizeQtys, setSizeQtys] = useState<Record<string, string>>({})
  const [customSize, setCustomSize] = useState('')
  const [q, setQ] = useState('')
  const [errors, setErrors] = useState<{ supplier?: string; lines?: string; add?: string }>({})
  const [saving, setSaving] = useState(false)

  const total = lines.reduce((a, l) => a + l.lineTotal, 0)

  const filteredProducts = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products
      .filter((p) => {
        if (!s) return true
        return p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
      })
      .slice(0, 10)
  }, [products, q])

  const garmentSizes = useMemo(() => {
    if (!pick || pick.type !== 'garment') return [] as string[]
    const known = new Set(STANDARD_SIZES as readonly string[])
    const extras = (pick.sizes || []).map((s) => s.size).filter((sz) => !known.has(sz))
    const fromQtys = Object.keys(sizeQtys).filter((sz) => !known.has(sz) && !extras.includes(sz))
    return [...STANDARD_SIZES, ...extras, ...fromQtys]
  }, [pick, sizeQtys])

  const previewQty = Number(qty) || 0
  const previewCost = Number(cost) || (pick?.costPrice ?? 0)
  const previewMetres =
    pick?.type === 'fabric' && fabricUnit === 'cm' ? previewQty / 100 : previewQty
  const previewTotal =
    pick?.type === 'fabric'
      ? round2(previewMetres * previewCost)
      : round2(previewQty * previewCost)

  const multiSizePreview = useMemo(() => {
    if (!pick || pick.type !== 'garment') return { count: 0, totalQty: 0, total: 0 }
    let count = 0
    let totalQty = 0
    for (const v of Object.values(sizeQtys)) {
      const n = Number(v)
      if (n > 0) {
        count++
        totalQty += n
      }
    }
    return { count, totalQty, total: round2(totalQty * previewCost) }
  }, [pick, sizeQtys, previewCost])

  function resetForm() {
    setSupplierId('')
    setBillNo('')
    setDate(new Date().toISOString().slice(0, 10))
    setNotes('')
    setLines([])
    setPick(null)
    setSize('')
    setQty('1')
    setCost('')
    setWholesale('')
    setMrp('')
    setSale('')
    setDerivedTouched(false)
    setFabricUnit('metre')
    setSizeQtys({})
    setCustomSize('')
    setQ('')
    setErrors({})
  }

  function openModal() {
    resetForm()
    setOpen(true)
  }

  async function selectProduct(p: Product) {
    const n = normalizeProductPrices(p as unknown as Record<string, unknown>)
    setPick(p)
    setCost(String(n.purchasePrice))
    setWholesale(String(n.wholesalePrice))
    setMrp(String(n.mrp))
    setSale(String(n.salePrice))
    setDerivedTouched(false)
    setSize('')
    setQty('1')
    setFabricUnit((p.fabricSellUnit as 'metre' | 'cm') || 'metre')
    const sq: Record<string, string> = {}
    for (const s of STANDARD_SIZES) sq[s] = ''
    for (const s of p.sizes || []) {
      if (!(s.size in sq)) sq[s.size] = ''
    }
    setSizeQtys(sq)
    setCustomSize('')
    setErrors((e) => ({ ...e, add: undefined }))
  }

  async function applyCostAndMaybeDerive(nextCost: string) {
    setCost(nextCost)
    if (derivedTouched || !pick) return
    const rules = await getRulesForProduct(pick)
    const purchase = Number(nextCost) || 0
    const derived = computePricesFromPurchase(purchase, rules)
    setWholesale(String(derived.wholesalePrice))
    setMrp(String(derived.mrp))
    setSale(String(derived.salePrice))
  }

  async function recalculateFromPurchase() {
    if (!pick) return
    const rules = await getRulesForProduct(pick)
    const purchase = Number(cost) || 0
    const derived = computePricesFromPurchase(purchase, rules)
    setWholesale(String(derived.wholesalePrice))
    setMrp(String(derived.mrp))
    setSale(String(derived.salePrice))
    setDerivedTouched(false)
  }

  function clearPickKeepSearch() {
    setPick(null)
    setSize('')
    setQty('1')
    setSizeQtys({})
    setCustomSize('')
    setDerivedTouched(false)
    setErrors((e) => ({ ...e, add: undefined }))
  }

  function addLine() {
    if (!pick) return
    const unitCost = Number(cost)
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setErrors((e) => ({ ...e, add: 'Enter a valid unit cost' }))
      return
    }
    const wholesalePrice = Number(wholesale)
    const mrpPrice = Number(mrp)
    const salePrice = Number(sale)
    if (![wholesalePrice, mrpPrice, salePrice].every((x) => Number.isFinite(x) && x >= 0)) {
      setErrors((e) => ({ ...e, add: 'Enter valid wholesale, MRP, and sale prices' }))
      return
    }
    const priceFields = { wholesalePrice, mrp: mrpPrice, salePrice }

    if (pick.type === 'garment') {
      const filled = Object.entries(sizeQtys)
        .map(([sz, v]) => ({ size: sz, quantity: Number(v) }))
        .filter((x) => x.quantity > 0)

      if (filled.length > 0) {
        setLines((ls) => {
          const next = [...ls]
          for (const row of filled) {
            const keyMatch = next.findIndex(
              (l) => l.productId === pick.id && l.size === row.size && l.unit === 'piece',
            )
            if (keyMatch >= 0) {
              const prev = next[keyMatch]
              const quantity = prev.quantity + row.quantity
              next[keyMatch] = {
                ...prev,
                quantity,
                unitCost,
                ...priceFields,
                lineTotal: round2(quantity * unitCost),
              }
            } else {
              next.push({
                key: uid(),
                productId: pick.id,
                productName: pick.name,
                type: pick.type,
                size: row.size,
                quantity: row.quantity,
                unit: 'piece',
                unitCost,
                ...priceFields,
                lineTotal: round2(row.quantity * unitCost),
              })
            }
          }
          return next
        })
        const cleared: Record<string, string> = {}
        for (const k of Object.keys(sizeQtys)) cleared[k] = ''
        setSizeQtys(cleared)
        setSize('')
        setQty('1')
        setErrors((e) => ({ ...e, add: undefined, lines: undefined }))
        return
      }

      const quantity = Number(qty)
      if (!quantity || quantity <= 0) {
        setErrors((e) => ({ ...e, add: 'Enter quantity for a size, or fill size qty fields' }))
        return
      }
      if (!size) {
        setErrors((e) => ({ ...e, add: 'Select a size (or enter qty per size below)' }))
        return
      }
      setLines((ls) => {
        const i = ls.findIndex((l) => l.productId === pick.id && l.size === size && l.unit === 'piece')
        if (i >= 0) {
          const next = [...ls]
          const quantity2 = next[i].quantity + quantity
          next[i] = {
            ...next[i],
            quantity: quantity2,
            unitCost,
            ...priceFields,
            lineTotal: round2(quantity2 * unitCost),
          }
          return next
        }
        return [
          ...ls,
          {
            key: uid(),
            productId: pick.id,
            productName: pick.name,
            type: pick.type,
            size,
            quantity,
            unit: 'piece',
            unitCost,
            ...priceFields,
            lineTotal: round2(quantity * unitCost),
          },
        ]
      })
      setSize('')
      setQty('1')
      setErrors((e) => ({ ...e, add: undefined, lines: undefined }))
      return
    }

    const quantity = Number(qty)
    if (!quantity || quantity <= 0) {
      setErrors((e) => ({ ...e, add: pick.type === 'fabric' ? 'Enter length' : 'Enter quantity' }))
      return
    }

    let storeQty = quantity
    let unit = 'piece'
    if (pick.type === 'fabric') {
      unit = 'metre'
      storeQty = fabricUnit === 'cm' ? quantity / 100 : quantity
      if (storeQty <= 0) {
        setErrors((e) => ({ ...e, add: 'Enter a valid length' }))
        return
      }
    }

    setLines((ls) => [
      ...ls,
      {
        key: uid(),
        productId: pick.id,
        productName: pick.name,
        type: pick.type,
        size: undefined,
        quantity: storeQty,
        unit,
        unitCost,
        ...priceFields,
        lineTotal: round2(storeQty * unitCost),
      },
    ])
    setQty(pick.type === 'fabric' ? '' : '1')
    setErrors((e) => ({ ...e, add: undefined, lines: undefined }))
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key))
  }

  function updateLine(
    key: string,
    patch: Partial<Pick<Line, 'quantity' | 'unitCost' | 'wholesalePrice' | 'mrp' | 'salePrice'>>,
  ) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l
        const quantity = patch.quantity != null ? patch.quantity : l.quantity
        const unitCost = patch.unitCost != null ? patch.unitCost : l.unitCost
        if (!Number.isFinite(quantity) || quantity <= 0) return l
        if (!Number.isFinite(unitCost) || unitCost < 0) return l
        return {
          ...l,
          quantity,
          unitCost,
          wholesalePrice: patch.wholesalePrice != null ? patch.wholesalePrice : l.wholesalePrice,
          mrp: patch.mrp != null ? patch.mrp : l.mrp,
          salePrice: patch.salePrice != null ? patch.salePrice : l.salePrice,
          lineTotal: round2(quantity * unitCost),
        }
      }),
    )
  }

  async function recalcLineFromPurchase(key: string) {
    const line = lines.find((l) => l.key === key)
    if (!line) return
    const prod = products.find((p) => p.id === line.productId)
    const rules = await getRulesForProduct(
      prod || { type: line.type as Product['type'], categoryId: undefined },
    )
    const derived = computePricesFromPurchase(line.unitCost, rules)
    updateLine(key, derived)
  }

  function addCustomSize() {
    const v = customSize.trim()
    if (!v) return
    setSizeQtys((p) => ({ ...p, [v]: p[v] || '' }))
    setSize(v)
    setCustomSize('')
  }

  function fillCommonPack() {
    // Quick wholesale pack: 2 of each standard size except Free size
    setSizeQtys((prev) => {
      const next = { ...prev }
      for (const sz of STANDARD_SIZES) {
        if (sz === 'Free size') continue
        if (sz in next) next[sz] = next[sz] && Number(next[sz]) > 0 ? next[sz] : '2'
        else next[sz] = '2'
      }
      return next
    })
  }

  async function save() {
    const nextErrors: typeof errors = {}
    if (!supplierId) nextErrors.supplier = 'Supplier is required'
    if (!lines.length) nextErrors.lines = 'Add at least one line item'
    if (nextErrors.supplier || nextErrors.lines) {
      setErrors(nextErrors)
      return
    }
    setSaving(true)
    try {
      const id = uid()
      const t = new Date().toISOString()
      const recItems = lines.map((l) => ({
        id: uid(),
        purchaseId: id,
        productId: l.productId,
        productName: l.productName,
        size: l.size,
        quantity: l.quantity,
        unit: l.unit,
        unitCost: l.unitCost,
        lineTotal: l.lineTotal,
      }))
      // Latest prices per product (last line wins)
      const latestPrices = new Map<
        string,
        { purchasePrice: number; wholesalePrice: number; mrp: number; salePrice: number }
      >()
      for (const l of lines) {
        latestPrices.set(l.productId, {
          purchasePrice: l.unitCost,
          wholesalePrice: l.wholesalePrice,
          mrp: l.mrp,
          salePrice: l.salePrice,
        })
      }

      await db.transaction('rw', db.purchases, db.purchaseItems, db.products, db.productSizes, db.outbox, async () => {
        await db.purchases.add({
          id,
          supplierId,
          billNo,
          date,
          total,
          notes,
          createdBy: user?.id,
          createdAt: t,
        })
        await db.purchaseItems.bulkAdd(recItems)
        for (const it of recItems) {
          if (it.size) {
            const row = await db.productSizes.where({ productId: it.productId, size: it.size }).first()
            if (row) await db.productSizes.update(row.id, { quantity: Number(row.quantity) + it.quantity })
            else
              await db.productSizes.add({
                id: `${it.productId}-${it.size}`,
                productId: it.productId,
                size: it.size,
                quantity: it.quantity,
              })
          } else {
            const p = await db.products.get(it.productId)
            if (p) await db.products.update(it.productId, { quantity: Number(p.quantity) + it.quantity, updatedAt: t })
          }
        }
        for (const [productId, prices] of latestPrices) {
          await db.products.update(productId, {
            purchasePrice: prices.purchasePrice,
            costPrice: prices.purchasePrice,
            wholesalePrice: prices.wholesalePrice,
            mrp: prices.mrp,
            salePrice: prices.salePrice,
            sellingPrice: prices.salePrice,
            updatedAt: t,
          })
        }
        await enqueue(
          'purchase',
          {
            id,
            supplierId,
            billNo,
            date,
            total,
            notes,
            createdBy: user?.id,
            createdAt: t,
            items: recItems,
            costUpdates: [...latestPrices.entries()].map(([productId, prices]) => ({
              productId,
              costPrice: prices.purchasePrice,
              purchasePrice: prices.purchasePrice,
              wholesalePrice: prices.wholesalePrice,
              mrp: prices.mrp,
              salePrice: prices.salePrice,
              sellingPrice: prices.salePrice,
            })),
          },
          id,
        )
      })
      void flushOutbox()
      setOpen(false)
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-800">Purchase bills</h1>
        <button
          type="button"
          className="min-h-[44px] rounded-xl bg-brand-600 px-3 font-semibold text-white"
          onClick={openModal}
        >
          New purchase
        </button>
      </div>
      <div className="space-y-2">
        {purchases.map((p) => {
          const its = items.filter((i) => i.purchaseId === p.id)
          const sup = suppliers.find((s) => s.id === p.supplierId)
          return (
            <div key={p.id} className="rounded-xl border bg-white p-3">
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold">{p.billNo || p.id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-500">
                    {p.date} · {sup?.name || 'Supplier'}
                  </div>
                </div>
                <div className="font-bold">{inr(p.total)}</div>
              </div>
              <ul className="mt-2 text-sm text-slate-600">
                {its.map((i) => (
                  <li key={i.id}>
                    {i.productName}
                    {i.size ? ` (${i.size})` : ''} · {qtyLabel(i.quantity, i.unit)} · {inr(i.unitCost)}
                    <span className="text-slate-400"> → </span>
                    {inr(i.lineTotal)}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {!purchases.length && (
          <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">
            No purchases yet. Tap <span className="font-semibold">New purchase</span> to stock in.
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="flex max-h-[96vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-pos sm:rounded-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-bold text-brand-900">Stock in — new purchase</h2>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => {
                  setOpen(false)
                  resetForm()
                }}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Supplier <span className="text-red-600">*</span>
              </label>
              <select
                className={`mb-1 min-h-[44px] w-full rounded-xl border px-2 ${
                  errors.supplier ? 'border-red-400 bg-red-50' : ''
                }`}
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value)
                  setErrors((er) => ({ ...er, supplier: undefined }))
                }}
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.supplier && <p className="mb-2 text-sm text-red-600">{errors.supplier}</p>}

              <div className="mb-3 mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Supplier bill no (optional)
                  </label>
                  <input
                    className="min-h-[44px] w-full rounded-xl border px-3"
                    placeholder="e.g. RT-4821"
                    value={billNo}
                    onChange={(e) => setBillNo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Date
                  </label>
                  <input
                    type="date"
                    className="min-h-[44px] w-full rounded-xl border px-3"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="mb-2 rounded-xl border border-brand-100 bg-cream/60 p-3">
                <div className="mb-2 text-sm font-semibold text-brand-800">Add line</div>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="min-h-[44px] w-full rounded-xl border bg-white pl-10 pr-3"
                    placeholder="Search products (name / SKU)"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                {!pick && (
                  <div className="mb-2 max-h-36 overflow-auto rounded-lg border bg-white">
                    {filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="block w-full border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-brand-50"
                        onClick={() => void selectProduct(p)}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {p.sku} · {typeLabel(p.type)} · purchase {inr(normalizeProductPrices(p as unknown as Record<string, unknown>).purchasePrice)}
                        </span>
                      </button>
                    ))}
                    {!filteredProducts.length && (
                      <div className="px-3 py-3 text-sm text-slate-500">No products match</div>
                    )}
                  </div>
                )}

                {pick && (
                  <div className="rounded-xl border bg-white p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-brand-900">{pick.name}</div>
                        <div className="text-xs text-slate-500">
                          {pick.sku} · {typeLabel(pick.type)} · purchase {inr(normalizeProductPrices(pick as unknown as Record<string, unknown>).purchasePrice)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                        onClick={clearPickKeepSearch}
                      >
                        Change
                      </button>
                    </div>

                    {pick.type === 'garment' && (
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Qty per size (multi-size stock-in)
                            </span>
                            <button
                              type="button"
                              className="rounded-lg border px-2 py-1 text-[11px] font-semibold text-brand-700"
                              onClick={fillCommonPack}
                            >
                              Fill common pack (2 each)
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                            {garmentSizes.map((sz) => (
                              <label key={sz} className="text-xs font-medium text-slate-600">
                                {sz}
                                <input
                                  inputMode="numeric"
                                  className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                  placeholder="0"
                                  value={sizeQtys[sz] || ''}
                                  onChange={(e) => {
                                    setSizeQtys((p) => ({ ...p, [sz]: e.target.value }))
                                    setSize(sz)
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              value={customSize}
                              onChange={(e) => setCustomSize(e.target.value)}
                              placeholder="Custom size (32, 34…)"
                              className="min-h-[40px] flex-1 rounded-lg border px-2 text-sm"
                            />
                            <button
                              type="button"
                              className="min-h-[40px] rounded-lg bg-brand-800 px-3 text-sm font-semibold text-white"
                              onClick={addCustomSize}
                            >
                              Add size
                            </button>
                          </div>
                        </div>

                        <div className="rounded-lg border border-dashed border-brand-200 bg-cream/40 p-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Or single size
                          </div>
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {garmentSizes.map((sz) => (
                              <button
                                key={sz}
                                type="button"
                                onClick={() => setSize(sz)}
                                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                                  size === sz
                                    ? 'border-brand-500 bg-brand-500 text-white'
                                    : 'border-brand-200 bg-white text-brand-800'
                                }`}
                              >
                                {sz}
                              </button>
                            ))}
                          </div>
                          <input
                            className="min-h-[40px] w-full rounded-lg border px-2 text-sm"
                            value={qty}
                            onChange={(e) => setQty(e.target.value)}
                            placeholder="Qty for selected size"
                            inputMode="decimal"
                          />
                        </div>


                        <div className="rounded-lg border border-brand-100 bg-cream/50 p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Prices (override OK)
                            </span>
                            <button
                              type="button"
                              className="rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700"
                              onClick={() => void recalculateFromPurchase()}
                            >
                              Recalculate from purchase
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Purchase
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={cost}
                                onChange={(e) => void applyCostAndMaybeDerive(e.target.value)}
                                placeholder="Purchase"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Wholesale
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={wholesale}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setWholesale(e.target.value)
                                }}
                                placeholder="Wholesale"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              MRP
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={mrp}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setMrp(e.target.value)
                                }}
                                placeholder="MRP"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Sale
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={sale}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setSale(e.target.value)
                                }}
                                placeholder="Sale"
                                inputMode="decimal"
                              />
                            </label>
                          </div>
                        </div>


                        {multiSizePreview.count > 0 ? (
                          <div className="text-sm text-slate-600">
                            Preview: {multiSizePreview.count} size(s), {multiSizePreview.totalQty} pcs →{' '}
                            <span className="font-semibold text-brand-800">{inr(multiSizePreview.total)}</span>
                          </div>
                        ) : size && previewQty > 0 ? (
                          <div className="text-sm text-slate-600">
                            Preview: {size} × {previewQty} →{' '}
                            <span className="font-semibold text-brand-800">{inr(previewTotal)}</span>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {pick.type === 'fabric' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          {(['metre', 'cm'] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => setFabricUnit(u)}
                              className={`min-h-[40px] flex-1 rounded-lg border text-sm font-semibold ${
                                fabricUnit === u ? 'border-brand-500 bg-brand-50 text-brand-800' : ''
                              }`}
                            >
                              {u === 'metre' ? 'Metre (m)' : 'Centimetre (cm)'}
                            </button>
                          ))}
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-500">
                            Length ({fabricUnit === 'metre' ? 'm' : 'cm'})
                          </label>
                          <input
                            className="min-h-[40px] w-full rounded-lg border px-2"
                            value={qty}
                            onChange={(e) => setQty(e.target.value)}
                            placeholder={fabricUnit === 'metre' ? 'e.g. 1.4' : 'e.g. 80'}
                            inputMode="decimal"
                          />
                        </div>

                        <div className="rounded-lg border border-brand-100 bg-cream/50 p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Prices (override OK)
                            </span>
                            <button
                              type="button"
                              className="rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700"
                              onClick={() => void recalculateFromPurchase()}
                            >
                              Recalculate from purchase
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Purchase / m
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={cost}
                                onChange={(e) => void applyCostAndMaybeDerive(e.target.value)}
                                placeholder="Purchase / m"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Wholesale
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={wholesale}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setWholesale(e.target.value)
                                }}
                                placeholder="Wholesale"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              MRP
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={mrp}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setMrp(e.target.value)
                                }}
                                placeholder="MRP"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Sale
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={sale}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setSale(e.target.value)
                                }}
                                placeholder="Sale"
                                inputMode="decimal"
                              />
                            </label>
                          </div>
                        </div>

                        {previewQty > 0 && (
                          <div className="text-sm text-slate-600">
                            Stores as {qtyLabel(previewMetres, 'metre')} · line{' '}
                            <span className="font-semibold text-brand-800">{inr(previewTotal)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {pick.type === 'saree' && (
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-500">Pieces</label>
                          <input
                            className="min-h-[40px] w-full rounded-lg border px-2"
                            value={qty}
                            onChange={(e) => setQty(e.target.value)}
                            placeholder="Qty"
                            inputMode="numeric"
                          />
                        </div>

                        <div className="rounded-lg border border-brand-100 bg-cream/50 p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Prices (override OK)
                            </span>
                            <button
                              type="button"
                              className="rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700"
                              onClick={() => void recalculateFromPurchase()}
                            >
                              Recalculate from purchase
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Purchase
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={cost}
                                onChange={(e) => void applyCostAndMaybeDerive(e.target.value)}
                                placeholder="Purchase"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Wholesale
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={wholesale}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setWholesale(e.target.value)
                                }}
                                placeholder="Wholesale"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              MRP
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={mrp}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setMrp(e.target.value)
                                }}
                                placeholder="MRP"
                                inputMode="decimal"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase text-slate-500">
                              Sale
                              <input
                                className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                                value={sale}
                                onChange={(e) => {
                                  setDerivedTouched(true)
                                  setSale(e.target.value)
                                }}
                                placeholder="Sale"
                                inputMode="decimal"
                              />
                            </label>
                          </div>
                        </div>

                        {previewQty > 0 && (
                          <div className="text-sm text-slate-600">
                            Preview: {previewQty} pcs →{' '}
                            <span className="font-semibold text-brand-800">{inr(previewTotal)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {errors.add && <p className="mt-2 text-sm text-red-600">{errors.add}</p>}

                    <button
                      type="button"
                      className="mt-3 min-h-[44px] w-full rounded-xl bg-brand-700 font-semibold text-white"
                      onClick={addLine}
                    >
                      {pick.type === 'garment' && multiSizePreview.count > 0
                        ? `Add ${multiSizePreview.count} size line(s)`
                        : 'Add line'}
                    </button>
                    {pick.type === 'garment' && (
                      <p className="mt-1 text-center text-[11px] text-slate-500">
                        Product stays selected — clear size/qty and add more sizes quickly
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mb-2">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-brand-800">Line items</h3>
                  {errors.lines && <span className="text-sm text-red-600">{errors.lines}</span>}
                </div>
                {!lines.length ? (
                  <div
                    className={`rounded-xl border border-dashed px-3 py-4 text-center text-sm text-slate-500 ${
                      errors.lines ? 'border-red-300 bg-red-50' : 'bg-white'
                    }`}
                  >
                    No lines yet — search a product above
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {lines.map((l) => (
                      <li key={l.key} className="rounded-xl border bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-brand-900">{l.productName}</div>
                            <div className="text-xs text-slate-500">
                              {typeLabel(l.type)}
                              {l.size ? ` · size ${l.size}` : ''} · {l.unit === 'metre' ? 'per metre' : 'per piece'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                            onClick={() => removeLine(l.key)}
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <div>
                            <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                              Qty ({l.unit === 'metre' ? 'm' : 'pcs'})
                            </label>
                            <input
                              className="min-h-[40px] w-full rounded-lg border px-2 text-sm"
                              value={String(l.quantity)}
                              inputMode="decimal"
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                if (e.target.value === '' || !Number.isFinite(n)) return
                                updateLine(l.key, { quantity: n })
                              }}
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                              Purchase
                            </label>
                            <input
                              className="min-h-[40px] w-full rounded-lg border px-2 text-sm"
                              value={String(l.unitCost)}
                              inputMode="decimal"
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                if (e.target.value === '' || !Number.isFinite(n)) return
                                updateLine(l.key, { unitCost: n })
                              }}
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                              Wholesale
                            </label>
                            <input
                              className="min-h-[40px] w-full rounded-lg border px-2 text-sm"
                              value={String(l.wholesalePrice)}
                              inputMode="decimal"
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                if (e.target.value === '' || !Number.isFinite(n)) return
                                updateLine(l.key, { wholesalePrice: n })
                              }}
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                              MRP
                            </label>
                            <input
                              className="min-h-[40px] w-full rounded-lg border px-2 text-sm"
                              value={String(l.mrp)}
                              inputMode="decimal"
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                if (e.target.value === '' || !Number.isFinite(n)) return
                                updateLine(l.key, { mrp: n })
                              }}
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                              Sale
                            </label>
                            <input
                              className="min-h-[40px] w-full rounded-lg border px-2 text-sm"
                              value={String(l.salePrice)}
                              inputMode="decimal"
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                if (e.target.value === '' || !Number.isFinite(n)) return
                                updateLine(l.key, { salePrice: n })
                              }}
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                              Line total
                            </label>
                            <div className="flex min-h-[40px] items-center rounded-lg bg-brand-50 px-2 text-sm font-bold text-brand-800">
                              {inr(l.lineTotal)}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="mt-2 text-[11px] font-semibold text-brand-700 underline"
                          onClick={() => void recalcLineFromPurchase(l.key)}
                        >
                          Recalculate prices from purchase
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Notes (optional)
                </label>
                <textarea
                  className="mb-2 min-h-[72px] w-full rounded-xl border p-2 text-sm"
                  placeholder="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="sticky bottom-0 border-t bg-white px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-slate-500">{lines.length} line(s)</span>
                <span className="text-lg font-bold text-brand-900">Total {inr(total)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-[48px] rounded-xl border font-semibold"
                  onClick={() => {
                    setOpen(false)
                    resetForm()
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="min-h-[48px] rounded-xl bg-brand-600 font-semibold text-white disabled:opacity-60"
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : 'Save purchase'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
