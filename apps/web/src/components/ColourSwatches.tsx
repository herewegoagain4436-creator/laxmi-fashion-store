import { DEFAULT_COLOUR } from '../types'

const PRESET: Record<string, string> = {
  Red: '#c62828',
  Blue: '#1565c0',
  Navy: '#1a237e',
  Green: '#2e7d32',
  Black: '#212121',
  White: '#f5f5f5',
  Pink: '#ec407a',
  Yellow: '#f9a825',
  Maroon: '#6d1b2a',
  Beige: '#d7ccc8',
  Grey: '#757575',
  Gray: '#757575',
  Orange: '#ef6c00',
  Purple: '#6a1b9a',
  Brown: '#5d4037',
  Cream: '#fff8e1',
  Default: '#9e9e9e',
}

function swatchColor(name: string) {
  if (PRESET[name]) return PRESET[name]
  const key = Object.keys(PRESET).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? PRESET[key] : '#90a4ae'
}

type Props = {
  colours: string[]
  value: string
  onChange: (c: string) => void
  /** Optional qty by colour (sum across sizes). */
  stockByColour?: Record<string, number>
}

export function ColourSwatches({ colours, value, onChange, stockByColour }: Props) {
  const list = colours.length ? colours : [DEFAULT_COLOUR]
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Colour</div>
      <div className="flex flex-wrap gap-2">
        {list.map((c) => {
          const active = value === c
          const stock = stockByColour?.[c]
          const empty = stock != null && stock <= 0
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'border-brand-600 bg-brand-50 text-brand-900 ring-2 ring-brand-400'
                  : empty
                    ? 'border-slate-200 bg-slate-50 text-slate-400'
                    : 'border-brand-100 bg-white text-brand-900 hover:border-brand-300'
              }`}
              title={c}
            >
              <span
                className="h-5 w-5 shrink-0 rounded-full border border-black/15"
                style={{ backgroundColor: swatchColor(c) }}
              />
              <span>{c}</span>
              {stock != null && (
                <span className={`text-[10px] font-medium ${active ? 'text-brand-700' : 'text-slate-500'}`}>
                  {stock}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
