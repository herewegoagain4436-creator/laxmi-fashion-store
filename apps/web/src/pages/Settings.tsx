import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, enqueue } from '../db'
import {
  CATEGORY_LABELS,
  computePricesFromPurchase,
  DEFAULT_PRICING_SETTINGS,
  normalizePricingSettings,
  round2,
} from '../lib/pricing'
import { flushOutbox, syncNow } from '../sync'
import { SyncBadge } from '../components/SyncBadge'
import { inr } from '../lib/format'
import type { CategoryPricingRules, PricingSettings, ProductType } from '../types'

const TYPES: ProductType[] = ['garment', 'saree', 'fabric']

function emptyRules(): CategoryPricingRules {
  return { ...DEFAULT_PRICING_SETTINGS.garment }
}

export function Settings() {
  const store = useLiveQuery(() => db.store.get('store-1'), [])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [pricing, setPricing] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS)
  const [samplePurchase, setSamplePurchase] = useState('10')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!store) return
    setName(store.name)
    setAddress(store.address)
    setPhone(store.phone)
    setCity(store.city)
    setPricing(normalizePricingSettings(store.pricingSettings))
  }, [store])

  const sample = Number(samplePurchase) || 0

  const examples = useMemo(() => {
    const out: Record<ProductType, ReturnType<typeof computePricesFromPurchase>> = {
      garment: computePricesFromPurchase(sample, pricing, 'garment'),
      saree: computePricesFromPurchase(sample, pricing, 'saree'),
      fabric: computePricesFromPurchase(sample, pricing, 'fabric'),
    }
    return out
  }, [pricing, sample])

  function setRule(type: ProductType, field: keyof CategoryPricingRules, value: string) {
    const n = Number(value)
    setPricing((prev) => ({
      ...prev,
      [type]: {
        ...(prev[type] || emptyRules()),
        [field]: Number.isFinite(n) ? n : 0,
      },
    }))
  }

  async function save() {
    const rec = {
      id: 'store-1',
      name,
      address,
      phone,
      city,
      updatedAt: new Date().toISOString(),
      pricingSettings: normalizePricingSettings(pricing),
    }
    await db.store.put(rec)
    await enqueue('store', rec, rec.id)
    void flushOutbox()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

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

      <section className="mb-4 rounded-2xl border border-brand-100 bg-cream/50 p-4">
        <h2 className="mb-1 text-lg font-bold text-brand-800">Pricing rules</h2>
        <p className="mb-3 text-xs text-slate-600">
          Used when you enter purchase cost. Each category (garment, saree, fabric) has its own %. You can still
          override on each product or purchase line.
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

        <div className="space-y-4">
          {TYPES.map((type) => {
            const rules = pricing[type] || emptyRules()
            const ex = examples[type]
            return (
              <div key={type} className="rounded-xl border bg-white p-3">
                <div className="mb-2 font-semibold text-brand-900">{CATEGORY_LABELS[type]}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="text-xs font-medium text-slate-600">
                    Wholesale markup %
                    <input
                      className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                      value={String(rules.wholesaleMarkupPct)}
                      inputMode="decimal"
                      onChange={(e) => setRule(type, 'wholesaleMarkupPct', e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    MRP markup %
                    <input
                      className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                      value={String(rules.mrpMarkupPct)}
                      inputMode="decimal"
                      onChange={(e) => setRule(type, 'mrpMarkupPct', e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Sale discount from MRP %
                    <input
                      className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-sm"
                      value={String(rules.saleDiscountFromMrpPct)}
                      inputMode="decimal"
                      onChange={(e) => setRule(type, 'saleDiscountFromMrpPct', e.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-2 rounded-lg bg-brand-50 px-2 py-1.5 text-xs text-brand-900">
                  Purchase {inr(round2(sample))} → Wholesale {inr(ex.wholesalePrice)} · MRP {inr(ex.mrp)} · Sale{' '}
                  {inr(ex.salePrice)}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <button type="button" className="min-h-[48px] w-full rounded-xl bg-brand-600 font-semibold text-white" onClick={() => void save()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>
      <p className="mt-6 text-xs text-slate-500">
        Seed logins — Owner: owner / owner123 · Cashier: cashier / cashier123. Cashier can sell and view stock only.
      </p>
    </div>
  )
}
