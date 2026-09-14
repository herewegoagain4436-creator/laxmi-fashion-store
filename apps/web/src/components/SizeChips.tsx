import { useState } from 'react'
import { STANDARD_SIZES } from '../types'

type Props = {
  sizes: Array<{ size: string; quantity?: number }>
  value?: string
  onChange: (size: string) => void
  showStock?: boolean
  allowCustom?: boolean
  disableEmpty?: boolean
  onlyExisting?: boolean
}

export function SizeChips({
  sizes,
  value,
  onChange,
  showStock,
  allowCustom = true,
  disableEmpty,
  onlyExisting,
}: Props) {
  const [custom, setCustom] = useState('')
  const known = new Set(STANDARD_SIZES as readonly string[])
  const extras = sizes.map((s) => s.size).filter((s) => !known.has(s))
  const stockOf = (size: string) => sizes.find((s) => s.size === size)?.quantity
  const all = onlyExisting
    ? sizes.map((s) => s.size)
    : [...STANDARD_SIZES, ...extras.filter((s) => !(STANDARD_SIZES as readonly string[]).includes(s))]

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {all.map((sz) => {
          const stock = stockOf(sz)
          const disabled = disableEmpty && (stock == null || stock <= 0)
          const active = value === sz
          return (
            <button
              key={sz}
              type="button"
              disabled={disabled}
              onClick={() => onChange(sz)}
              className={`chip flex flex-col items-center justify-center ${
                active
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : disabled
                    ? 'border-slate-200 bg-slate-50 text-slate-400'
                    : 'border-brand-200 bg-white text-brand-800 hover:border-brand-500'
              }`}
            >
              <span>{sz}</span>
              {showStock && stock != null && (
                <span className={`text-[10px] font-medium ${active ? 'text-white/80' : 'text-slate-500'}`}>
                  {stock} pcs
                </span>
              )}
            </button>
          )
        })}
      </div>
      {allowCustom && (
        <div className="mt-2 flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom (32, 34, 36…)"
            className="min-h-[48px] flex-1 rounded-xl border border-brand-200 px-3"
          />
          <button
            type="button"
            className="min-h-[48px] rounded-xl bg-brand-700 px-4 font-semibold text-white"
            onClick={() => {
              const v = custom.trim()
              if (v) {
                onChange(v)
                setCustom('')
              }
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}
