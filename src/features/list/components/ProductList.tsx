'use client';

import { getAvailableProducts } from '@/lib/dataSource';
import { useCartStore } from '@/store/useCartStore';

export const ProductList = () => {
  const { items, addItem } = useCartStore();
  const products = getAvailableProducts();

  return (
    <div className="mt-8 w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg backdrop-blur md:p-6">
      <h2 className="mb-4 text-2xl font-semibold text-slate-900">Available Products</h2>
      <div className="grid grid-cols-1 gap-3">
        {products.map((product) => {
          const existingItem = items.find((item) => item.product.id === product.id);
          const isInCart = Boolean(existingItem);

          return (
            <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition-colors duration-200 ease-in-out hover:bg-slate-100">
              <span className="min-w-0 text-base text-slate-800 md:text-lg">{product.name} (<span className="text-slate-500">{product.brand}</span>)</span>
              <button
                onClick={() => addItem(product)}
                disabled={isInCart}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ring-1 transition-all duration-300 ease-in-out ${
                  isInCart
                    ? 'cursor-not-allowed bg-slate-200 text-slate-500 ring-slate-200'
                    : 'bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgba(13,148,136,0.85)] ring-emerald-200/70 hover:scale-[1.02] hover:bg-emerald-700'
                }`}
              >
                {isInCart ? `In Cart (${existingItem?.quantity})` : 'Add to Cart'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
