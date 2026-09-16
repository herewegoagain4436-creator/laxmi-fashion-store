import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAuth } from '../auth'
import { SizeChips } from '../components/SizeChips'
import { db, enqueue, getActiveCategories, getRulesForProduct, productsWithSizes } from '../db'
import { baseTypeHint, inr, isLowStock, productStock, typeLabel } from '../lib/format'
import { uid } from '../lib/ids'
import { computePricesFromPurchase, defaultCategoryIdForType, normalizeProductPrices } from '../lib/pricing'
import { flushOutbox } from '../sync'
import type { Category, Product, ProductSize, ProductType } from '../types'
import { DEFAULT_COLOUR, STANDARD_SIZES } from '../types'
import { buildMatrix, normalizeColour, variantKey } from '../lib/variants'

const emptyForm = (defaultCatId: string, baseType: ProductType) => ({
  name: '',
  sku: '',
  categoryId: defaultCatId,
  type: baseType,
  purchasePrice: '',
  wholesalePrice: '',
  mrp: '',
  salePrice: '',
  quantity: '',
  lowStockThreshold: '5',
  fabricSellUnit: 'metre' as 'metre' | 'cm',
  colours: DEFAULT_COLOUR,
  shade: '',
  sizes: STANDARD_SIZES.map((s) => ({ size: s, qty: s === 'Free size' ? '' : '' })),
  customSize: '',
})

