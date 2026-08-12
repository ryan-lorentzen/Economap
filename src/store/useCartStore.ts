import { create } from 'zustand';
import { CartItem, Product } from '@/types';

const MAX_CART_ITEM_QUANTITY = 99;

interface CartState {
  items: CartItem[];
  addItem: (item: Product) => void;
  removeItem: (id: string) => void;
  updateItemQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  getGas: boolean;
  toggleGetGas: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  getGas: false,
  addItem: (item) => set((state) => {
    const existingItem = state.items.find((cartItem) => cartItem.product.id === item.id);

    if (existingItem) {
      return state;
    }

    return {
      items: [...state.items, { product: item, quantity: 1 }],
    };
  }),
  removeItem: (id) => set((state) => ({
    items: state.items.filter((item) => item.product.id !== id)
  })),
  updateItemQuantity: (id, quantity) => set((state) => {
    if (quantity <= 0) {
      return {
        items: state.items.filter((item) => item.product.id !== id),
      };
    }

    return {
      items: state.items.map((item) =>
        item.product.id === id
          ? {
              ...item,
              quantity: Math.min(Math.max(quantity, 1), MAX_CART_ITEM_QUANTITY),
            }
          : item
      ),
    };
  }),
  clearCart: () => set({ items: [] }),
  toggleGetGas: () => set((state) => ({ getGas: !state.getGas })),
}));
