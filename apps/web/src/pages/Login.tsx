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
    <div className="flex min-h-full items-center justify-center bg-brand-800 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl bg-cream p-6 shadow-pos"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-gold-400">
            LF
          </div>
          <h1 className="text-xl font-bold text-brand-800">Laxmi Fashion Wholesale Mart</h1>
          <p className="text-sm text-slate-600">Store counter login</p>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <label className="mb-3 block text-sm font-medium">
          Username
          <input
            className="mt-1 min-h-[48px] w-full rounded-xl border border-brand-200 px-3"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="mb-4 block text-sm font-medium">
          Password
          <input
            type="password"
            className="mt-1 min-h-[48px] w-full rounded-xl border border-brand-200 px-3"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          disabled={busy}
          className="min-h-[48px] w-full rounded-xl bg-brand-600 font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-4 text-center text-xs text-slate-500">
          Owner: owner / owner123 · Cashier: cashier / cashier123
        </p>
      </form>
    </div>
  )
}
