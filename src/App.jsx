import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Outlet } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import { SupabaseAuthProvider } from '@/lib/SupabaseAuthContext';
import ScrollToTop from './components/ScrollToTop';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import ProtectedRoute from '@/components/ProtectedRoute';
import { CartProvider } from '@/lib/CartContext';
import Landing from './pages/Landing';
import CreateRestaurant from './pages/CreateRestaurant';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Checkout from './pages/Checkout';
import OrderTracking from './pages/OrderTracking';
import AppLayout from './components/AppLayout';
import GestaoProdutos from './pages/GestaoProdutos';
import Pedidos from './pages/Pedidos';
import Pdv from './pages/Pdv';
import Configuracoes from './pages/Configuracoes';
import Clientes from './pages/Clientes';
import Equipe from './pages/Equipe';
import Perfil from './pages/Perfil';
import Assinatura from './pages/Assinatura';
import Financeiro from './pages/Financeiro';
import Atualizacoes from './pages/Atualizacoes';
import MasterPlanos from './pages/MasterPlanos';

function App() {
  // FASE 5.1: SupabaseAuthProvider coexiste com o AuthProvider/Base44 legado.
  // Sem VITE_SUPABASE_* configurado, o provider Supabase fica neutro e o app
  // comporta-se exatamente como antes.
  return (
    <SupabaseAuthProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
            {/* Public routes — render immediately, zero auth dependency */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/criar-restaurante" element={<CreateRestaurant />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<CartProvider><Outlet /></CartProvider>}>
              <Route path="/cardapio/:slug" element={<Menu />} />
              <Route path="/checkout/:slug" element={<Checkout />} />
            </Route>
            <Route path="/acompanhar/:token" element={<OrderTracking />} />

            {/* Protected routes — ProtectedRoute is the SOLE auth gate */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/gestao-produtos" element={<GestaoProdutos />} />
                <Route path="/pedidos" element={<Pedidos />} />
                <Route path="/pdv" element={<Pdv />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
                <Route path="/clientes" element={<Clientes />} />
                <Route path="/equipe" element={<Equipe />} />
                <Route path="/perfil" element={<Perfil />} />
                <Route path="/assinatura" element={<Assinatura />} />
                <Route path="/financeiro" element={<Financeiro />} />
                <Route path="/atualizacoes" element={<Atualizacoes />} />
                <Route path="/master/planos" element={<MasterPlanos />} />
              </Route>
            </Route>

            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
    </SupabaseAuthProvider>
  )
}

export default App