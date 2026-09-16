import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, productsWithSizes } from '../db'
import { inr, isLowStock, productStock, todayStartIso, typeLabel } from '../lib/format'
import { DEFAULT_COLOUR } from '../types'

export function Reports() {
  const sales = useLiveQuery(() => db.sales.toArray(), []) || []
  const saleItems = useLiveQuery(() => db.saleItems.toArray(), []) || []
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const start = todayStartIso()
  const today = sales.filter((s) => s.datetime >= start && s.status !== 'returned' && s.status !== 'held')
  const total = today.reduce((a, s) => a + s.grandTotal, 0)
  const cash = today.reduce((a, s) => a + s.cashAmount, 0)
  const upi = today.reduce((a, s) => a + s.upiAmount, 0)
  const card = today.reduce((a, s) => a + s.cardAmount, 0)
  const gstToday = today.reduce((a, s) => a + Number(s.gstTotal || 0), 0)
  const taxableToday = today.reduce((a, s) => a + Number(s.taxableTotal || 0), 0)

  const gstByRate = useMemo(() => {
    const todayIds = new Set(today.map((s) => s.id))
    const map = new Map<number, number>()
    for (const it of saleItems) {
      if (!todayIds.has(it.saleId)) continue
      const rate = Number(it.gstRate || 0)
      const amt = Number(it.cgstAmount || 0) + Number(it.sgstAmount || 0)
      map.set(rate, (map.get(rate) || 0) + amt)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [saleItems, today])

  const lowVariants = useMemo(() => {
    const rows: Array<{ name: string; colour: string; size: string; qty: number; barcode?: string | null }> = []
    for (const p of products) {
      if (p.type === 'garment') {
        for (const s of p.sizes || []) {
          if (Number(s.quantity) <= Number(p.lowStockThreshold || 0)) {
            rows.push({
              name: p.name,
              colour: s.colour || DEFAULT_COLOUR,
              size: s.size,
              qty: Number(s.quantity),
              barcode: s.barcode,
            })
          }
        }
      } else if (isLowStock(p)) {
        rows.push({
          name: p.name,
          colour: p.shade || '—',
          size: p.type === 'fabric' ? 'MTR' : 'pc',
          qty: productStock(p),
        })
      }
    }
    return rows.slice(0, 80)
  }, [products])

  const deadStock = useMemo(() => {
    const sold = new Set<string>()
    const cutoff = Date.now() - 60 * 24 * 3600 * 1000
    for (const it of saleItems) {
      const sale = sales.find((s) => s.id === it.saleId)
      if (!sale) continue
      if (new Date(sale.datetime).getTime() < cutoff) continue
      sold.add(`${it.productId}::${it.colour || DEFAULT_COLOUR}::${it.size || ''}`)
    }
    const rows: Array<{ name: string; colour: string; size: string; qty: number }> = []
    for (const p of products) {
      if (p.type !== 'garment') continue
      for (const s of p.sizes || []) {
        if (Number(s.quantity) <= 0) continue
        const key = `${p.id}::${s.colour || DEFAULT_COLOUR}::${s.size}`
        if (!sold.has(key)) {
          rows.push({
            name: p.name,
            colour: s.colour || DEFAULT_COLOUR,
            size: s.size,
            qty: Number(s.quantity),
          })
        }
      }
    }
    return rows.slice(0, 40)
  }, [products, saleItems, sales])

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-xl font-bold text-brand-800">Reports</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Today sales', inr(total)],
          ['Bills', String(today.length)],
          ['Cash (Z)', inr(cash)],
          ['UPI (Z)', inr(upi)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{k}</div>
            <div className="text-2xl font-bold text-brand-800">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase text-slate-500">Card today</div>
          <div className="text-xl font-bold">{inr(card)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase text-slate-500">Taxable (internal)</div>
          <div className="text-xl font-bold">{inr(taxableToday)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase text-slate-500">GST collected (internal)</div>
          <div className="text-xl font-bold">{inr(gstToday)}</div>
        </div>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">GST summary today (5% vs 18%)</h2>
      <div className="lf-card overflow-auto p-3">
        {gstByRate.length === 0 && <div className="text-sm text-slate-500">No GST lines yet today</div>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="px-2 py-1">Rate</th>
              <th className="px-2 py-1">GST amount</th>
            </tr>
          </thead>
          <tbody>
            {gstByRate.map(([rate, amt]) => (
              <tr key={rate} className="border-t">
                <td className="px-2 py-1">{rate}%</td>
                <td className="px-2 py-1 font-semibold">{inr(amt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Low stock by size / colour</h2>
      <div className="overflow-auto lf-card">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Colour</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-left">Qty</th>
            </tr>
          </thead>
          <tbody>
            {lowVariants.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.colour}</td>
                <td className="px-3 py-2">{r.size}</td>
                <td className="px-3 py-2 text-amber-700">{r.qty}</td>
              </tr>
            ))}
            {lowVariants.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={4}>
                  No low-stock variants
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Dead stock (no sales in 60 days)</h2>
      <div className="overflow-auto lf-card">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Colour</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-left">Qty</th>
            </tr>
          </thead>
          <tbody>
            {deadStock.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.colour}</td>
                <td className="px-3 py-2">{r.size}</td>
                <td className="px-3 py-2">{r.qty}</td>
              </tr>
            ))}
            {deadStock.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={4}>
                  None flagged
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Stock snapshot</h2>
      <div className="overflow-auto lf-card">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Stock</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{typeLabel(p.type)}</td>
                <td className="px-3 py-2">
                  {p.type === 'fabric' ? `${productStock(p)} m` : `${productStock(p)} pcs`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
