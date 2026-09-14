export function inr(n: number) {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(v)
}

export function qtyLabel(qty: number, unit: string) {
  const q = Number(qty)
  const pretty = Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  if (unit === 'metre' || unit === 'm') return `${pretty} m`
  if (unit === 'cm') return `${pretty} cm`
  return pretty
}

export function stockQtyOfLine(unit: string, quantity: number) {
  if (unit === 'cm') return quantity / 100
  return quantity
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function todayStartIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function productStock(p: {
  type: string
  quantity: number
  sizes?: Array<{ quantity: number }>
}) {
  if (p.type === 'garment') return (p.sizes || []).reduce((s, x) => s + Number(x.quantity || 0), 0)
  return Number(p.quantity || 0)
}

export function isLowStock(p: {
  type: string
  quantity: number
  lowStockThreshold: number
  sizes?: Array<{ quantity: number }>
}) {
  return productStock(p) <= Number(p.lowStockThreshold || 0)
}

export function typeLabel(t: string) {
  if (t === 'garment') return 'Garment'
  if (t === 'saree') return 'Saree'
  if (t === 'fabric') return 'Than / Fabric'
  return t
}
