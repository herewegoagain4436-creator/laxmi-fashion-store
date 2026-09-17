import JsBarcode from 'jsbarcode'
import type { Product, ProductSize } from '../types'
import { normalizeColour } from './variants'
import { inr } from './format'

export type LabelVariant = {
  product: Product
  variant: ProductSize
}

function svgBarcodeDataUrl(code: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, code, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 12,
      height: 48,
      margin: 4,
      width: 1.4,
    })
  } catch {
    // Fallback for weird characters — still show text
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    t.setAttribute('x', '10')
    t.setAttribute('y', '30')
    t.textContent = code
    svg.appendChild(t)
    svg.setAttribute('width', '200')
    svg.setAttribute('height', '40')
  }
  const xml = new XMLSerializer().serializeToString(svg)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
}

export function printBarcodeLabels(rows: LabelVariant[], shopName?: string) {
  if (!rows.length) {
    alert('Select at least one variant with a barcode')
    return
  }
  const cards = rows
    .map(({ product, variant }) => {
      const code = (variant.barcode || '').trim()
      if (!code) return ''
      const colour = normalizeColour(variant.colour)
      const colourLabel = colour === 'Default' ? '' : colour
      const img = svgBarcodeDataUrl(code)
      return `<div class="label">
        <div class="shop">${escapeHtml(shopName || 'Laxmi Fashion')}</div>
        <div class="name">${escapeHtml(product.name)}</div>
        <div class="meta">${escapeHtml([colourLabel, variant.size].filter(Boolean).join(' · '))}</div>
        <div class="prices">
          <span>MRP ${escapeHtml(inr(product.mrp))}</span>
          <span class="sale">Sale ${escapeHtml(inr(product.salePrice ?? product.sellingPrice))}</span>
        </div>
        <img src="${img}" alt="${escapeHtml(code)}" />
      </div>`
    })
    .filter(Boolean)
    .join('\n')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Barcode labels</title>
<style>
  @page { margin: 8mm; }
  body { font-family: system-ui, sans-serif; margin: 0; }
  .sheet { display: flex; flex-wrap: wrap; gap: 6mm; }
  .label {
    width: 60mm; min-height: 40mm; border: 1px dashed #999; padding: 3mm;
    box-sizing: border-box; page-break-inside: avoid;
  }
  .shop { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
  .name { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .meta { font-size: 11px; color: #333; margin: 2px 0; }
  .prices { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px; }
  .sale { font-weight: 700; }
  img { width: 100%; height: auto; display: block; }
  @media print {
    .label { border-style: solid; border-color: #ccc; }
  }
</style></head><body>
<div class="sheet">${cards}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script>
</body></html>`

  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
  if (!w) {
    alert('Allow pop-ups to print labels')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
