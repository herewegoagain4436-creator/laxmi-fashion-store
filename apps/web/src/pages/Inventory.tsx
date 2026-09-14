import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAuth } from '../auth'
import { SizeChips } from '../components/SizeChips'
import { db, enqueue, productsWithSizes } from '../db'
import { inr, isLowStock, productStock, typeLabel } from '../lib/format'
import { uid } from '../lib/ids'
import { flushOutbox } from '../sync'
import type { Product, ProductSize, ProductType } from '../types'
import { STANDARD_SIZES } from '../types'

const emptyForm = () => ({
  name: '',
  sku: '',
  type: 'garment' as ProductType,
  sellingPrice: '',
  costPrice: '',
  quantity: '',
  lowStockThreshold: '5',
  fabricSellUnit: 'metre' as 'metre' | 'cm',
  sizes: STANDARD_SIZES.map((s) => ({ size: s, qty: s === 'Free size' ? '' : '' })),
  customSize: '',
})

export function Inventory() {
  const { user } = useAuth()
  const owner = user?.role === 'owner'
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | ProductType | 'low'>('all')
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [sizeQtys, setSizeQtys] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (tab === 'low' && !isLowStock(p)) return false
      if (tab !== 'all' && tab !== 'low' && p.type !== tab) return false
      const s = q.trim().toLowerCase()
      if (!s) return true
      return p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
    })
  }, [products, q, tab])

  function openEdit(p?: Product) {
    if (p) {
      setEditId(p.id)
      const sq: Record<string, string> = {}
      for (const s of p.sizes || []) sq[s.size] = String(s.quantity)
      setSizeQtys(sq)
      setForm({
        name: p.name,
        sku: p.sku,
        type: p.type,
        sellingPrice: String(p.sellingPrice),
        costPrice: String(p.costPrice),
        quantity: String(p.quantity),
        lowStockThreshold: String(p.lowStockThreshold),
        fabricSellUnit: (p.fabricSellUnit as 'metre' | 'cm') || 'metre',
        sizes: [],
        customSize: '',
      })
    } else {
      setEditId(null)
      const sq: Record<string, string> = {}
      for (const s of STANDARD_SIZES) sq[s] = ''
      setSizeQtys(sq)
      setForm(emptyForm())
    }
  }

  async function save() {
    if (!form || !owner) return
    const t = new Date().toISOString()
    const id = editId || uid()
    let sizes: ProductSize[] = []
    if (form.type === 'garment') {
      sizes = Object.entries(sizeQtys)
        .filter(([k]) => k.trim())
        .map(([size, qty]) => ({
          id: `${id}-${size}`,
          productId: id,
          size,
          quantity: Number(qty) || 0,
        }))
    }
    const product: Product = {
      id,
      sku: form.sku.trim() || `SKU-${id.slice(0, 8)}`,
      name: form.name.trim(),
      type: form.type,
      unit: form.type === 'fabric' ? 'metre' : 'piece',
      sellingPrice: Number(form.sellingPrice) || 0,
      costPrice: Number(form.costPrice) || 0,
      quantity: form.type === 'garment' ? 0 : Number(form.quantity) || 0,
      lowStockThreshold: Number(form.lowStockThreshold) || 0,
      fabricSellUnit: form.type === 'fabric' ? form.fabricSellUnit : null,
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

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-brand-800">Inventory</h1>
        {owner && (
          <button
            type="button"
            onClick={() => openEdit()}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-brand-600 px-3 font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add product
          </button>
        )}
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products"
          className="min-h-[44px] w-full rounded-xl border bg-white pl-10 pr-3"
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(['all', 'garment', 'saree', 'fabric', 'low'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              tab === t ? 'bg-brand-700 text-white' : 'bg-white text-brand-800 border'
            }`}
          >
            {t === 'low' ? 'Low stock' : t === 'all' ? 'All' : typeLabel(t)}
          </button>
        ))}
      </div>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-brand-50 text-brand-900">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Rate</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const stock = productStock(p)
              const low = isLowStock(p)
              return (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.sku}</div>
                    {p.type === 'garment' && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(p.sizes || []).filter((s) => s.quantity > 0).map((s) => (
                          <span key={s.size} className="rounded bg-cream px-1.5 text-[11px]">
                            {s.size}:{s.quantity}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{typeLabel(p.type)}</td>
                  <td className="px-3 py-2">
                    <span className={low ? 'font-bold text-amber-700' : ''}>
                      {p.type === 'fabric' ? `${stock} m` : `${stock} pcs`}
                    </span>
                    {low && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[11px]">LOW</span>}
                  </td>
                  <td className="px-3 py-2">{inr(p.sellingPrice)}</td>
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
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl">
            <h2 className="mb-3 font-bold">{editId ? 'Edit product' : 'New product'}</h2>
            <div className="grid gap-2">
              <input
                className="min-h-[44px] rounded-xl border px-3"
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="min-h-[44px] rounded-xl border px-3"
                placeholder="SKU"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                {(['garment', 'saree', 'fabric'] as ProductType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    className={`min-h-[44px] rounded-xl border text-sm font-semibold ${
                      form.type === t ? 'border-brand-500 bg-brand-50' : ''
                    }`}
                  >
                    {typeLabel(t)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="min-h-[44px] rounded-xl border px-3"
                  placeholder="Selling price"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                />
                <input
                  className="min-h-[44px] rounded-xl border px-3"
                  placeholder="Cost price"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                />
              </div>
              {form.type !== 'garment' && (
                <input
                  className="min-h-[44px] rounded-xl border px-3"
                  placeholder={form.type === 'fabric' ? 'Stock (metres)' : 'Stock (pieces)'}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              )}
              <input
                className="min-h-[44px] rounded-xl border px-3"
                placeholder="Low stock alert"
                value={form.lowStockThreshold}
                onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
              />
              {form.type === 'garment' && (
                <div>
                  <div className="mb-2 text-sm font-medium">Stock per size</div>
                  <SizeChips
                    sizes={Object.keys(sizeQtys).map((s) => ({ size: s, quantity: Number(sizeQtys[s]) || 0 }))}
                    value=""
                    onChange={(sz) => setSizeQtys((p) => ({ ...p, [sz]: p[sz] || '0' }))}
                    showStock
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.keys(sizeQtys).map((sz) => (
                      <label key={sz} className="text-xs">
                        {sz}
                        <input
                          className="mt-1 min-h-[40px] w-full rounded-lg border px-2"
                          value={sizeQtys[sz]}
                          onChange={(e) => setSizeQtys((p) => ({ ...p, [sz]: e.target.value }))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="min-h-[44px] rounded-xl border" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="button" className="min-h-[44px] rounded-xl bg-brand-600 font-semibold text-white" onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
