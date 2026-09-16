import QRCode from 'qrcode'
import { round2 } from './gst'

/** Build a UPI intent / pay URI for amount-specific QR. */
export function buildUpiPayUri(opts: {
  vpa: string
  amount: number
  payeeName?: string
  note?: string
  transactionRef?: string
}) {
  const pa = opts.vpa.trim()
  const am = round2(opts.amount).toFixed(2)
  const params = new URLSearchParams()
  params.set('pa', pa)
  params.set('am', am)
  params.set('cu', 'INR')
  if (opts.payeeName) params.set('pn', opts.payeeName)
  if (opts.note) params.set('tn', opts.note.slice(0, 80))
  if (opts.transactionRef) params.set('tr', opts.transactionRef.slice(0, 35))
  return `upi://pay?${params.toString()}`
}

export async function upiQrDataUrl(uri: string, size = 220): Promise<string> {
  return QRCode.toDataURL(uri, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
  })
}
