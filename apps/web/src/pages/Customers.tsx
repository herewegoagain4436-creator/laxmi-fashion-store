import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Search, Wallet } from 'lucide-react'
import { db } from '../db'
import { useAuth } from '../auth'
import { inr } from '../lib/format'
import {
  ageingBucket,
  creditSalesForCustomer,
  recordCustomerPayment,
  upsertCustomer,
} from '../lib/customers'
import { writeAudit } from '../lib/audit'
import { flushOutbox } from '../sync'

export function Customers() {
  const { user } = useAuth()
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deletedAt).toArray(), []) || []
  const sales = useLiveQuery(() => db.sales.toArray(), []) || []
  const payments = useLiveQuery(() => db.customerPayments.orderBy('createdAt').reverse().toArray(), []) || []
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [payId, setPayId] = useState<string | null>(null)
  const [payAmt, setPayAmt] = useState('')
  const [payMode, setPayMode] = useState<'cash' | 'upi' | 'card'>('cash')
  const [err, setErr] = useState('')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = [...customers].sort((a, b) => Number(b.balance) - Number(a.balance))
    if (!s) return list
    return list.filter(
      (c) => c.name.toLowerCase().includes(s) || c.phone.includes(s) || (c.gstin || '').toLowerCase().includes(s),
    )
  }, [customers, q])

  const outstanding = filtered.filter((c) => Number(c.balance) > 0.009)

  const ageing = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '60+': 0 }
    for (const c of outstanding) {
      const creds = creditSalesForCustomer(sales, c.id)
      const oldest = creds.map((s) => s.datetime).sort()[0]
      buckets[ageingBucket(oldest)] += Number(c.balance)
    }
    return buckets
  }, [outstanding, sales])

  async function saveCustomer() {
    setErr('')
    if (!phone.trim() || !name.trim()) {
      setErr('Name and phone required')
      return
    }
    await upsertCustomer({ phone, name, gstin })
    void flushOutbox()
    setName('')
    setPhone('')
    setGstin('')
  }

  async function takePayment() {
    if (!payId) return
    try {
      const amount = Number(payAmt)
      const { balance } = await recordCustomerPayment({
        customerId: payId,
        amount,
        mode: payMode,
        createdBy: user?.id,
        notes: 'Udhaar collection',
      })
      await writeAudit({
        action: 'credit_payment',
        entityType: 'customer',
        entityId: payId,
        userId: user?.id,
        userName: user?.name,
        detail: { amount, mode: payMode, balanceAfter: balance },
      })
      void flushOutbox()
      setPayId(null)
      setPayAmt('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="lf-page-title">Customers / Udhaar</h1>
          <p className="text-sm text-slate-500">Credit ledger, collections, and ageing</p>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {(
          [
            ['0–30 days', ageing['0-30']],
            ['31–60 days', ageing['31-60']],
            ['60+ days', ageing['60+']],
          ] as const
        ).map(([label, amt]) => (
          <div key={label} className="rounded-2xl border bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="text-xl font-bold text-brand-800">{inr(amt)}</div>
          </div>
        ))}
      </div>

      <div className="lf-card mb-4 p-4">
        <h2 className="mb-2 font-semibold text-brand-800">Add customer</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className="lf-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="lf-input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input
            className="lf-input"
            placeholder="GSTIN (optional)"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
          />
          <button type="button" className="lf-btn-primary gap-1" onClick={() => void saveCustomer()}>
            <Plus className="h-4 w-4" /> Save
          </button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="lf-input pl-10"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customers"
        />
      </div>

      <div className="overflow-auto lf-card">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">GSTIN</th>
              <th className="px-3 py-2 text-left">Balance</th>
              <th className="px-3 py-2 text-left">Ageing</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const creds = creditSalesForCustomer(sales, c.id)
              const oldest = creds.map((s) => s.datetime).sort()[0]
              const bucket = Number(c.balance) > 0 ? ageingBucket(oldest) : '—'
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{c.phone}</td>
                  <td className="px-3 py-2 text-xs">{c.gstin || '—'}</td>
                  <td className={`px-3 py-2 font-semibold ${Number(c.balance) > 0 ? 'text-amber-700' : ''}`}>
                    {inr(Number(c.balance))}
                  </td>
                  <td className="px-3 py-2">{bucket}</td>
                  <td className="px-3 py-2 text-right">
                    {Number(c.balance) > 0 && (
                      <button
                        type="button"
                        className="lf-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                        onClick={() => {
                          setPayId(c.id)
                          setPayAmt(String(c.balance))
                        }}
                      >
                        <Wallet className="h-3.5 w-3.5" /> Collect
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No customers yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Recent collections</h2>
      <div className="lf-card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Mode</th>
              <th className="px-3 py-2 text-left">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.slice(0, 30).map((pay) => {
              const c = customers.find((x) => x.id === pay.customerId)
              return (
                <tr key={pay.id} className="border-t">
                  <td className="px-3 py-2 text-xs">{new Date(pay.createdAt).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2">{c?.name || pay.customerId}</td>
                  <td className="px-3 py-2 uppercase">{pay.mode}</td>
                  <td className="px-3 py-2 font-semibold">{inr(pay.amount)}</td>
                </tr>
              )
            })}
            {payments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-slate-500">
                  No payments yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {payId && (
        <div className="lf-modal-backdrop">
          <div className="lf-modal max-w-md">
            <h3 className="mb-3 text-lg font-bold text-brand-800">Collect udhaar</h3>
            <input
              className="lf-input mb-2"
              value={payAmt}
              onChange={(e) => setPayAmt(e.target.value)}
              inputMode="decimal"
              placeholder="Amount"
            />
            <div className="mb-3 flex gap-2">
              {(['cash', 'upi', 'card'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`min-h-[40px] flex-1 rounded-lg border text-sm font-semibold uppercase ${
                    payMode === m ? 'border-brand-500 bg-brand-50' : 'border-brand-200'
                  }`}
                  onClick={() => setPayMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" className="lf-btn-secondary flex-1" onClick={() => setPayId(null)}>
                Cancel
              </button>
              <button type="button" className="lf-btn-primary flex-1" onClick={() => void takePayment()}>
                Save payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
