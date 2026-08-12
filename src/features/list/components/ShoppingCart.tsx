'use client';

import { useCartStore } from '@/store/useCartStore';

import React from 'react';

export const ShoppingCart = () => {
  const { items, removeItem, updateItemQuantity, clearCart } = useCartStore();

  return (
    <div className="mt-8 w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur animate-slide-in-right md:p-6">
      <h2 className="mb-4 text-2xl font-semibold text-slate-900">Shopping Cart</h2>
      {items.length === 0 ? (
        <p className="text-base text-slate-700 md:text-lg">Your cart is empty. Add some products.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.product.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="block text-base font-medium text-slate-800 md:text-lg">{item.product.name}</span>
                  <span className="text-sm text-slate-500">{item.product.brand}</span>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    Qty
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={item.quantity}
                      onChange={(event) => updateItemQuantity(item.product.id, Number(event.target.value))}
                      className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                  <button
                    onClick={() => removeItem(item.product.id)}
                    className="rounded-full border border-rose-200 bg-white px-3 py-1 text-sm font-semibold text-rose-600 shadow-sm transition-colors duration-200 ease-in-out hover:bg-rose-50 hover:text-rose-700"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button 
            onClick={clearCart}
            className="mt-6 w-full rounded-full bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground shadow-[0_12px_30px_-12px_rgba(37,99,235,0.8)] ring-1 ring-blue-200/70 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-blue-600"
          >
            Clear Cart
          </button>
        </>
      )}
    </div>
  );
};
