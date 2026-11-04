import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, Outlet, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import { SupabaseAuthProvider } from '@/lib/SupabaseAuthContext';
import ScrollToTop from './components/ScrollToTop';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import ProtectedRoute from '@/components/ProtectedRoute';
import CompanyAccessRoute from '@/components/CompanyAccessRoute';
import MasterRoute from '@/components/MasterRoute';
import ResellerRoute from '@/components/ResellerRoute';
import { CartProvider } from '@/lib/CartContext';
import Landing from './pages/Landing';
import Planos from './pages/Planos';
import CreateRestaurant from './pages/CreateRestaurant';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Checkout from './pages/Checkout';
import OrderTracking from './pages/OrderTracking';
import AppLayout from './components/AppLayout';
import MasterRevendaLayout from './components/MasterRevendaLayout';
import GestaoProdutos from './pages/GestaoProdutos';
import Pedidos from './pages/Pedidos';
import Pdv from './pages/Pdv';
import Mesas from './pages/Mesas';
import Impressao from './pages/Impressao';
import Configuracoes from './pages/Configuracoes';
import Clientes from './pages/Clientes';
import Equipe from './pages/Equipe';
import Perfil from './pages/Perfil';
import Assinatura from './pages/Assinatura';
import Financeiro from './pages/Financeiro';
import Atualizacoes from './pages/Atualizacoes';
import MasterPlanos from './pages/MasterPlanos';
import MasterInteressados from './pages/MasterInteressados';
import MasterContratos from './pages/MasterContratos';
import MasterDashboard from './pages/MasterDashboard';
import MasterEmpresas from './pages/MasterEmpresas';
import MasterRevenda from './pages/MasterRevenda';
import MasterRevendaCreditos from './pages/MasterRevendaCreditos';
import MasterCompras from './pages/MasterCompras';
import ResellerDashboard from './pages/ResellerDashboard';
import ResellerClientes from './pages/ResellerClientes';
import ResellerCreditos from './pages/ResellerCreditos';
import ResellerAtivacoes from './pages/ResellerAtivacoes';
import ConviteCliente from './pages/ConviteCliente';
import AguardandoAtivacao from './pages/AguardandoAtivacao';
import AcessoExpirado from './pages/AcessoExpirado';
import Cadastro from './pages/Cadastro';
import Privacidade from './pages/Privacidade';

function LegacyMasterComprasRedirect() {
  const location = useLocation();
  return <Navigate to={`/master/revenda/compras${location.search}`} replace />;
}

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
            <Route path="/planos" element={<Planos />} />
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
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/convite-cliente/:token" element={<ConviteCliente />} />
            <Route path="/privacidade" element={<Privacidade />} />

            {/* Protected routes �?" ProtectedRoute is the SOLE auth gate */}
            <Route element={<ProtectedRoute />}>
              <Route path="/aguardando-ativacao" element={<AguardandoAtivacao />} />
              <Route path="/acesso-expirado" element={<AcessoExpirado />} />
              <Route element={<CompanyAccessRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/gestao-produtos" element={<GestaoProdutos />} />
                  <Route path="/pedidos" element={<Pedidos />} />
                  <Route path="/pdv" element={<Pdv />} />
                  <Route path="/mesas" element={<Mesas />} />
                  <Route path="/impressao/:orderId" element={<Impressao />} />
                  <Route path="/configuracoes" element={<Configuracoes />} />
                  <Route path="/clientes" element={<Clientes />} />
                  <Route path="/equipe" element={<Equipe />} />
                  <Route path="/perfil" element={<Perfil />} />
                  <Route path="/assinatura" element={<Assinatura />} />
                  <Route path="/financeiro" element={<Financeiro />} />
                  <Route path="/atualizacoes" element={<Atualizacoes />} />
                </Route>
              </Route>
            </Route>


            {/* Área administrativa — gate próprio (sessão + PLATFORM_ADMIN) */}
            <Route element={<MasterRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/master" element={<MasterDashboard />} />
                <Route path="/master/empresas" element={<MasterEmpresas />} />
                <Route path="/master/planos" element={<MasterPlanos />} />
                <Route path="/master/compras" element={<LegacyMasterComprasRedirect />} />
                <Route path="/master/interessados" element={<MasterInteressados />} />
                <Route path="/master/contratos" element={<MasterContratos />} />
                <Route element={<MasterRevendaLayout />}>
                  <Route path="/master/revenda" element={<MasterRevenda />} />
                  <Route path="/master/revenda/creditos" element={<MasterRevendaCreditos />} />
                  <Route path="/master/revenda/compras" element={<MasterCompras />} />
                </Route>
              </Route>
            </Route>

            {/* Área do revendedor — gate próprio (sessão + vínculo ativo) */}
            <Route element={<ResellerRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/revenda" element={<ResellerDashboard />} />
                <Route path="/revenda/clientes" element={<ResellerClientes />} />
                <Route path="/revenda/creditos" element={<ResellerCreditos />} />
                <Route path="/revenda/ativacoes" element={<ResellerAtivacoes />} />
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