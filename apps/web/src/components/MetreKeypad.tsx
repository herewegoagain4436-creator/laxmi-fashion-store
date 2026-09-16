type Props = {
  value: string
  onChange: (v: string) => void
  unitLabel?: string
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']

export function MetreKeypad({ value, onChange, unitLabel = 'MTR' }: Props) {
  function press(k: string) {
    if (k === '⌫') {
      onChange(value.slice(0, -1))
      return
    }
    if (k === '.' && value.includes('.')) return
    if (value === '0' && k !== '.') onChange(k)
    else onChange((value + k).slice(0, 8))
  }
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Length ({unitLabel})</span>
        <span className="font-mono text-2xl font-bold tabular-nums text-brand-900">{value || '0'} {unitLabel}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="min-h-[48px] rounded-xl border border-brand-100 bg-white text-lg font-semibold text-brand-900 active:bg-brand-50"
          >
            {k}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {['1', '2', '2.5', '3.5'].map((q) => (
          <button
            key={q}
            type="button"
            className="min-h-[40px] rounded-lg bg-brand-50 text-sm font-bold text-brand-800"
            onClick={() => onChange(q)}
          >
            {q} m
          </button>
        ))}
      </div>
    </div>
  )
}
