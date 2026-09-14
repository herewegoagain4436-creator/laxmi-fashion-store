import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { Inventory } from './pages/Inventory'
import { Login } from './pages/Login'
import { POS } from './pages/POS'
import { Purchases } from './pages/Purchases'
import { Reports } from './pages/Reports'
import { Returns } from './pages/Returns'
import { Settings } from './pages/Settings'
import { Suppliers } from './pages/Suppliers'

function Guard({ children, owner }: { children: ReactElement; owner?: boolean }) {
  const { user, ready } = useAuth()
  if (!ready) return <div className="p-8 text-center text-slate-500">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (owner && user.role !== 'owner') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route index element={<POS />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="purchases" element={<Guard owner><Purchases /></Guard>} />
        <Route path="suppliers" element={<Guard owner><Suppliers /></Guard>} />
        <Route path="returns" element={<Returns />} />
        <Route path="reports" element={<Guard owner><Reports /></Guard>} />
        <Route path="settings" element={<Guard owner><Settings /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
