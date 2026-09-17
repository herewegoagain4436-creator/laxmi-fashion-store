import { db, enqueue } from '../db'
import type { Customer, CustomerPayment, Sale } from '../types'
import { uid } from './ids'

export async function upsertCustomer(input: {
  id?: string
  phone: string
  name: string
  gstin?: string
  notes?: string
}): Promise<Customer> {
  const phone = input.phone.trim()
  const existing =
    (input.id && (await db.customers.get(input.id))) ||
    (await db.customers.filter((c) => !c.deletedAt && c.phone === phone).first())
  const t = new Date().toISOString()
  const customer: Customer = {
    id: existing?.id || input.id || uid(),
    phone,
    name: input.name.trim() || existing?.name || phone,
    gstin: (input.gstin || existing?.gstin || '').trim().toUpperCase() || undefined,
    balance: existing?.balance ?? 0,
    notes: input.notes ?? existing?.notes ?? '',
    createdAt: existing?.createdAt || t,
    updatedAt: t,
    deletedAt: null,
  }
  await db.customers.put(customer)
  await enqueue('customer', customer, customer.id)
  return customer
}

export async function findCustomerByPhone(phone: string) {
  const p = phone.trim()
  if (!p) return undefined
  return db.customers.filter((c) => !c.deletedAt && c.phone === p).first()
}

export async function applyCreditSale(customerId: string, amount: number, saleId: string) {
  const c = await db.customers.get(customerId)
  if (!c) return
  const balance = Math.round((Number(c.balance) + amount) * 100) / 100
  await db.customers.update(customerId, { balance, updatedAt: new Date().toISOString() })
  const updated = { ...c, balance, updatedAt: new Date().toISOString() }
  await enqueue('customer', updated, customerId)
  void saleId
}

export async function recordCustomerPayment(opts: {
  customerId: string
  amount: number
  mode: CustomerPayment['mode']
  notes?: string
  createdBy?: string
  saleId?: string | null
}) {
  const amount = Math.round(Number(opts.amount) * 100) / 100
  if (!(amount > 0)) throw new Error('Payment amount must be positive')
  const c = await db.customers.get(opts.customerId)
  if (!c) throw new Error('Customer not found')
  const t = new Date().toISOString()
  const pay: CustomerPayment = {
    id: uid(),
    customerId: opts.customerId,
    amount,
    mode: opts.mode,
    saleId: opts.saleId || null,
    notes: opts.notes || '',
    createdAt: t,
    createdBy: opts.createdBy,
  }
  const balance = Math.round((Number(c.balance) - amount) * 100) / 100
  await db.transaction('rw', db.customers, db.customerPayments, db.outbox, async () => {
    await db.customerPayments.put(pay)
    await db.customers.update(opts.customerId, { balance, updatedAt: t })
    await enqueue('customer_payment', pay, pay.id)
    await enqueue('customer', { ...c, balance, updatedAt: t }, c.id)
  })
  return { payment: pay, balance }
}

/** Ageing buckets from oldest open credit sale datetime. */
export function ageingBucket(oldestCreditIso: string | null | undefined, now = Date.now()) {
  if (!oldestCreditIso) return '0-30' as const
  const days = Math.floor((now - new Date(oldestCreditIso).getTime()) / (24 * 3600 * 1000))
  if (days <= 30) return '0-30' as const
  if (days <= 60) return '31-60' as const
  return '60+' as const
}

export function creditSalesForCustomer(sales: Sale[], customerId: string) {
  return sales.filter(
    (s) =>
      s.customerId === customerId &&
      (Number(s.creditAmount) || 0) > 0 &&
      s.status !== 'voided' &&
      s.status !== 'returned',
  )
}
