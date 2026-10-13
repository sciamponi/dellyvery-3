import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [companySlug, setCompanySlug] = useState(null);
  const [company, setCompanyData] = useState(null);

  // Load cart from localStorage when slug changes
  useEffect(() => {
    if (!companySlug) return;
    const stored = localStorage.getItem(`cart_${companySlug}`);
    if (stored) {
      try { setItems(JSON.parse(stored)); } catch (e) { setItems([]); }
    } else {
      setItems([]);
    }
  }, [companySlug]);

  // Save cart to localStorage on change
  useEffect(() => {
    if (!companySlug) return;
    localStorage.setItem(`cart_${companySlug}`, JSON.stringify(items));
  }, [items, companySlug]);

  const setCartCompany = useCallback((comp) => {
    setCompanySlug(comp.slug);
    setCompanyData(comp);
  }, []);

  const calcLineTotal = (unitPrice, quantity, complements) => {
    const complementsTotal = (complements || []).reduce((sum, c) => sum + (c.price * c.quantity), 0);
    return unitPrice * quantity + complementsTotal;
  };

  const addItem = useCallback((product, quantity, complements, notes, config) => {
    const normConfig = config && Array.isArray(config.steps) && config.steps.length > 0 ? config : undefined;
    setItems(prev => {
      // Check if identical item already exists (same product + same complements + same notes + same V2 config)
      const existingIndex = prev.findIndex(item =>
        item.product_id === product.id &&
        JSON.stringify(item.complements || []) === JSON.stringify(complements || []) &&
        (item.notes || '') === (notes || '') &&
        JSON.stringify(item.config || null) === JSON.stringify(normConfig || null)
      );

      if (existingIndex >= 0) {
        const newItems = [...prev];
        newItems[existingIndex].quantity += quantity;
        newItems[existingIndex].line_total = calcLineTotal(
          newItems[existingIndex].unit_price,
          newItems[existingIndex].quantity,
          newItems[existingIndex].complements
        );
        return newItems;
      }

      const unitPrice = product.promotional_price != null ? product.promotional_price : product.price;
      return [...prev, {
        id: `${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        product_id: product.id,
        name: product.name,
        unit_price: unitPrice,
        quantity,
        complements: complements || [],
        notes: notes || '',
        ...(normConfig ? { config: normConfig } : {}),
        image_url: product.image_url,
        line_total: calcLineTotal(unitPrice, quantity, complements)
      }];
    });
  }, []);

  const updateItemQuantity = useCallback((itemId, quantity) => {
    if (quantity < 1) return;
    setItems(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, quantity, line_total: calcLineTotal(item.unit_price, quantity, item.complements) }
        : item
    ));
  }, []);

  const removeItem = useCallback((itemId) => {
    setItems(prev => prev.filter(item => item.id !== itemId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const getTotalItems = useCallback(() => {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }, [items]);

  const getSubtotal = useCallback(() => {
    return items.reduce((sum, item) => sum + item.line_total, 0);
  }, [items]);

  return (
    <CartContext.Provider value={{
      items, company, companySlug,
      setCartCompany, addItem, updateItemQuantity, removeItem, clearCart,
      getTotalItems, getSubtotal
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}