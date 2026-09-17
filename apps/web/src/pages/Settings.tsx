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
import {
  checkSyncHealth,
  getCloudUrl,
  getLanApiBase,
  getSyncMode,
  getSyncToken,
  setApiBase,
  setCloudUrl,
  setSyncMode,
  setSyncToken,
  type SyncMode,
} from '../api'
import { SyncBadge } from '../components/SyncBadge'
import { inr } from '../lib/format'
import { uid } from '../lib/ids'
import type { Category, CategoryPricingRules, ProductType } from '../types'
import { normalizeGstSettings } from '../lib/gst'
import {
  checkGitHubRelease,
  clearWebUpdateToken,
  downloadPrivateAsset,
  getAppVersion,
  getWebUpdateToken,
  isElectronDesktop,
  setWebUpdateToken,
  type ReleaseCheckResult,
} from '../lib/appUpdate'

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
  const [upiVpa, setUpiVpa] = useState('')
  const [gstin, setGstin] = useState('')
  const [apparelThreshold, setApparelThreshold] = useState('2500')
  const [apparelLow, setApparelLow] = useState('5')
  const [apparelHigh, setApparelHigh] = useState('18')
  const [fabricRate, setFabricRate] = useState('5')
  const [maxCashierDiscount, setMaxCashierDiscount] = useState('100')
  const [maxCashierDiscountPct, setMaxCashierDiscountPct] = useState('5')
  const [barcodePrefix, setBarcodePrefix] = useState('')
  const [syncMode, setSyncModeState] = useState<SyncMode>('offline')
  const [lanUrl, setLanUrl] = useState('')
  const [cloudUrl, setCloudUrlState] = useState('')
  const [syncTokenInput, setSyncTokenInput] = useState('')
  const [syncTokenSaved, setSyncTokenSaved] = useState(false)
  const [hasSyncToken, setHasSyncToken] = useState(false)
  const [syncSettingsSaved, setSyncSettingsSaved] = useState(false)
  const [syncHealthMsg, setSyncHealthMsg] = useState('')
  const [syncHealthOk, setSyncHealthOk] = useState<boolean | null>(null)
  const desktop = isElectronDesktop()
  const [updateToken, setUpdateTokenState] = useState('')
  const [updateTokenSaved, setUpdateTokenSaved] = useState(false)
  const [updateTokenMeta, setUpdateTokenMeta] = useState<{
    hasToken: boolean
    source: string
  }>({ hasToken: false, source: 'none' })
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')
  const [releaseInfo, setReleaseInfo] = useState<ReleaseCheckResult | null>(null)
  const [appVersion, setAppVersion] = useState(getAppVersion())
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
    setUpiVpa(store.upiVpa || '')
    setGstin(store.gstin || '')
    const g = normalizeGstSettings(store.gstSettings)
    setApparelThreshold(String(g.apparelThreshold))
    setApparelLow(String(g.apparelLowRate))
    setApparelHigh(String(g.apparelHighRate))
    setFabricRate(String(g.fabricRate))
    setMaxCashierDiscount(String(store.maxCashierDiscount ?? 100))
    setMaxCashierDiscountPct(String(store.maxCashierDiscountPct ?? 5))
    setBarcodePrefix(store.barcodePrefix || '')
  }, [store])

  useEffect(() => {
    setSyncModeState(getSyncMode())
    setLanUrl(getLanApiBase())
    setCloudUrlState(getCloudUrl())
    setHasSyncToken(Boolean(getSyncToken()))
  }, [])

  useEffect(() => {
    setAppVersion(getAppVersion())
    if (desktop && window.laxmiDesktop) {
      void window.laxmiDesktop.getAppVersion().then(setAppVersion).catch(() => {})
      void window.laxmiDesktop.getUpdateTokenMeta().then((m) => {
        setUpdateTokenMeta({ hasToken: m.hasToken, source: m.source })
      })
      const unsub = window.laxmiDesktop.onUpdateStatus((s) => {
        setUpdateMsg(s.message || s.status)
      })
      return unsub
    }
    setUpdateTokenMeta({
      hasToken: Boolean(getWebUpdateToken()),
      source: getWebUpdateToken() ? 'stored' : 'none',
    })
  }, [desktop])

  function saveSyncSettings() {
    setSyncMode(syncMode)
    setApiBase(lanUrl)
    setCloudUrl(cloudUrl)
    if (syncTokenInput.trim()) {
      setSyncToken(syncTokenInput)
      setSyncTokenInput('')
      setHasSyncToken(true)
      setSyncTokenSaved(true)
      setTimeout(() => setSyncTokenSaved(false), 1500)
    }
    setSyncSettingsSaved(true)
    setTimeout(() => setSyncSettingsSaved(false), 1500)
    setSyncHealthMsg('')
    setSyncHealthOk(null)
  }

  function clearSyncTokenField() {
    setSyncToken('')
    setSyncTokenInput('')
    setHasSyncToken(false)
    setSyncHealthMsg('Sync token cleared on this device.')
    setSyncHealthOk(null)
  }

  async function onCheckSyncHealth() {
    // Persist current form values first so health uses what user typed
    setSyncMode(syncMode)
    setApiBase(lanUrl)
    setCloudUrl(cloudUrl)
    if (syncTokenInput.trim()) {
      setSyncToken(syncTokenInput)
      setHasSyncToken(true)
    }
    const r = await checkSyncHealth()
    setSyncHealthOk(r.ok)
    setSyncHealthMsg(r.detail)
  }

  async function saveUpdateToken() {
    setUpdateMsg('')
    if (desktop && window.laxmiDesktop) {
      const r = await window.laxmiDesktop.setUpdateToken(updateToken)
      setUpdateTokenMeta({ hasToken: r.hasToken, source: r.source })
      setUpdateTokenState('')
      setUpdateTokenSaved(true)
      setTimeout(() => setUpdateTokenSaved(false), 1500)
      setUpdateMsg(r.hasToken ? 'Update token saved (encrypted on this PC).' : 'Token cleared.')
      return
    }
    setWebUpdateToken(updateToken)
    setUpdateTokenMeta({
      hasToken: Boolean(getWebUpdateToken()),
      source: getWebUpdateToken() ? 'stored' : 'none',
    })
    setUpdateTokenState('')
    setUpdateTokenSaved(true)
    setTimeout(() => setUpdateTokenSaved(false), 1500)
    setUpdateMsg(getWebUpdateToken() ? 'Update token saved on this device.' : 'Token cleared.')
  }

  async function clearUpdateToken() {
    if (desktop && window.laxmiDesktop) {
      await window.laxmiDesktop.clearUpdateToken()
      setUpdateTokenMeta({ hasToken: false, source: 'none' })
    } else {
      clearWebUpdateToken()
      setUpdateTokenMeta({ hasToken: false, source: 'none' })
    }
    setUpdateTokenState('')
    setReleaseInfo(null)
    setUpdateMsg('Update token cleared.')
  }

  async function onCheckUpdates() {
    setUpdateBusy(true)
    setUpdateMsg('')
    setReleaseInfo(null)
    try {
      if (desktop && window.laxmiDesktop) {
        const status = await window.laxmiDesktop.checkForUpdates()
        setUpdateMsg(status.message || status.status)
        return
      }
      // Web / Android: public GitHub Releases API (token optional)
      const result = await checkGitHubRelease()
      setReleaseInfo(result)
      setUpdateMsg(result.message)
    } finally {
      setUpdateBusy(false)
    }
  }

  async function onDownloadApk() {
    if (!releaseInfo || !releaseInfo.ok || !releaseInfo.apk) return
    setUpdateBusy(true)
    try {
      const r = await downloadPrivateAsset(
        releaseInfo.apk.apiUrl,
        releaseInfo.apk.name,
        undefined,
        releaseInfo.apk.browserUrl,
      )
      setUpdateMsg(r.ok ? 'APK download started.' : r.message)
    } finally {
      setUpdateBusy(false)
    }
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
      upiVpa: upiVpa.trim(),
      gstin: gstin.trim().toUpperCase(),
      gstSettings: normalizeGstSettings({
        apparelThreshold: Number(apparelThreshold) || 2500,
        apparelLowRate: Number(apparelLow) || 5,
        apparelHighRate: Number(apparelHigh) || 18,
        fabricRate: Number(fabricRate) || 5,
      }),
      maxCashierDiscount: Number(maxCashierDiscount) || 0,
      maxCashierDiscountPct: Number(maxCashierDiscountPct) || 0,
      barcodePrefix: barcodePrefix.trim().toUpperCase(),
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
      <h1 className="lf-page-title mb-1">Store profile</h1>
      <p className="mb-4 text-sm text-slate-600">Shown on sale receipts. GST is never printed.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SyncBadge />
        <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => void syncNow()}>
          Sync now
        </button>
      </div>
      <div className="lf-card mb-6 space-y-3 p-4">
      <label className="block">
        <span className="lf-label">Shop name</span>
        <input className="lf-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="lf-label">Address</span>
        <input className="lf-input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="block">
        <span className="lf-label">City</span>
        <input className="lf-input" value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="block">
        <span className="lf-label">Phone</span>
        <input className="lf-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="block">
        <span className="lf-label">UPI ID (VPA) for payment QR</span>
        <input
          className="lf-input font-mono"
          value={upiVpa}
          onChange={(e) => setUpiVpa(e.target.value)}
          placeholder="shop@upi"
        />
      </label>
      <label className="block">
        <span className="lf-label">Barcode prefix (optional)</span>
        <input
          className="lf-input font-mono uppercase"
          value={barcodePrefix}
          onChange={(e) => setBarcodePrefix(e.target.value)}
          placeholder="e.g. LF or shop code"
          maxLength={8}
        />
        <span className="mt-1 block text-[11px] text-slate-500">
          Prepended to auto-generated colour×size barcodes (Code128). Leave blank for SKU-COLOUR-SIZE only.
        </span>
      </label>
      <label className="block">
        <span className="lf-label">Shop GSTIN (optional, reports)</span>
        <input
          className="lf-input font-mono uppercase"
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          placeholder="22AAAAA0000A1Z5"
        />
      </label>
      <div className="rounded-xl border border-brand-100 bg-cream-50 p-3">
        <div className="mb-2 text-sm font-semibold text-brand-800">GST rates (Notification 9/2025)</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            Apparel threshold (₹ pre-GST)
            <input className="lf-input mt-1" value={apparelThreshold} onChange={(e) => setApparelThreshold(e.target.value)} />
          </label>
          <label className="text-xs">
            Fabric flat %
            <input className="lf-input mt-1" value={fabricRate} onChange={(e) => setFabricRate(e.target.value)} />
          </label>
          <label className="text-xs">
            Apparel ≤ threshold %
            <input className="lf-input mt-1" value={apparelLow} onChange={(e) => setApparelLow(e.target.value)} />
          </label>
          <label className="text-xs">
            Apparel above %
            <input className="lf-input mt-1" value={apparelHigh} onChange={(e) => setApparelHigh(e.target.value)} />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Defaults: ₹2,500 → 5% / above → 18%. Customer receipts stay GST-inclusive (no tax lines).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          Cashier max discount ₹
          <input className="lf-input mt-1" value={maxCashierDiscount} onChange={(e) => setMaxCashierDiscount(e.target.value)} />
        </label>
        <label className="text-xs">
          Cashier max discount %
          <input className="lf-input mt-1" value={maxCashierDiscountPct} onChange={(e) => setMaxCashierDiscountPct(e.target.value)} />
        </label>
      </div>
      <button type="button" className="lf-btn-primary w-full min-h-[48px]" onClick={() => void saveProfile()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>
      </div>

      <section className="lf-card mb-6 p-4">
        <h2 className="mb-1 text-lg font-bold text-brand-800">Stock sync (PC ↔ phone)</h2>
        <p className="mb-3 text-xs text-slate-600">
          Sales and stock are always saved on this device first (works offline). Choose how devices share data when
          online. For home + shop on different networks, use <strong>Cloud</strong> with the HTTPS URL and secret token
          from your shop setup (see CLOUD_SYNC.md).
        </p>

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              { id: 'offline' as const, label: 'Offline only', hint: 'This device only' },
              { id: 'lan' as const, label: 'LAN PC', hint: 'Same Wi‑Fi' },
              { id: 'cloud' as const, label: 'Cloud', hint: 'Internet / HTTPS' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSyncModeState(opt.id)}
              className={`min-h-[52px] rounded-xl border px-2 text-left ${
                syncMode === opt.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-400' : 'bg-white'
              }`}
            >
              <div className="text-sm font-semibold text-brand-900">{opt.label}</div>
              <div className="text-[11px] text-slate-500">{opt.hint}</div>
            </button>
          ))}
        </div>

        {syncMode === 'lan' && (
          <label className="mb-3 block text-sm">
            Shop PC address (same Wi‑Fi)
            <input
              className="lf-input mt-1"
              placeholder="http://192.168.x.x:8787"
              value={lanUrl}
              onChange={(e) => setLanUrl(e.target.value)}
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Desktop app on the PC already runs a local server. On the phone, enter the PC&apos;s LAN IP. Leave empty on
              the PC itself (uses built-in server).
            </span>
          </label>
        )}

        {syncMode === 'cloud' && (
          <>
            <label className="mb-3 block text-sm">
              Cloud URL (HTTPS)
              <input
                className="lf-input mt-1"
                placeholder="https://your-app.example.com"
                value={cloudUrl}
                onChange={(e) => setCloudUrlState(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="mb-3 block text-sm">
              Sync token (secret)
              <input
                className="lf-input mt-1 font-mono text-sm"
                type="password"
                autoComplete="off"
                placeholder={hasSyncToken ? '•••••••• (enter new token to replace)' : 'Paste store sync token'}
                value={syncTokenInput}
                onChange={(e) => setSyncTokenInput(e.target.value)}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Same token on PC and phone. Never share publicly. {hasSyncToken ? 'Token is saved on this device.' : ''}
              </span>
            </label>
            {hasSyncToken && (
              <button
                type="button"
                className="mb-3 text-xs font-semibold text-red-600 underline"
                onClick={clearSyncTokenField}
              >
                Clear sync token
              </button>
            )}
          </>
        )}

        {syncMode === 'offline' && (
          <p className="mb-3 rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
            Offline only: no automatic sync. Switch to <strong>Cloud</strong> when you want the phone and PC to share
            stock over the internet.
          </p>
        )}

        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="lf-btn-primary"
            onClick={saveSyncSettings}
          >
            {syncSettingsSaved || syncTokenSaved ? 'Saved' : 'Save sync settings'}
          </button>
          <button
            type="button"
            className="lf-btn-secondary border-brand-600 text-brand-700"
            onClick={() => void syncNow()}
          >
            Sync now
          </button>
        </div>
        <button
          type="button"
          className="mb-2 min-h-[40px] w-full rounded-xl border text-sm font-semibold text-slate-700"
          onClick={() => void onCheckSyncHealth()}
        >
          Check connection
        </button>
        {syncHealthMsg && (
          <p className={`text-sm ${syncHealthOk ? 'text-emerald-800' : 'text-amber-800'}`}>{syncHealthMsg}</p>
        )}
        <div className="mt-2">
          <SyncBadge />
        </div>
      </section>

      <section className="lf-card mb-6 p-4">
        <h2 className="lf-section-title mb-1">App updates</h2>
        <p className="mb-3 text-xs text-slate-600">
          Updates come from <strong>public</strong> GitHub Releases — no token required. Optionally paste a fine-grained
          PAT (Contents + Releases read) for higher API rate limits or private forks. On Windows desktop an optional
          token is stored with Electron safeStorage. Advanced: set env{' '}
          <code className="rounded bg-slate-100 px-1">GH_TOKEN</code> or{' '}
          <code className="rounded bg-slate-100 px-1">LAXMI_GH_TOKEN</code>.
        </p>
        <p className="mb-3 text-xs text-slate-500">
          Installed version: <strong>{appVersion}</strong>
          {updateTokenMeta.hasToken ? (
            <span className="ml-2 text-emerald-700">
              · Optional token set ({updateTokenMeta.source === 'env' ? 'from environment' : 'saved'})
            </span>
          ) : (
            <span className="ml-2 text-slate-500">· Public updates (no token)</span>
          )}
        </p>
        <label className="mb-2 block">
          <span className="lf-label">Update access token (optional)</span>
          <input
            className="lf-input font-mono text-sm"
            type="password"
            autoComplete="off"
            placeholder={updateTokenMeta.hasToken ? '•••••••• (enter new token to replace)' : 'github_pat_… (optional)'}
            value={updateToken}
            onChange={(e) => setUpdateTokenState(e.target.value)}
          />
        </label>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="lf-btn-primary"
            onClick={() => void saveUpdateToken()}
          >
            {updateTokenSaved ? 'Saved' : 'Save update token'}
          </button>
          <button
            type="button"
            className="lf-btn-secondary"
            onClick={() => void clearUpdateToken()}
          >
            Clear token
          </button>
        </div>
        <button
          type="button"
          disabled={updateBusy}
          className="lf-btn-secondary mb-2 w-full border-brand-600 text-brand-700"
          onClick={() => void onCheckUpdates()}
        >
          {updateBusy ? 'Checking…' : 'Check for updates'}
        </button>
        {updateMsg && (
          <p className="mb-2 text-sm text-slate-700">
            {updateMsg}
          </p>
        )}
        {releaseInfo && releaseInfo.ok && releaseInfo.newer && (
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-900">
            <div className="mb-2 font-semibold">
              New version {releaseInfo.latestVersion} (you have {releaseInfo.currentVersion})
            </div>
            {releaseInfo.apk && (
              <button
                type="button"
                className="mb-2 min-h-[40px] w-full rounded-xl bg-brand-700 font-semibold text-white"
                disabled={updateBusy}
                onClick={() => void onDownloadApk()}
              >
                Download LaxmiFashion.apk
              </button>
            )}
            <a
              className="text-xs underline"
              href={releaseInfo.releaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open release page on GitHub
            </a>
          </div>
        )}
        {desktop && (
          <p className="mt-2 text-[11px] text-slate-500">
            Desktop also checks on startup (Help → Check for updates). Shop data in AppData is kept across updates.
          </p>
        )}
      </section>

      <section className="lf-card-muted mb-4 p-4">
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
                className="lf-input mt-1"
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
