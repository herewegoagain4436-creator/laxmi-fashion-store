import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { PackagePlus, Plus, Search, Trash2, X } from 'lucide-react'
import { db, enqueue, getActiveCategories, getRulesForProduct, productsWithSizes } from '../db'
import { useAuth } from '../auth'
import { baseTypeHint, inr, qtyLabel, typeLabel } from '../lib/format'
import { uid } from '../lib/ids'
import {
  computePricesFromPurchase,
  defaultCategoryIdForType,
  normalizeProductPrices,
  round2 as r2,
} from '../lib/pricing'
import { flushOutbox } from '../sync'
import type { Category, Product, ProductSize, ProductType } from '../types'
import { STANDARD_SIZES } from '../types'

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

type AddMode = 'idle' | 'existing' | 'new'

function round2(n: number) {
  return r2(n)
}

function emptySizeQtys(extra: string[] = []) {
  const sq: Record<string, string> = {}
  for (const s of STANDARD_SIZES) sq[s] = ''
  for (const s of extra) if (!(s in sq)) sq[s] = ''
  return sq
}

export function Purchases() {
  const { user } = useAuth()
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.deletedAt).toArray(), []) || []
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const purchases = useLiveQuery(() => db.purchases.orderBy('createdAt').reverse().toArray(), []) || []
  const items = useLiveQuery(() => db.purchaseItems.toArray(), []) || []
  const categories =
    useLiveQuery(async () => {
      return getActiveCategories()
    }, []) || []

  const [listQ, setListQ] = useState('')
  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [billNo, setBillNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [addMode, setAddMode] = useState<AddMode>('idle')

  // Shared pick / qty / price state (existing + new)
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
  const [adding, setAdding] = useState(false)

  // New product fields
  const [newName, setNewName] = useState('')
  const [newSku, setNewSku] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newType, setNewType] = useState<ProductType>('garment')

  const total = lines.reduce((a, l) => a + l.lineTotal, 0)

  const catById = useMemo(() => {
    const m = new Map<string, Category>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  const filteredPurchases = useMemo(() => {
    const s = listQ.trim().toLowerCase()
    if (!s) return purchases
    return purchases.filter((p) => {
      const sup = suppliers.find((x) => x.id === p.supplierId)
      const its = items.filter((i) => i.purchaseId === p.id)
      const hay = [
        p.billNo || '',
        p.id,
        p.date,
        p.notes || '',
        sup?.name || '',
        ...its.map((i) => i.productName),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(s)
    })
  }, [purchases, listQ, suppliers, items])

  const filteredProducts = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products
      .filter((p) => {
        if (p.deletedAt) return false
        if (!s) return true
        const catName = catById.get(p.categoryId)?.name || ''
        return (
          p.name.toLowerCase().includes(s) ||
          p.sku.toLowerCase().includes(s) ||
          catName.toLowerCase().includes(s)
        )
      })
      .slice(0, 12)
  }, [products, q, catById])

  const activeType: ProductType | null =
    addMode === 'new' ? newType : pick ? pick.type : null

  const garmentSizes = useMemo(() => {
    if (activeType !== 'garment') return [] as string[]
    const known = new Set(STANDARD_SIZES as readonly string[])
    const extras =
      pick?.sizes?.map((s) => s.size).filter((sz) => !known.has(sz)) || []
    const fromQtys = Object.keys(sizeQtys).filter((sz) => !known.has(sz) && !extras.includes(sz))
    return [...STANDARD_SIZES, ...extras, ...fromQtys]
  }, [activeType, pick, sizeQtys])

  const previewQty = Number(qty) || 0
  const previewCost = Number(cost) || 0
  const previewMetres =
    activeType === 'fabric' && fabricUnit === 'cm' ? previewQty / 100 : previewQty
  const previewTotal =
    activeType === 'fabric'
      ? round2(previewMetres * previewCost)
      : round2(previewQty * previewCost)

  const multiSizePreview = useMemo(() => {
    if (activeType !== 'garment') return { count: 0, totalQty: 0, total: 0 }
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
  }, [activeType, sizeQtys, previewCost])

  function resetAddPanel() {
    setAddMode('idle')
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
    setNewName('')
    setNewSku('')
    setNewCategoryId('')
    setNewType('garment')
    setErrors((e) => ({ ...e, add: undefined }))
  }

  function resetForm() {
    setSupplierId('')
    setBillNo('')
    setDate(new Date().toISOString().slice(0, 10))
    setNotes('')
    setLines([])
    resetAddPanel()
    setErrors({})
  }

  function openModal() {
    resetForm()
    setOpen(true)
  }

  function startExisting() {
    resetAddPanel()
    setAddMode('existing')
  }

  function startNew() {
    resetAddPanel()
    const first = categories[0]
    const catId = first?.id || defaultCategoryIdForType('garment')
    const type = (first?.baseType || 'garment') as ProductType
    setNewCategoryId(catId)
    setNewType(type)
    setSizeQtys(emptySizeQtys())
    setQty(type === 'fabric' ? '' : '1')
    setFabricUnit('metre')
    setAddMode('new')
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
    setQty(p.type === 'fabric' ? '' : '1')
    setFabricUnit((p.fabricSellUnit as 'metre' | 'cm') || 'metre')
    setSizeQtys(emptySizeQtys((p.sizes || []).map((s) => s.size)))
    setCustomSize('')
    setErrors((e) => ({ ...e, add: undefined }))
  }

  async function applyCostAndMaybeDerive(nextCost: string, opts?: { categoryId?: string; type?: ProductType }) {
    setCost(nextCost)
    if (derivedTouched) return
    const type = opts?.type || activeType || 'garment'
    const categoryId = opts?.categoryId || (addMode === 'new' ? newCategoryId : pick?.categoryId)
    const rules = await getRulesForProduct({ type, categoryId })
    const purchase = Number(nextCost) || 0
    const derived = computePricesFromPurchase(purchase, rules)
    setWholesale(String(derived.wholesalePrice))
    setMrp(String(derived.mrp))
    setSale(String(derived.salePrice))
  }

  async function recalculateFromPurchase() {
    const type = activeType || 'garment'
    const categoryId = addMode === 'new' ? newCategoryId : pick?.categoryId
    const rules = await getRulesForProduct({ type, categoryId })
    const purchase = Number(cost) || 0
    const derived = computePricesFromPurchase(purchase, rules)
    setWholesale(String(derived.wholesalePrice))
    setMrp(String(derived.mrp))
    setSale(String(derived.salePrice))
    setDerivedTouched(false)
  }

  async function onNewCategoryChange(categoryId: string) {
    const cat = catById.get(categoryId) || categories.find((c) => c.id === categoryId)
    const type = (cat?.baseType || 'garment') as ProductType
    setNewCategoryId(categoryId)
    setNewType(type)
    setSizeQtys(emptySizeQtys())
    setSize('')
    setQty(type === 'fabric' ? '' : '1')
    setFabricUnit('metre')
    if (!derivedTouched && cost) {
      const rules = cat
        ? {
            wholesaleMarkupPct: cat.wholesaleMarkupPct,
            mrpMarkupPct: cat.mrpMarkupPct,
            saleDiscountFromMrpPct: cat.saleDiscountFromMrpPct,
          }
        : await getRulesForProduct({ categoryId, type })
      const purchase = Number(cost) || 0
      const derived = computePricesFromPurchase(purchase, rules)
      setWholesale(String(derived.wholesalePrice))
      setMrp(String(derived.mrp))
      setSale(String(derived.salePrice))
    }
  }

  function validatePrices() {
    const unitCost = Number(cost)
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setErrors((e) => ({ ...e, add: 'Enter a valid purchase cost' }))
      return null
    }
    const wholesalePrice = Number(wholesale)
    const mrpPrice = Number(mrp)
    const salePrice = Number(sale)
    if (![wholesalePrice, mrpPrice, salePrice].every((x) => Number.isFinite(x) && x >= 0)) {
      setErrors((e) => ({ ...e, add: 'Enter valid wholesale, MRP, and sale prices' }))
      return null
    }
    return { unitCost, wholesalePrice, mrp: mrpPrice, salePrice }
  }

  function buildLinesForProduct(
    product: { id: string; name: string; type: ProductType },
    prices: { unitCost: number; wholesalePrice: number; mrp: number; salePrice: number },
  ): Line[] | null {
    const { unitCost, wholesalePrice, mrp: mrpPrice, salePrice } = prices
    const priceFields = { wholesalePrice, mrp: mrpPrice, salePrice }

    if (product.type === 'garment') {
      const filled = Object.entries(sizeQtys)
        .map(([sz, v]) => ({ size: sz, quantity: Number(v) }))
        .filter((x) => x.quantity > 0)

      if (filled.length > 0) {
        return filled.map((row) => ({
          key: uid(),
          productId: product.id,
          productName: product.name,
          type: product.type,
          size: row.size,
          quantity: row.quantity,
          unit: 'piece',
          unitCost,
          ...priceFields,
          lineTotal: round2(row.quantity * unitCost),
        }))
      }

      const quantity = Number(qty)
      if (!quantity || quantity <= 0) {
        setErrors((e) => ({ ...e, add: 'Enter quantity for a size, or fill size qty fields' }))
        return null
      }
      if (!size) {
        setErrors((e) => ({ ...e, add: 'Select a size (or enter qty per size below)' }))
        return null
      }
      return [
        {
          key: uid(),
          productId: product.id,
          productName: product.name,
          type: product.type,
          size,
          quantity,
          unit: 'piece',
          unitCost,
          ...priceFields,
          lineTotal: round2(quantity * unitCost),
        },
      ]
    }

    const quantity = Number(qty)
    if (!quantity || quantity <= 0) {
      setErrors((e) => ({
        ...e,
        add: product.type === 'fabric' ? 'Enter length' : 'Enter quantity',
      }))
      return null
    }

    let storeQty = quantity
    let unit = 'piece'
    if (product.type === 'fabric') {
      unit = 'metre'
      storeQty = fabricUnit === 'cm' ? quantity / 100 : quantity
      if (storeQty <= 0) {
        setErrors((e) => ({ ...e, add: 'Enter a valid length' }))
        return null
      }
    }

    return [
      {
        key: uid(),
        productId: product.id,
        productName: product.name,
        type: product.type,
        size: undefined,
        quantity: storeQty,
        unit,
        unitCost,
        ...priceFields,
        lineTotal: round2(storeQty * unitCost),
      },
    ]
  }

  function mergeLinesIntoBill(newLines: Line[]) {
    setLines((ls) => {
      const next = [...ls]
      for (const row of newLines) {
        if (row.type === 'garment' && row.size) {
          const keyMatch = next.findIndex(
            (l) => l.productId === row.productId && l.size === row.size && l.unit === 'piece',
          )
          if (keyMatch >= 0) {
            const prev = next[keyMatch]
            const quantity = prev.quantity + row.quantity
            next[keyMatch] = {
              ...prev,
              quantity,
              unitCost: row.unitCost,
              wholesalePrice: row.wholesalePrice,
              mrp: row.mrp,
              salePrice: row.salePrice,
              lineTotal: round2(quantity * row.unitCost),
            }
            continue
          }
        }
        next.push(row)
      }
      return next
    })
  }

  function addExistingLine() {
    if (!pick) return
    const prices = validatePrices()
    if (!prices) return
    const built = buildLinesForProduct(pick, prices)
    if (!built) return
    mergeLinesIntoBill(built)
    // Keep product selected for quick multi-add; clear qtys
    const cleared: Record<string, string> = {}
    for (const k of Object.keys(sizeQtys)) cleared[k] = ''
    setSizeQtys(cleared)
    setSize('')
    setQty(pick.type === 'fabric' ? '' : '1')
    setErrors((e) => ({ ...e, add: undefined, lines: undefined }))
  }

  async function addNewProductToBill() {
    const name = newName.trim()
    if (!name) {
      setErrors((e) => ({ ...e, add: 'Enter product name' }))
      return
    }
    if (!newCategoryId) {
      setErrors((e) => ({ ...e, add: 'Select a category' }))
      return
    }
    const prices = validatePrices()
    if (!prices) return

    const id = uid()
    const built = buildLinesForProduct({ id, name, type: newType }, prices)
    if (!built) return

    setAdding(true)
    try {
      const t = new Date().toISOString()
      const sku = newSku.trim() || `SKU-${id.slice(0, 8)}`
      let sizes: ProductSize[] = []
      if (newType === 'garment') {
        const sizeNames = new Set<string>()
        for (const l of built) if (l.size) sizeNames.add(l.size)
        for (const sz of Object.keys(sizeQtys)) sizeNames.add(sz)
        for (const s of STANDARD_SIZES) sizeNames.add(s)
        sizes = [...sizeNames]
          .filter((sz) => sz.trim())
          .map((sz) => ({
            id: `${id}-${sz}`,
            productId: id,
            size: sz,
            quantity: 0, // stock comes from purchase save
          }))
      }

      const product: Product = {
        id,
        sku,
        name,
        type: newType,
        categoryId: newCategoryId,
        unit: newType === 'fabric' ? 'metre' : 'piece',
        purchasePrice: prices.unitCost,
        costPrice: prices.unitCost,
        wholesalePrice: prices.wholesalePrice,
        mrp: prices.mrp,
        salePrice: prices.salePrice,
        sellingPrice: prices.salePrice,
        quantity: 0,
        lowStockThreshold: 5,
        fabricSellUnit: newType === 'fabric' ? fabricUnit : null,
        createdAt: t,
        updatedAt: t,
      }

      await db.transaction('rw', db.products, db.productSizes, db.outbox, async () => {
        await db.products.put(product)
        if (sizes.length) await db.productSizes.bulkPut(sizes)
        await enqueue('product', { ...product, sizes }, product.id)
      })
      void flushOutbox()

      mergeLinesIntoBill(built)
      setErrors((e) => ({ ...e, add: undefined, lines: undefined }))
      resetAddPanel()
    } finally {
      setAdding(false)
    }
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

      await db.transaction(
        'rw',
        db.purchases,
        db.purchaseItems,
        db.products,
        db.productSizes,
        db.outbox,
        async () => {
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
        },
      )
      void flushOutbox()
      setOpen(false)
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  function renderPriceFields(costLabel: string) {
    return (
      <div className="rounded-xl border border-brand-100 bg-cream/50 p-3">
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
            {costLabel}
            <input
              className="mt-1 lf-input min-h-[40px] px-2 text-sm"
              value={cost}
              onChange={(e) => void applyCostAndMaybeDerive(e.target.value)}
              placeholder="Purchase"
              inputMode="decimal"
            />
          </label>
          <label className="text-[10px] font-semibold uppercase text-slate-500">
            Wholesale
            <input
              className="mt-1 lf-input min-h-[40px] px-2 text-sm"
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
              className="mt-1 lf-input min-h-[40px] px-2 text-sm"
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
              className="mt-1 lf-input min-h-[40px] px-2 text-sm"
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
    )
  }

  function renderQtySection() {
    if (activeType === 'garment') {
      return (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Qty per size
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
                    className="mt-1 lf-input min-h-[40px] px-2 text-sm"
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
                className="lf-input min-h-[40px] flex-1 px-2 text-sm"
              />
              <button type="button" className="lf-btn-secondary min-h-[40px] px-3 text-sm" onClick={addCustomSize}>
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
              className="lf-input min-h-[40px] w-full px-2 text-sm"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Qty for selected size"
              inputMode="decimal"
            />
          </div>

          {renderPriceFields('Purchase')}

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
      )
    }

    if (activeType === 'fabric') {
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            {(['metre', 'cm'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setFabricUnit(u)}
                className={`min-h-[40px] flex-1 rounded-lg border text-sm font-semibold ${
                  fabricUnit === u ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-brand-200 bg-white'
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
              className="lf-input min-h-[40px] w-full px-2"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={fabricUnit === 'metre' ? 'e.g. 1.4' : 'e.g. 80'}
              inputMode="decimal"
            />
          </div>
          {renderPriceFields('Purchase / m')}
          {previewQty > 0 && (
            <div className="text-sm text-slate-600">
              Stores as {qtyLabel(previewMetres, 'metre')} · line{' '}
              <span className="font-semibold text-brand-800">{inr(previewTotal)}</span>
            </div>
          )}
        </div>
      )
    }

    if (activeType === 'saree') {
      return (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Pieces</label>
            <input
              className="lf-input min-h-[40px] w-full px-2"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Qty"
              inputMode="numeric"
            />
          </div>
          {renderPriceFields('Purchase')}
          {previewQty > 0 && (
            <div className="text-sm text-slate-600">
              Preview: {previewQty} pcs →{' '}
              <span className="font-semibold text-brand-800">{inr(previewTotal)}</span>
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="lf-page-title">Purchase bills</h1>
          <p className="text-sm text-slate-500">Stock in — add existing or create new products</p>
        </div>
        <button type="button" className="lf-btn-primary gap-1.5" onClick={openModal}>
          <Plus className="h-4 w-4" /> New purchase
        </button>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={listQ}
          onChange={(e) => setListQ(e.target.value)}
          placeholder="Search bills, supplier, product…"
          className="lf-input pl-10 shadow-soft"
        />
      </div>

      <div className="space-y-2">
        {filteredPurchases.map((p) => {
          const its = items.filter((i) => i.purchaseId === p.id)
          const sup = suppliers.find((s) => s.id === p.supplierId)
          return (
            <div key={p.id} className="lf-card p-4 transition hover:shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-brand-900">{p.billNo || `Bill ${p.id.slice(0, 8)}`}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {p.date} · {sup?.name || 'Supplier'} · {its.length} item(s)
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-brand-800">{inr(p.total)}</div>
                </div>
              </div>
              <ul className="mt-3 space-y-1 border-t border-brand-50 pt-2 text-sm text-slate-600">
                {its.slice(0, 4).map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {i.productName}
                      {i.size ? ` (${i.size})` : ''} · {qtyLabel(i.quantity, i.unit)}
                    </span>
                    <span className="font-medium text-slate-700">{inr(i.lineTotal)}</span>
                  </li>
                ))}
                {its.length > 4 && (
                  <li className="text-xs text-slate-400">+{its.length - 4} more line(s)</li>
                )}
              </ul>
            </div>
          )
        })}
        {!purchases.length && (
          <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-10 text-center">
            <PackagePlus className="mx-auto mb-3 h-10 w-10 text-brand-300" />
            <p className="text-sm font-medium text-brand-900">No purchases yet</p>
            <p className="mt-1 text-sm text-slate-500">Stock in from a supplier bill — create products as you go.</p>
            <button type="button" className="lf-btn-primary mt-4 gap-1.5" onClick={openModal}>
              <Plus className="h-4 w-4" /> New purchase
            </button>
          </div>
        )}
        {!!purchases.length && !filteredPurchases.length && (
          <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center text-sm text-slate-500">
            No bills match “{listQ}”
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-brand-900/40 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex max-h-[96vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-pos sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3">
              <div>
                <h2 className="font-bold text-brand-900">New purchase</h2>
                <p className="text-xs text-slate-500">Supplier → add products → save</p>
              </div>
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
              {/* Step header */}
              <section className="mb-4 rounded-2xl border border-brand-100 bg-cream/50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  1. Bill header
                </div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Supplier <span className="text-red-600">*</span>
                </label>
                <select
                  className={`mb-1 lf-input ${errors.supplier ? 'border-red-400 bg-red-50' : ''}`}
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

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Supplier bill no
                    </label>
                    <input
                      className="lf-input"
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
                      className="lf-input"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                </div>
              </section>

              {/* Add products */}
              <section className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  2. Add products
                </div>

                {addMode === 'idle' && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className="lf-card flex flex-col items-start gap-1 border-2 border-brand-100 p-4 text-left transition hover:border-brand-400 hover:bg-brand-50/50"
                      onClick={startExisting}
                    >
                      <Search className="h-5 w-5 text-brand-700" />
                      <span className="font-semibold text-brand-900">Add existing product</span>
                      <span className="text-xs text-slate-500">Search catalog and stock in</span>
                    </button>
                    <button
                      type="button"
                      className="lf-card flex flex-col items-start gap-1 border-2 border-brand-200 bg-brand-50/40 p-4 text-left transition hover:border-brand-500 hover:bg-brand-50"
                      onClick={startNew}
                    >
                      <PackagePlus className="h-5 w-5 text-brand-700" />
                      <span className="font-semibold text-brand-900">Add new product</span>
                      <span className="text-xs text-slate-500">Create item while purchasing</span>
                    </button>
                  </div>
                )}

                {addMode === 'existing' && (
                  <div className="rounded-2xl border border-brand-100 bg-cream/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-brand-800">Existing product</div>
                      <button type="button" className="lf-btn-ghost px-2 py-1 text-xs" onClick={resetAddPanel}>
                        Cancel
                      </button>
                    </div>
                    <div className="relative mb-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        className="lf-input pl-10"
                        placeholder="Search name / SKU / category"
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value)
                          if (pick) setPick(null)
                        }}
                        autoFocus
                      />
                    </div>
                    {!pick && (
                      <div className="mb-2 max-h-40 overflow-auto rounded-xl border bg-white">
                        {filteredProducts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="block w-full border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-brand-50"
                            onClick={() => void selectProduct(p)}
                          >
                            <span className="font-medium">{p.name}</span>
                            <span className="ml-2 text-xs text-slate-500">
                              {p.sku} · {catById.get(p.categoryId)?.name || typeLabel(p.type)} ·{' '}
                              {inr(
                                normalizeProductPrices(p as unknown as Record<string, unknown>).purchasePrice,
                              )}
                            </span>
                          </button>
                        ))}
                        {!filteredProducts.length && (
                          <div className="px-3 py-3 text-sm text-slate-500">
                            No match — try{' '}
                            <button type="button" className="font-semibold text-brand-700 underline" onClick={startNew}>
                              Add new product
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {pick && (
                      <div className="rounded-xl border bg-white p-3">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-brand-900">{pick.name}</div>
                            <div className="text-xs text-slate-500">
                              {pick.sku} · {typeLabel(pick.type)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                            onClick={() => setPick(null)}
                          >
                            Change
                          </button>
                        </div>
                        {renderQtySection()}
                        {errors.add && <p className="mt-2 text-sm text-red-600">{errors.add}</p>}
                        <button type="button" className="lf-btn-primary mt-3 w-full" onClick={addExistingLine}>
                          {pick.type === 'garment' && multiSizePreview.count > 0
                            ? `Add ${multiSizePreview.count} size line(s) to bill`
                            : 'Add to bill'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {addMode === 'new' && (
                  <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-brand-800">New product</div>
                      <button type="button" className="lf-btn-ghost px-2 py-1 text-xs" onClick={resetAddPanel}>
                        Cancel
                      </button>
                    </div>
                    <div className="mb-3 space-y-2 rounded-xl border bg-white p-3">
                      <label className="block text-xs font-semibold uppercase text-slate-500">
                        Name <span className="text-red-600">*</span>
                        <input
                          className="mt-1 lf-input"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Product name"
                          autoFocus
                        />
                      </label>
                      <label className="block text-xs font-semibold uppercase text-slate-500">
                        Category <span className="text-red-600">*</span>
                        <select
                          className="mt-1 lf-input"
                          value={newCategoryId}
                          onChange={(e) => void onNewCategoryChange(e.target.value)}
                        >
                          {!categories.length && <option value="">No categories</option>}
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({typeLabel(c.baseType)} · {baseTypeHint(c.baseType)})
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Stock behaviour: {typeLabel(newType)} ({baseTypeHint(newType)})
                      </p>
                      <label className="block text-xs font-semibold uppercase text-slate-500">
                        SKU <span className="font-normal normal-case text-slate-400">(optional — auto if empty)</span>
                        <input
                          className="mt-1 lf-input"
                          value={newSku}
                          onChange={(e) => setNewSku(e.target.value)}
                          placeholder="Auto-generated if blank"
                        />
                      </label>
                    </div>

                    {renderQtySection()}
                    {errors.add && <p className="mt-2 text-sm text-red-600">{errors.add}</p>}
                    <button
                      type="button"
                      disabled={adding}
                      className="lf-btn-primary mt-3 w-full disabled:opacity-60"
                      onClick={() => void addNewProductToBill()}
                    >
                      {adding
                        ? 'Creating…'
                        : newType === 'garment' && multiSizePreview.count > 0
                          ? `Create & add ${multiSizePreview.count} size line(s)`
                          : 'Create product & add to bill'}
                    </button>
                  </div>
                )}
              </section>

              {/* Bill lines */}
              <section className="mb-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                    3. Bill lines
                  </div>
                  {errors.lines && <span className="text-sm text-red-600">{errors.lines}</span>}
                </div>
                {!lines.length ? (
                  <div
                    className={`rounded-xl border border-dashed px-3 py-6 text-center text-sm text-slate-500 ${
                      errors.lines ? 'border-red-300 bg-red-50' : 'border-brand-200 bg-white'
                    }`}
                  >
                    No lines yet — use <span className="font-semibold">Add existing</span> or{' '}
                    <span className="font-semibold">Add new product</span>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {lines.map((l) => (
                      <li key={l.key} className="lf-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-brand-900">{l.productName}</div>
                            <div className="text-xs text-slate-500">
                              {typeLabel(l.type)}
                              {l.size ? ` · size ${l.size}` : ''} ·{' '}
                              {l.unit === 'metre' ? 'per metre' : 'per piece'}
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
                              className="lf-input min-h-[40px] px-2 text-sm"
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
                              className="lf-input min-h-[40px] px-2 text-sm"
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
                              className="lf-input min-h-[40px] px-2 text-sm"
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
                              className="lf-input min-h-[40px] px-2 text-sm"
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
                              className="lf-input min-h-[40px] px-2 text-sm"
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

                {addMode === 'idle' && lines.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" className="lf-btn-secondary text-sm" onClick={startExisting}>
                      + Existing
                    </button>
                    <button type="button" className="lf-btn-secondary text-sm" onClick={startNew}>
                      + New product
                    </button>
                  </div>
                )}
              </section>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Notes (optional)
                </label>
                <textarea
                  className="mb-2 min-h-[72px] w-full rounded-xl border border-brand-100 p-2 text-sm"
                  placeholder="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="sticky bottom-0 border-t border-brand-100 bg-white px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-slate-500">{lines.length} line(s)</span>
                <span className="text-lg font-bold text-brand-900">Total {inr(total)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="lf-btn-secondary min-h-[48px]"
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
                  className="lf-btn-primary min-h-[48px] disabled:opacity-60"
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
