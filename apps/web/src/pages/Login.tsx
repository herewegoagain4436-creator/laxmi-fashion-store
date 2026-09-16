import { FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const { user, login } = useAuth()
  const [username, setUsername] = useState('owner')
  const [password, setPassword] = useState('owner123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-brand-900 p-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-20 -right-16 h-80 w-80 rounded-full bg-gold-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.06),_transparent_55%)]" />
      </div>

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-cream-50 p-7 shadow-lift"
      >
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-700 text-2xl font-bold text-gold-400 shadow-card ring-4 ring-brand-100">
            LF
          </div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-600">
            Wholesale Mart
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-brand-800">Laxmi Fashion</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in to the store counter</p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <label className="mb-3 block">
          <span className="lf-label">Username</span>
          <input
            className="lf-input"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="mb-5 block">
          <span className="lf-label">Password</span>
          <input
            type="password"
            className="lf-input"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button disabled={busy} className="lf-btn-primary w-full min-h-[48px] text-base">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
          Owner: <span className="font-medium text-slate-600">owner / owner123</span>
          <br />
          Cashier: <span className="font-medium text-slate-600">cashier / cashier123</span>
        </p>
      </form>
    </div>
  )
}
