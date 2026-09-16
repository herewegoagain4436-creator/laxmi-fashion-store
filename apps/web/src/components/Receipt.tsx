import { inr, qtyLabel, fmtDateTime } from '../lib/format'
import { DEFAULT_COLOUR, type Sale, type SaleItem, type StoreProfile } from '../types'

export function ReceiptView({
  store,
  sale,
  items,
}: {
  store: StoreProfile | undefined
  sale: Sale
  items: SaleItem[]
}) {
  return (
    <div
      id="receipt-print"
      className="mx-auto w-full max-w-sm bg-white p-4 font-mono text-[13px] text-black"
    >
      <div className="text-center">
        <div className="text-base font-bold uppercase leading-tight">
          {store?.name || 'Laxmi Fashion Wholesale Mart'}
        </div>
        {store?.address && <div>{store.address}</div>}
        {store?.city && <div>{store.city}</div>}
        {store?.phone && <div>Ph: {store.phone}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between">
        <span>Bill No</span>
        <span className="font-bold">{sale.billNo}</span>
      </div>
      <div className="flex justify-between">
        <span>Date</span>
        <span>{fmtDateTime(sale.datetime)}</span>
      </div>
      {sale.cashierName && (
        <div className="flex justify-between">
          <span>Cashier</span>
          <span>{sale.cashierName}</span>
        </div>
      )}
      {sale.customerPhone && (
        <div className="flex justify-between">
          <span>Phone</span>
          <span>{sale.customerPhone}</span>
        </div>
      )}
      {sale.priceChannel === 'wholesale' && (
        <div className="flex justify-between">
          <span>Channel</span>
          <span>WHOLESALE</span>
        </div>
      )}
      {sale.customerGstin && (
        <div className="flex justify-between">
          <span>GSTIN</span>
          <span>{sale.customerGstin}</span>
        </div>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 font-bold">
        <span>Item</span>
        <span>Qty</span>
        <span>Rate</span>
        <span>Amt</span>
      </div>
      {items.map((it) => {
        const isRet = (it.lineKind || 'sale') === 'return' || it.lineTotal < 0
        return (
          <div key={it.id} className="mt-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-2">
            <div>
              <div>
                {isRet ? 'RET ' : ''}
                {it.productName}
              </div>
              <div className="text-[11px]">
                {it.colour && it.colour !== DEFAULT_COLOUR ? `${it.colour} ` : ''}
                {it.size ? `Size: ${it.size}` : ''}
                {it.shade ? ` Shade: ${it.shade}` : ''}
                {it.mrp != null && it.mrp > 0 ? ` MRP:${it.mrp}` : ''}
              </div>
            </div>
            <span>{qtyLabel(Math.abs(it.quantity), it.unit)}</span>
            <span>{it.rate}</span>
            <span className="text-right">{it.lineTotal}</span>
          </div>
        )
      })}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.discount > 0 && (
        <div className="flex justify-between">
          <span>Discount</span>
          <span>- {inr(sale.discount)}</span>
        </div>
      )}
      <div className="flex justify-between text-base font-bold">
        <span>TOTAL</span>
        <span>{inr(sale.grandTotal)}</span>
      </div>
      {/* Customer receipt: no GST break-up lines (inclusive display policy). Tax stored for reports. */}
      <div className="mt-1 flex justify-between uppercase">
        <span>Payment</span>
        <span>{sale.paymentMode}</span>
      </div>
      {sale.paymentMode === 'split' && (
        <div className="text-[12px]">
          {sale.cashAmount > 0 && <div>Cash {inr(sale.cashAmount)}</div>}
          {sale.upiAmount > 0 && <div>UPI {inr(sale.upiAmount)}</div>}
          {sale.cardAmount > 0 && <div>Card {inr(sale.cardAmount)}</div>}
        </div>
      )}
      {sale.upiRef && (
        <div className="flex justify-between text-[12px]">
          <span>UPI Ref</span>
          <span>{sale.upiRef}</span>
        </div>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">Thank you! Visit again</div>
    </div>
  )
}

export function printReceipt() {
  window.print()
}

export function downloadReceiptPdf() {
  window.print()
}
