import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, enqueue, getAllCategories } from '../db'
import {
  BASE_TYPE_LABELS,
  computePricesFromPurchase,
  DEFAULT_CATEGORY_RULES,
  normalizeCategory,
  round2,
  rulesFromCategory,
  slugify,
} from '../lib/pricing'
import { flushOutbox, syncNow } from '../sync'
import { getApiBase, setApiBase } from '../api'
import { SyncBadge } from '../components/SyncBadge'
import { inr } from '../lib/format'
import { uid } from '../lib/ids'
import type { Category, CategoryPricingRules, ProductType } from '../types'

const BASE_TYPES: ProductType[] = ['garment', 'saree', 'fabric']

function emptyRules(): CategoryPricingRules {
  return { ...DEFAULT_CATEGORY_RULES }
}

export function Settings() {
  const store = useLiveQuery(() => db.store.get('store-1'), [])
  const categories =
    useLiveQuery(async () => {
      await getAllCategories()
      return (await db.categories.toArray())
        .filter((c) => !c.deletedAt)
        .map(normalizeCategory)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }, []) || []

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [apiBase, setApiBaseState] = useState('')
  const [apiSaved, setApiSaved] = useState(false)
  const [samplePurchase, setSamplePurchase] = useState('100')
  const [saved, setSaved] = useState(false)
  const [catMsg, setCatMsg] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sampleCatId, setSampleCatId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{
    name: string
    baseType: ProductType
    wholesaleMarkupPct: string
    mrpMarkupPct: string
    saleDiscountFromMrpPct: string
  }>({
    name: '',
    baseType: 'garment',
    wholesaleMarkupPct: String(DEFAULT_CATEGORY_RULES.wholesaleMarkupPct),
    mrpMarkupPct: String(DEFAULT_CATEGORY_RULES.mrpMarkupPct),
    saleDiscountFromMrpPct: String(DEFAULT_CATEGORY_RULES.saleDiscountFromMrpPct),
  })

  useEffect(() => {
    if (!store) return
    setName(store.name)
    setAddress(store.address)
    setPhone(store.phone)
    setCity(store.city)
  }, [store])

  useEffect(() => {
    setApiBaseState(getApiBase())
  }, [])

  function saveApiBase() {
    setApiBase(apiBase)
    setApiSaved(true)
    setTimeout(() => setApiSaved(false), 1500)
  }

  const sample = Number(samplePurchase) || 0

  const selectedForSample = useMemo(() => {
    const id = sampleCatId || editingId
    if (id) return categories.find((c) => c.id === id) || categories[0]
    return categories[0]
  }, [categories, editingId, sampleCatId])

  const samplePrices = useMemo(() => {
    if (!selectedForSample) return computePricesFromPurchase(sample, emptyRules())
    return computePricesFromPurchase(sample, rulesFromCategory(selectedForSample))
  }, [sample, selectedForSample])

  async function saveProfile() {
    const rec = {
      id: 'store-1',
      name,
      address,
      phone,
      city,
      updatedAt: new Date().toISOString(),
      pricingSettings: store?.pricingSettings,
    }
    await db.store.put(rec)
    await enqueue('store', rec, rec.id)
    void flushOutbox()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  function startAdd() {
    setAdding(true)
    setEditingId(null)
    setDraft({
      name: '',
      baseType: 'garment',
      wholesaleMarkupPct: String(DEFAULT_CATEGORY_RULES.wholesaleMarkupPct),
      mrpMarkupPct: String(DEFAULT_CATEGORY_RULES.mrpMarkupPct),
      saleDiscountFromMrpPct: String(DEFAULT_CATEGORY_RULES.saleDiscountFromMrpPct),
    })
  }

  function startEdit(c: Category) {
    setAdding(false)
    setEditingId(c.id)
    setDraft({
      name: c.name,
      baseType: c.baseType,
      wholesaleMarkupPct: String(c.wholesaleMarkupPct),
      mrpMarkupPct: String(c.mrpMarkupPct),
      saleDiscountFromMrpPct: String(c.saleDiscountFromMrpPct),
    })
  }

  function cancelEdit() {
    setAdding(false)
    setEditingId(null)
  }

  function onBaseTypeChange(baseType: ProductType) {
    setDraft((d) => ({
      ...d,
      baseType,
      // Prefill % from defaults for that base type when adding
      ...(adding
        ? {
            wholesaleMarkupPct: String(DEFAULT_CATEGORY_RULES.wholesaleMarkupPct),
            mrpMarkupPct: String(DEFAULT_CATEGORY_RULES.mrpMarkupPct),
            saleDiscountFromMrpPct: String(DEFAULT_CATEGORY_RULES.saleDiscountFromMrpPct),
          }
        : {}),
    }))
  }

  async function saveCategory() {
    const nm = draft.name.trim()
    if (!nm) {
      setCatMsg('Name is required')
      return
    }
    const t = new Date().toISOString()
    const id = adding ? uid() : editingId!
    const existing = adding ? undefined : await db.categories.get(id)
    const maxSort = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    const cat: Category = {
      id,
      name: nm,
      slug: slugify(nm),
      baseType: draft.baseType,
      wholesaleMarkupPct: Number(draft.wholesaleMarkupPct) || 0,
      mrpMarkupPct: Number(draft.mrpMarkupPct) || 0,
      saleDiscountFromMrpPct: Number(draft.saleDiscountFromMrpPct) || 0,
      sortOrder: existing?.sortOrder ?? maxSort + 10,
      active: existing?.active !== false,
      createdAt: existing?.createdAt || t,
      updatedAt: t,
      deletedAt: null,
    }
    // When editing name/% only — do not change baseType if products already use it? Spec says edit name and %.
    // Keep baseType editable only when adding; when editing, preserve existing baseType.
    if (!adding && existing) {
      cat.baseType = existing.baseType
    }
    await db.categories.put(cat)
    await enqueue('category', cat, cat.id)
    void flushOutbox()
    setCatMsg(adding ? 'Category added' : 'Category saved')
    setTimeout(() => setCatMsg(''), 1500)
    cancelEdit()
  }

  async function toggleActive(c: Category) {
    if (c.active) {
      const used = await db.products.filter((p) => !p.deletedAt && p.categoryId === c.id).count()
      if (used > 0) {
        const ok = confirm(
          `${used} product(s) use “${c.name}”. Deactivate anyway? Products keep this category until reassigned.`,
        )
        if (!ok) return
      }
    }
    const t = new Date().toISOString()
    const next: Category = {
      ...normalizeCategory(c),
      active: !c.active,
      updatedAt: t,
    }
    await db.categories.put(next)
    await enqueue('category', next, next.id)
    void flushOutbox()
  }

  async function tryDelete(c: Category) {
    const used = await db.products.filter((p) => !p.deletedAt && p.categoryId === c.id).count()
    if (used > 0) {
      alert(`Cannot delete “${c.name}” — ${used} product(s) still use it. Deactivate or reassign products first.`)
      return
    }
    if (!confirm(`Delete category “${c.name}”?`)) return
    const t = new Date().toISOString()
    const next: Category = { ...normalizeCategory(c), active: false, deletedAt: t, updatedAt: t }
    await db.categories.put(next)
    await enqueue('category', next, next.id)
    void flushOutbox()
  }

  const draftSample = useMemo(() => {
    const rules: CategoryPricingRules = {
      wholesaleMarkupPct: Number(draft.wholesaleMarkupPct) || 0,
      mrpMarkupPct: Number(draft.mrpMarkupPct) || 0,
      saleDiscountFromMrpPct: Number(draft.saleDiscountFromMrpPct) || 0,
    }
    return computePricesFromPurchase(sample, rules)
  }, [draft, sample])

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-bold text-brand-800">Store profile</h1>
      <p className="mb-4 text-sm text-slate-600">Shown on sale receipts. GST is never printed.</p>
      <div className="mb-4">
        <SyncBadge />
        <button type="button" className="ml-2 text-sm underline" onClick={() => void syncNow()}>
          Sync now
        </button>
      </div>
      <label className="mb-2 block text-sm">
        Shop name
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mb-2 block text-sm">
        Address
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="mb-2 block text-sm">
        City
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="mb-4 block text-sm">
        Phone
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <button type="button" className="mb-6 min-h-[48px] w-full rounded-xl bg-brand-600 font-semibold text-white" onClick={() => void saveProfile()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-lg font-bold text-brand-800">Sync server (phones / Android)</h2>
        <p className="mb-3 text-xs text-slate-600">
          Optional. Leave empty for offline-only on this device (IndexedDB). To sync with the shop PC, enter the PC
          address like <code className="rounded bg-slate-100 px-1">http://192.168.1.10:8787</code> (same Wi‑Fi). Desktop
          app uses the built-in local server automatically.
        </p>
        <label className="mb-3 block text-sm">
          API server URL
          <input
            className="mt-1 min-h-[44px] w-full rounded-xl border px-3"
            placeholder="http://192.168.x.x:8787"
            value={apiBase}
            onChange={(e) => setApiBaseState(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="min-h-[44px] w-full rounded-xl border border-brand-600 font-semibold text-brand-700"
          onClick={saveApiBase}
        >
          {apiSaved ? 'Saved' : 'Save sync server'}
        </button>
      </section>

      <section className="mb-4 rounded-2xl border border-brand-100 bg-cream/50 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-brand-800">Categories</h2>
          <button
            type="button"
            className="rounded-xl bg-brand-700 px-3 py-2 text-sm font-semibold text-white"
            onClick={startAdd}
          >
            Add category
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-600">
          Owner-managed categories with their own pricing %. Base type controls stock (sizes / piece / metre).
          Products pick a category; purchase auto-calc uses that category&apos;s %.
        </p>

        <label className="mb-3 block text-sm font-medium">
          Sample purchase (₹) for live example
          <input
            className="mt-1 min-h-[44px] w-full rounded-xl border bg-white px-3"
            value={samplePurchase}
            inputMode="decimal"
            onChange={(e) => setSamplePurchase(e.target.value)}
          />
        </label>

        {selectedForSample && !adding && !editingId && (
          <div className="mb-3 rounded-lg bg-brand-50 px-2 py-1.5 text-xs text-brand-900">
            {selectedForSample.name}: Purchase {inr(round2(sample))} → Wholesale {inr(samplePrices.wholesalePrice)} ·
            MRP {inr(samplePrices.mrp)} · Sale {inr(samplePrices.salePrice)}
          </div>
        )}

        {catMsg && <p className="mb-2 text-sm font-medium text-brand-700">{catMsg}</p>}

        <div className="space-y-3">
          {categories.map((c) => (
            <div
              key={c.id}
              className={`rounded-xl border bg-white p-3 ${!c.active ? 'opacity-60' : ''} ${
                editingId === c.id ? 'ring-2 ring-brand-400' : ''
              }`}
            >
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-brand-900">{c.name}</div>
                  <div className="text-[11px] text-slate-500">
                    Base: {BASE_TYPE_LABELS[c.baseType]} · W+{c.wholesaleMarkupPct}% · MRP+{c.mrpMarkupPct}% · Sale−
                    {c.saleDiscountFromMrpPct}%
                    {!c.active && <span className="ml-1 font-semibold text-amber-700">Inactive</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-[11px] font-semibold"
                    onClick={() => startEdit(c)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-[11px] font-semibold"
                    onClick={() => void toggleActive(c)}
                  >
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600"
                    onClick={() => void tryDelete(c)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="text-[11px] text-brand-700 underline"
                onClick={() => setSampleCatId(c.id)}
              >
                Show sample for this category
              </button>
            </div>
          ))}
          {!categories.length && (
            <div className="rounded-xl border border-dashed bg-white p-4 text-center text-sm text-slate-500">
              No categories yet
            </div>
          )}
        </div>

        {(adding || editingId) && (
          <div className="mt-4 rounded-xl border border-brand-200 bg-white p-3">
            <h3 className="mb-2 font-semibold text-brand-900">{adding ? 'New category' : 'Edit category'}</h3>
            <label className="mb-2 block text-sm">
              Name
              <input
                className="mt-1 min-h-[44px] w-full rounded-xl border px-3"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Kids wear"
              />
            </label>
            {adding && (
              <div className="mb-2">
                <div className="mb-1 text-sm font-medium">Base type (stock behaviour)</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {BASE_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onBaseTypeChange(t)}
                      className={`min-h-[44px] rounded-xl border px-2 text-xs font-semibold ${
                        draft.baseType === t ? 'border-brand-500 bg-brand-50' : ''
                      }`}
                    >
                      {BASE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!adding && editingId && (
              <p className="mb-2 text-xs text-slate-500">
                Base type is fixed after create ({BASE_TYPE_LABELS[draft.baseType]}). Create a new category to change
                stock behaviour.
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">
                Wholesale markup %
                <input
                  className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                  value={draft.wholesaleMarkupPct}
                  inputMode="decimal"
                  onChange={(e) => setDraft({ ...draft, wholesaleMarkupPct: e.target.value })}
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                MRP markup %
                <input
                  className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                  value={draft.mrpMarkupPct}
                  inputMode="decimal"
                  onChange={(e) => setDraft({ ...draft, mrpMarkupPct: e.target.value })}
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Sale discount from MRP %
                <input
                  className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                  value={draft.saleDiscountFromMrpPct}
                  inputMode="decimal"
                  onChange={(e) => setDraft({ ...draft, saleDiscountFromMrpPct: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-2 rounded-lg bg-brand-50 px-2 py-1.5 text-xs text-brand-900">
              Purchase {inr(round2(sample))} → Wholesale {inr(draftSample.wholesalePrice)} · MRP {inr(draftSample.mrp)} ·
              Sale {inr(draftSample.salePrice)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="min-h-[44px] rounded-xl border" onClick={cancelEdit}>
                Cancel
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-xl bg-brand-600 font-semibold text-white"
                onClick={() => void saveCategory()}
              >
                {adding ? 'Add' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Seed logins — Owner: owner / owner123 · Cashier: cashier / cashier123. Cashier can sell and view stock only.
      </p>
    </div>
  )
}
