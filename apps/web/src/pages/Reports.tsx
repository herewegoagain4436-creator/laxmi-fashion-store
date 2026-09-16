import { useLiveQuery } from 'dexie-react-hooks'
import { db, productsWithSizes } from '../db'
import { inr, isLowStock, productStock, todayStartIso, typeLabel } from '../lib/format'

export function Reports() {
  const sales = useLiveQuery(() => db.sales.toArray(), []) || []
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const start = todayStartIso()
  const today = sales.filter((s) => s.datetime >= start && s.status !== 'returned')
  const total = today.reduce((a, s) => a + s.grandTotal, 0)
  const cash = today.reduce((a, s) => a + s.cashAmount, 0)
  const upi = today.reduce((a, s) => a + s.upiAmount, 0)
  const card = today.reduce((a, s) => a + s.cardAmount, 0)
  const low = products.filter(isLowStock)

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-xl font-bold text-brand-800">Reports</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Today sales', inr(total)],
          ['Bills', String(today.length)],
          ['Cash', inr(cash)],
          ['UPI', inr(upi)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{k}</div>
            <div className="text-2xl font-bold text-brand-800">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-2xl border bg-white p-4">
        <div className="text-xs uppercase text-slate-500">Card today</div>
        <div className="text-xl font-bold">{inr(card)}</div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Low stock</h2>
      <div className="overflow-auto lf-card">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Stock</th>
            </tr>
          </thead>
          <tbody>
            {low.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{typeLabel(p.type)}</td>
                <td className="px-3 py-2 text-amber-700">
                  {p.type === 'fabric' ? `${productStock(p)} m` : `${productStock(p)} pcs`}
                </td>
              </tr>
            ))}
            {low.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={3}>
                  No low-stock items
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
                <td className="px-3 py-2">{p.type === 'fabric' ? `${productStock(p)} m` : `${productStock(p)} pcs`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
