import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, clearToken, setToken } from './api'
import { db, seedLocalIfEmpty } from './db'
import { passwordHash } from './lib/ids'
import { pullSnapshot, startSyncLoop } from './sync'
import type { User } from './types'

type AuthCtx = {
  user: User | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)
const USER_KEY = 'laxmi-user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await seedLocalIfEmpty()
      const raw = localStorage.getItem(USER_KEY)
      if (raw) {
        try {
          setUser(JSON.parse(raw) as User)
          startSyncLoop()
          void pullSnapshot().catch(() => undefined)
        } catch {
          localStorage.removeItem(USER_KEY)
        }
      }
      setReady(true)
    })()
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      async login(username, password) {
        const u = username.trim().toLowerCase()
        try {
          const res = await api<{ token: string; user: User }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: u, password }),
          })
          setToken(res.token)
          const hash = await passwordHash(password)
          await db.users.put({ ...res.user, passwordHash: hash })
          localStorage.setItem(USER_KEY, JSON.stringify(res.user))
          setUser(res.user)
          startSyncLoop()
          await pullSnapshot().catch(() => undefined)
        } catch {
          const local = await db.users.where('username').equals(u).first()
          const hash = await passwordHash(password)
          if (!local || local.passwordHash !== hash) {
            throw new Error('Invalid username or password')
          }
          const pub: User = { id: local.id, username: local.username, role: local.role, name: local.name }
          localStorage.setItem(USER_KEY, JSON.stringify(pub))
          setUser(pub)
          startSyncLoop()
        }
      },
      logout() {
        clearToken()
        localStorage.removeItem(USER_KEY)
        setUser(null)
      },
    }),
    [user, ready],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('auth')
  return ctx
}
