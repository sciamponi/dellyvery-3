import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/api/supabaseClient';
import { getStorefrontBySlug } from '@/api/storefront';
import { useCart } from '@/lib/CartContext';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { ShoppingCart, Phone, MapPin, Clock, ArrowLeft, Package, Plus } from 'lucide-react';
import ProductModal from '@/components/menu/ProductModal';
import CartDrawer from '@/components/menu/CartDrawer';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export default function Menu() {
  const { slug } = useParams();
  const { setCartCompany, addItem, getTotalItems, getSubtotal } = useCart();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [notFound, setNotFound] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  // Cardápio público Supabase-only via RPC pública (sem SELECT anon direto).
  useEffect(() => {
    const load = async () => {
      try {
        if (!isSupabaseConfigured()) {
          setNotFound(true);
          return;
        }
        const storefront = await getStorefrontBySlug(supabase, slug);
        const comp = storefront.company;
        setCartCompany(comp);
        setCompany(comp);
        setCategories(storefront.categories || []);
        setProducts(storefront.products || []);
        setActiveCategory('all');
      } catch (err) {
        if (err?.code === 'NOT_FOUND') setNotFound(true);
        else console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-bold text-foreground">Restaurante não encontrado</h1>
          <p className="text-muted-foreground mt-2">O cardápio que você procura não existe.</p>
          <Button asChild className="mt-4 bg-primary hover:bg-primary/90">
            <Link to="/">Voltar ao início</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!company) return null;

  const primaryColor = company.primary_color || '#DC2626';
  const filteredProducts = (!activeCategory || activeCategory === 'all')
    ? products
    : products.filter(p => p.category_id === activeCategory);

  return (
    <div className="min-h-screen bg-background">
      {/* Banner */}
      <div className="relative h-48 sm:h-64 overflow-hidden" style={{ backgroundColor: primaryColor }}>
        {company.logo_url && (
          <Image src={company.logo_url} fittingType="fill" className="absolute inset-0 w-full h-full opacity-20" alt={company.name} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="relative mx-auto max-w-4xl px-4 h-full flex flex-col justify-end pb-6">
          <Button asChild variant="ghost" size="sm" className="self-start text-white hover:text-white hover:bg-white/20 mb-auto mt-4">
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> Painel</Link>
          </Button>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white">{company.name}</h1>
          {company.slogan && <p className="text-white/90 mt-1">{company.slogan}</p>}
        </div>
      </div>

      {/* Info bar */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className={`flex items-center gap-1.5 font-medium ${company.is_open ? 'text-green-600' : 'text-red-600'}`}>
            <span className={`h-2 w-2 rounded-full ${company.is_open ? 'bg-green-500' : 'bg-red-500'}`} />
            {company.is_open ? 'Aberto agora' : 'Fechado'}
          </span>
          {company.phone && <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" /> {company.phone}</span>}
          {company.estimated_delivery_time > 0 && (
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> ~{company.estimated_delivery_time} min</span>
          )}
          {company.address && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {company.address}</span>}
        </div>
      </div>

      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="border-b border-border bg-card overflow-x-auto">
          <div className="mx-auto max-w-4xl px-4 flex gap-2 py-3">
            <button
              onClick={() => setActiveCategory('all')}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeCategory === 'all' ? 'text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
              style={activeCategory === 'all' ? { backgroundColor: primaryColor } : {}}
            >
              🍽️ Todos
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                title={cat.name}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeCategory === cat.id ? 'text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
                style={activeCategory === cat.id ? { backgroundColor: primaryColor } : {}}
              >
                {cat.icon ? `${cat.icon} ` : '🏷️ '}{cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Products */}
      <div className="mx-auto max-w-4xl px-4 py-8">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-16">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="font-heading text-lg font-semibold text-foreground">Nenhum produto disponível</h2>
            <p className="text-sm text-muted-foreground mt-1">O cardápio ainda está sendo montado.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredProducts.map(product => {
              const cat = categories.find(c => c.id === product.category_id);
              return (
              <button
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className="flex gap-4 rounded-2xl border border-border bg-card p-4 hover:shadow-md transition-shadow text-left"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading font-semibold text-foreground">{product.name}</h3>
                  {cat && <p className="text-xs text-muted-foreground mt-0.5 truncate">{cat.icon ? `${cat.icon} ` : ''}{cat.name}</p>}
                  {product.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <p className="font-heading text-lg font-bold" style={{ color: primaryColor }}>
                      {fmtCurrency(product.promotional_price ?? product.price)}
                    </p>
                    {product.promotional_price != null && product.promotional_price < product.price && (
                      <p className="text-xs text-muted-foreground line-through">{fmtCurrency(product.price)}</p>
                    )}
                  </div>
                </div>
                <div className="relative shrink-0">
                  {product.image_url ? (
                    <Image src={product.image_url} fittingType="fill" className="h-24 w-24 rounded-xl" alt={product.name} />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted">
                      <Package className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div
                    className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <Plus className="h-4 w-4" />
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card mt-8">
        <div className="mx-auto max-w-4xl px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">{company.name}</p>
          <p className="text-xs text-muted-foreground mt-1">Pedidos online • Controle completo</p>
          <p className="text-xs text-muted-foreground mt-2">Powered by DELLYVERY — Automatiza</p>
        </div>
      </footer>

      {/* Floating cart button */}
      {getTotalItems() > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-4 right-4 z-20 flex items-center gap-2 rounded-full px-5 py-3 text-white shadow-lg transition-transform hover:scale-105"
          style={{ backgroundColor: primaryColor }}
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-medium">{getTotalItems()} {getTotalItems() === 1 ? 'item' : 'itens'}</span>
          <span className="font-heading font-bold">{fmtCurrency(getSubtotal())}</span>
        </button>
      )}

      {/* Product modal */}
      <ProductModal
        product={selectedProduct}
        primaryColor={primaryColor}
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        onAddToCart={addItem}
      />

      {/* Cart drawer */}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}