export function Inventory() {
  const { user } = useAuth()
  const owner = user?.role === 'owner'
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const categories =
    useLiveQuery(async () => {
      return getActiveCategories()
    }, []) || []
  const allCategories =
    useLiveQuery(async () => {
      const all = await db.categories.toArray()
      return all.filter((c) => !c.deletedAt)
    }, []) || []

  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'low' | string>('all')
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [sizeQtys, setSizeQtys] = useState<Record<string, string>>({})
  const [derivedTouched, setDerivedTouched] = useState(false)

  const catById = useMemo(() => {
    const m = new Map<string, Category>()
    for (const c of allCategories) m.set(c.id, c)
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories, allCategories])

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (tab === 'low' && !isLowStock(p)) return false
      if (tab !== 'all' && tab !== 'low' && p.categoryId !== tab && p.type !== tab) return false
      const s = q.trim().toLowerCase()
      if (!s) return true
      const catName = catById.get(p.categoryId)?.name || ''
      return (
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        catName.toLowerCase().includes(s)
      )
    })
  }, [products, q, tab, catById])

  function categoryLabel(p: Product) {
    const c = catById.get(p.categoryId)
    return c?.name || typeLabel(p.type)
  }

  function openEdit(p?: Product) {
    setDerivedTouched(false)
    if (p) {
      const n = normalizeProductPrices(p as unknown as Record<string, unknown>)
      setEditId(p.id)
      const sq: Record<string, string> = {}
      const cols = new Set<string>()
      for (const s of p.sizes || []) {
        const c = normalizeColour(s.colour)
        cols.add(c)
        sq[variantKey(c, s.size)] = String(s.quantity)
      }
      setSizeQtys(sq)
      const catId = p.categoryId || defaultCategoryIdForType(p.type)
      const cat = catById.get(catId)
      setForm({
        name: p.name,
        sku: p.sku,
        categoryId: catId,
        type: cat?.baseType || p.type,
        purchasePrice: String(n.purchasePrice),
        wholesalePrice: String(n.wholesalePrice),
        mrp: String(n.mrp),
        salePrice: String(n.salePrice),
        quantity: String(p.quantity),
        lowStockThreshold: String(p.lowStockThreshold),
        fabricSellUnit: (p.fabricSellUnit as 'metre' | 'cm') || 'metre',
        colours: [...cols].join(', ') || DEFAULT_COLOUR,
        shade: p.shade || '',
        sizes: [],
        customSize: '',
      })
    } else {
      setEditId(null)
      const sq: Record<string, string> = {}
      for (const s of STANDARD_SIZES) sq[variantKey(DEFAULT_COLOUR, s)] = ''
      setSizeQtys(sq)
      const first = categories[0]
      const catId = first?.id || defaultCategoryIdForType('garment')
      const base = first?.baseType || 'garment'
      setForm(emptyForm(catId, base))
    }
  }

  async function applyRecalc() {
    if (!form) return
    const rules = await getRulesForProduct({ categoryId: form.categoryId, type: form.type })
    const purchase = Number(form.purchasePrice) || 0
    const derived = computePricesFromPurchase(purchase, rules)
    setForm({
      ...form,
      wholesalePrice: String(derived.wholesalePrice),
      mrp: String(derived.mrp),
      salePrice: String(derived.salePrice),
    })
    setDerivedTouched(false)
  }

  async function onPurchaseChange(value: string) {
    if (!form) return
    const next = { ...form, purchasePrice: value }
    if (!derivedTouched) {
      const rules = await getRulesForProduct({ categoryId: form.categoryId, type: form.type })
      const purchase = Number(value) || 0
      const derived = computePricesFromPurchase(purchase, rules)
      next.wholesalePrice = String(derived.wholesalePrice)
      next.mrp = String(derived.mrp)
      next.salePrice = String(derived.salePrice)
    }
    setForm(next)
  }

  async function onCategoryChange(categoryId: string) {
    if (!form) return
    const cat = catById.get(categoryId) || categories.find((c) => c.id === categoryId)
    const type = (cat?.baseType || form.type) as ProductType
    const next = { ...form, categoryId, type }
    if (!derivedTouched && form.purchasePrice) {
      const rules = cat
        ? {
            wholesaleMarkupPct: cat.wholesaleMarkupPct,
            mrpMarkupPct: cat.mrpMarkupPct,
            saleDiscountFromMrpPct: cat.saleDiscountFromMrpPct,
          }
        : await getRulesForProduct({ categoryId, type })
      const purchase = Number(form.purchasePrice) || 0
      const derived = computePricesFromPurchase(purchase, rules)
      next.wholesalePrice = String(derived.wholesalePrice)
      next.mrp = String(derived.mrp)
      next.salePrice = String(derived.salePrice)
    }
    setForm(next)
  }

  async function save() {
    if (!form || !owner) return
    if (!form.categoryId) {
      alert('Select a category')
      return
    }
    const t = new Date().toISOString()
    const id = editId || uid()
    const sku = form.sku.trim() || `SKU-${id.slice(0, 8)}`
    let sizes: ProductSize[] = []
    if (form.type === 'garment') {
      const colourList = form.colours
        .split(',')
        .map((c) => normalizeColour(c))
        .filter(Boolean)
      const uniqCols = [...new Set(colourList.length ? colourList : [DEFAULT_COLOUR])]
      const sizeNames = [
        ...new Set(
          Object.keys(sizeQtys)
            .map((k) => (k.includes('::') ? k.split('::')[1] : k))
            .filter(Boolean),
        ),
      ]
      const szList = sizeNames.length ? sizeNames : [...STANDARD_SIZES]
      const qtyMap: Record<string, number> = {}
      for (const [k, v] of Object.entries(sizeQtys)) {
        if (k.includes('::')) qtyMap[k] = Number(v) || 0
        else {
          for (const c of uniqCols) qtyMap[variantKey(c, k)] = Number(v) || 0
        }
      }
      sizes = buildMatrix(id, sku, uniqCols, szList, qtyMap)
    }
    const purchase = Number(form.purchasePrice) || 0
    const sale = Number(form.salePrice) || 0
    const product: Product = {
      id,
      sku,
      name: form.name.trim(),
      type: form.type,
      categoryId: form.categoryId,
      unit: form.type === 'fabric' ? 'metre' : 'piece',
      purchasePrice: purchase,
      costPrice: purchase,
      wholesalePrice: Number(form.wholesalePrice) || 0,
      mrp: Number(form.mrp) || 0,
      salePrice: sale,
      sellingPrice: sale,
      quantity: form.type === 'garment' ? 0 : Number(form.quantity) || 0,
      lowStockThreshold: Number(form.lowStockThreshold) || 0,
      fabricSellUnit: form.type === 'fabric' ? form.fabricSellUnit : null,
      shade: form.type === 'fabric' ? form.shade || null : null,
      createdAt: t,
      updatedAt: t,
    }
    await db.transaction('rw', db.products, db.productSizes, db.outbox, async () => {
      await db.products.put(product)
      await db.productSizes.where('productId').equals(id).delete()
      if (sizes.length) await db.productSizes.bulkPut(sizes)
      await enqueue('product', { ...product, sizes }, product.id)
    })
    void flushOutbox()
    setForm(null)
  }

  async function remove(p: Product) {
    if (!owner) return
    if (!confirm(`Delete ${p.name}?`)) return
    const t = new Date().toISOString()
    await db.products.update(p.id, { deletedAt: t, updatedAt: t })
    await enqueue('product', { ...p, deletedAt: t, updatedAt: t, sizes: p.sizes || [] }, p.id)
    void flushOutbox()
  }

  const filterTabs: Array<{ key: string; label: string }> = [
    { key: 'all', label: 'All' },
    ...categories.map((c) => ({ key: c.id, label: c.name })),
    { key: 'low', label: 'Low stock' },
  ]

  // For edit form: include inactive category if product still uses it
  const formCategoryOptions = useMemo(() => {
    const list = [...categories]
    if (form?.categoryId && !list.some((c) => c.id === form.categoryId)) {
      const orphan = catById.get(form.categoryId)
      if (orphan) list.unshift(orphan)
    }
    return list
  }, [categories, form?.categoryId, catById])

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="lf-page-title">Inventory</h1>
          <p className="text-sm text-slate-500">Stock, four prices, and categories</p>
        </div>
        {owner && (
          <button
            type="button"
            onClick={() => openEdit()}
            className="lf-btn-primary"
          >
            <Plus className="h-4 w-4" /> Add product
          </button>
        )}
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products"
          className="lf-input pl-10 shadow-soft"
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {filterTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={tab === t.key ? 'lf-chip-active' : 'lf-chip-idle'}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="lf-table-wrap max-h-[70vh]">
        <table className="lf-table min-w-[720px]">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Stock</th>
              <th>Purchase</th>
              <th>Wholesale</th>
              <th>MRP</th>
              <th>Sale</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const stock = productStock(p)
              const low = isLowStock(p)
              const n = normalizeProductPrices(p as unknown as Record<string, unknown>)
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.sku}</div>
                    {p.type === 'garment' && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(p.sizes || [])
                          .filter((s) => s.quantity > 0)
                          .map((s) => (
                            <span
                              key={`${s.colour}-${s.size}`}
                              className="rounded bg-cream px-1.5 text-[11px]"
                              title={s.barcode || ''}
                            >
                              {s.colour && s.colour !== DEFAULT_COLOUR ? `${s.colour}/` : ''}
                              {s.size}:{s.quantity}
                            </span>
                          ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div>{categoryLabel(p)}</div>
                    <div className="text-[11px] text-slate-400">{typeLabel(p.type)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={low ? 'font-bold text-amber-700' : ''}>
                      {p.type === 'fabric' ? `${stock} m` : `${stock} pcs`}
                    </span>
                    {low && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[11px]">LOW</span>}
                  </td>
                  <td className="px-3 py-2">{owner ? inr(n.purchasePrice) : '—'}</td>
                  <td className="px-3 py-2">{inr(n.wholesalePrice)}</td>
                  <td className="px-3 py-2">{inr(n.mrp)}</td>
                  <td className="px-3 py-2 font-semibold">{inr(n.salePrice)}</td>
                  <td className="px-3 py-2 text-right">
                    {owner && (
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => void remove(p)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {form && owner && (
        <div className="lf-modal-backdrop">
          <div className="lf-modal">
            <h2 className="mb-3 text-lg font-bold tracking-tight text-brand-800">{editId ? 'Edit product' : 'New product'}</h2>
            <div className="grid gap-2">
              <input
                className="lf-input"
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="lf-input"
                placeholder="SKU"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <label className="block text-sm font-medium">
                Category
                <select
                  className="lf-input mt-1"
                  value={form.categoryId}
                  onChange={(e) => void onCategoryChange(e.target.value)}
                >
                  {formCategoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({typeLabel(c.baseType)} · {baseTypeHint(c.baseType)})
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-slate-500">
                Stock behaviour: {typeLabel(form.type)} ({baseTypeHint(form.type)})
              </p>

              <div className="rounded-2xl border border-brand-100 bg-cream-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-brand-800">Prices</div>
                  <button
                    type="button"
                    className="rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700"
                    onClick={() => void applyRecalc()}
                  >
                    Recalculate from purchase
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    Purchase (cost)
                    <input
                      className="lf-input mt-1"
                      placeholder="Purchase"
                      value={form.purchasePrice}
                      inputMode="decimal"
                      onChange={(e) => void onPurchaseChange(e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Wholesale
                    <input
                      className="lf-input mt-1"
                      placeholder="Wholesale"
                      value={form.wholesalePrice}
                      inputMode="decimal"
                      onChange={(e) => {
                        setDerivedTouched(true)
                        setForm({ ...form, wholesalePrice: e.target.value })
                      }}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    MRP
                    <input
                      className="lf-input mt-1"
                      placeholder="MRP"
                      value={form.mrp}
                      inputMode="decimal"
                      onChange={(e) => {
                        setDerivedTouched(true)
                        setForm({ ...form, mrp: e.target.value })
                      }}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Sale (retail)
                    <input
                      className="lf-input mt-1"
                      placeholder="Sale"
                      value={form.salePrice}
                      inputMode="decimal"
                      onChange={(e) => {
                        setDerivedTouched(true)
                        setForm({ ...form, salePrice: e.target.value })
                      }}
                    />
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Changing purchase auto-fills wholesale / MRP / sale from this category&apos;s rules until you edit
                  them. Use Recalculate to re-apply.
                </p>
              </div>

              {form.type !== 'garment' && (
                <input
                  className="lf-input"
                  placeholder={form.type === 'fabric' ? 'Stock (metres)' : 'Stock (pieces)'}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              )}
              <input
                className="lf-input"
                placeholder="Low stock alert"
                value={form.lowStockThreshold}
                onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
              />
              {form.type === 'fabric' && (
                <input
                  className="lf-input"
                  placeholder="Default shade (optional)"
                  value={form.shade}
                  onChange={(e) => setForm({ ...form, shade: e.target.value })}
                />
              )}
              {form.type === 'garment' && (
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Colours (comma-separated)
                    <input
                      className="lf-input mt-1"
                      value={form.colours}
                      placeholder="Default, Navy, Red"
                      onChange={(e) => {
                        const colours = e.target.value
                        setForm({ ...form, colours })
                        const cols = colours
                          .split(',')
                          .map((c) => normalizeColour(c))
                          .filter(Boolean)
                        const uniq = [...new Set(cols.length ? cols : [DEFAULT_COLOUR])]
                        const sizeNames = [
                          ...new Set(
                            Object.keys(sizeQtys)
                              .map((k) => (k.includes('::') ? k.split('::')[1] : k))
                              .filter(Boolean),
                          ),
                        ]
                        const szs = sizeNames.length ? sizeNames : [...STANDARD_SIZES]
                        setSizeQtys((prev) => {
                          const next: Record<string, string> = {}
                          for (const c of uniq) {
                            for (const sz of szs) {
                              const k = variantKey(c, sz)
                              next[k] =
                                prev[k] ??
                                prev[sz] ??
                                prev[variantKey(DEFAULT_COLOUR, sz)] ??
                                ''
                            }
                          }
                          return next
                        })
                      }}
                    />
                  </label>
                  <div className="mb-2 text-sm font-medium">Stock per colour × size</div>
                  <SizeChips
                    sizes={[
                      ...new Set(
                        Object.keys(sizeQtys).map((k) => (k.includes('::') ? k.split('::')[1] : k)),
                      ),
                    ].map((s) => ({ size: s, quantity: 0 }))}
                    value=""
                    onChange={(sz) => {
                      const cols = form.colours
                        .split(',')
                        .map((c) => normalizeColour(c))
                        .filter(Boolean)
                      const uniq = [...new Set(cols.length ? cols : [DEFAULT_COLOUR])]
                      setSizeQtys((p) => {
                        const next = { ...p }
                        for (const c of uniq) {
                          const k = variantKey(c, sz)
                          if (!(k in next)) next[k] = '0'
                        }
                        return next
                      })
                    }}
                    showStock={false}
                  />
                  <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                    {Object.keys(sizeQtys)
                      .sort()
                      .map((key) => (
                        <label key={key} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0 font-medium">{key.replace('::', ' / ')}</span>
                          <input
                            className="min-h-[36px] flex-1 rounded-lg border px-2"
                            value={sizeQtys[key]}
                            onChange={(e) => setSizeQtys((p) => ({ ...p, [key]: e.target.value }))}
                          />
                        </label>
                      ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Barcodes are auto-generated per colour × size on save.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="lf-btn-secondary" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="button" className="lf-btn-primary" onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
