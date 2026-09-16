import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  ClipboardList,
  LogOut,
  Package,
  RotateCcw,
  Settings,
  ShoppingBag,
  Truck,
  Warehouse,
} from 'lucide-react'
import { useAuth } from '../auth'
import { SyncBadge } from './SyncBadge'

const items = [
  { to: '/', label: 'POS', icon: ShoppingBag, end: true, roles: ['owner', 'cashier'] },
  { to: '/inventory', label: 'Stock', icon: Warehouse, roles: ['owner', 'cashier'] },
  { to: '/purchases', label: 'Purchase', icon: ClipboardList, roles: ['owner'] },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, roles: ['owner'] },
  { to: '/returns', label: 'Returns', icon: RotateCcw, roles: ['owner', 'cashier'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['owner'] },
]

export function Layout() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const role = user?.role || 'cashier'
  const visible = items.filter((i) => i.roles.includes(role))

  return (
    <div className="flex min-h-full flex-col bg-cream md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col bg-gradient-to-b from-brand-800 to-brand-900 text-white md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold text-gold-400 ring-1 ring-white/15">
            LF
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-400/90">
            Wholesale Mart
          </div>
          <div className="mt-0.5 text-lg font-bold leading-tight tracking-tight">Laxmi Fashion</div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {visible.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-white text-brand-800 shadow-soft'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <i.icon className="h-4 w-4 shrink-0 opacity-90" />
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl bg-white/5 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user?.name}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
                {user?.role}
              </div>
            </div>
            <SyncBadge compact />
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            onClick={() => {
              logout()
              nav('/login')
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-brand-100/80 bg-white/90 px-3 py-2.5 backdrop-blur-md md:px-6">
          <div className="md:hidden">
            <div className="text-sm font-bold tracking-tight text-brand-700">Laxmi Fashion</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gold-600">
              Wholesale Mart
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-brand-800">Counter</div>
              <div className="text-[11px] text-slate-500">Store floor</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-cream px-2.5 py-1 text-xs font-medium text-slate-600 sm:inline">
              {user?.name}
            </span>
            <SyncBadge />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-3 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-30 flex overflow-x-auto border-t border-brand-100/80 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {visible.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) =>
              `flex min-w-[68px] flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
                isActive ? 'text-brand-700' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-2xl transition ${
                    isActive ? 'bg-brand-50 text-brand-700 shadow-soft' : 'text-slate-400'
                  }`}
                >
                  <i.icon className="h-5 w-5" />
                </span>
                {i.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
