
import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllProducts, saveProduct } from '../../../store';
import { toast } from '../components/../../Toast';

export function useProductSearch({
  updateItem,                          // (itemId, field, value) — from useInvoiceForm
  countryTaxRates = [0, 5, 12, 18, 28],
  editingBill = null,
  lowStockThreshold = 5,               // monolith hardcodes 5; store.js stockAlertSettings default agrees
} = {}) {
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState({ itemId: null, query: '' });

  // ---- Baseline of already-deducted quantities -----------------------------------
  const previouslyDeductedItems = useRef(
    editingBill && !editingBill._isDuplicate && !editingBill._convertToType
      ? JSON.parse(JSON.stringify(editingBill.data?.items || []))
      : [],
  );

  // Re-seed the baseline when a DIFFERENT bill is loaded into the form.
  const lastEditingBillId = useRef(null);
  useEffect(() => {
    const currentId = editingBill?.id || null;
    if (lastEditingBillId.current !== currentId) {
      lastEditingBillId.current = currentId;
      previouslyDeductedItems.current =
        editingBill && !editingBill._isDuplicate && !editingBill._convertToType
          ? JSON.parse(JSON.stringify(editingBill.data?.items || []))
          : [];
    }
  }, [editingBill]);

  // ---- Catalog ---------------------------------------------------------------------
  useEffect(() => {
    getAllProducts().then(setProducts).catch(() => {});
  }, []);

  const refreshProducts = useCallback(() => {
    return getAllProducts().then(setProducts).catch(() => {});
  }, []);

  // ---- Autocomplete ------------------------------------------------------------------
  // Call from the line-item name input's onChange — updates the form line AND
  // opens the suggestion query for that row in one step.
  const onNameTyped = useCallback((itemId, value) => {
    updateItem?.(itemId, 'name', value);
    setProductSearch({ itemId, query: value });
  }, [updateItem]);

  const clearSearch = useCallback(() => {
    setProductSearch({ itemId: null, query: '' });
  }, []);

  const getSuggestions = useCallback((itemId) => {
    if (productSearch.itemId !== itemId || !productSearch.query.trim()) return [];
    const q = productSearch.query.toLowerCase();
    return products
      .filter(p => p.name?.toLowerCase().includes(q) || p.hsn?.toLowerCase().includes(q))
      .slice(0, 5);
  }, [productSearch.itemId, productSearch.query, products]);

  // Fill a line from a picked product. Default tax = second-highest configured
  // slab (18% for India), matching the monolith's addItem default.
  const selectProduct = useCallback((itemId, product) => {
    const salePrice = product.sellingPrice ?? product.rate ?? 0;
    updateItem?.(itemId, 'name', product.name);
    ['hsn', 'rate', 'unit', 'taxPercent', 'productId'].forEach(() => {});
    // Single batched update through updateItem per field keeps useInvoiceForm
    // agnostic of product shape.
    updateItem?.(itemId, 'hsn', product.hsn || '');
    updateItem?.(itemId, 'rate', salePrice);
    updateItem?.(itemId, 'taxPercent', product.taxPercent ?? (countryTaxRates[countryTaxRates.length - 2] ?? 18));
    updateItem?.(itemId, 'productId', product.id);
    if (product.unit) updateItem?.(itemId, 'unit', product.unit);
    setProductSearch({ itemId: null, query: '' });
  }, [updateItem, countryTaxRates]);

  // ---- Stock deduction ledger ---------------------------------------------------------
  /**
   * Revert-then-apply stock sync. Errors are contained (warn + return) — a
   * stock failure must never fail the invoice save itself.
   * @returns {{ warnings: string[], error?: Error }}
   */
  const syncStock = useCallback(async (currentItems) => {
    try {
      const currentProducts = await getAllProducts();
      const byId = new Map(currentProducts.map(p => [p.id, p]));
      const byName = new Map(currentProducts.map(p => [(p.name || '').trim().toLowerCase(), p]));
      const modifiedProducts = new Map();
      const lowStockWarnings = [];

      const getWorkingProd = (prod) => {
        if (!modifiedProducts.has(prod.id)) {
          modifiedProducts.set(prod.id, JSON.parse(JSON.stringify(prod)));
        }
        return modifiedProducts.get(prod.id);
      };

      // Smart lookup: a hand-typed name steals the hidden productId recorded in
      // the previous baseline for the same name before falling back to name match.
      const resolveProduct = (itemName, providedId) => {
        if (providedId && byId.has(providedId)) return byId.get(providedId);
        const searchName = (itemName || '').trim().toLowerCase();
        const matchedOld = previouslyDeductedItems.current.find(
          o => (o.name || '').trim().toLowerCase() === searchName && o.productId);
        if (matchedOld && byId.has(matchedOld.productId)) return byId.get(matchedOld.productId);
        return byName.get(searchName);
      };

      // 1. REVERT — add back the previous save state.
      for (const oldItem of previouslyDeductedItems.current) {
        const existing = resolveProduct(oldItem.name, oldItem.productId);
        if (!existing) continue;
        const wProd = getWorkingProd(existing);
        if (!Array.isArray(wProd.batches)) wProd.batches = [];

        const qty = Number(oldItem.quantity) || 0;
        wProd.stock = (Number(wProd.stock) || 0) + qty;

        const targetBatch = String(oldItem.batch || '').trim();
        if (targetBatch) {
          const bIdx = wProd.batches.findIndex(
            b => String(b.batchNo || '').trim().toLowerCase() === targetBatch.toLowerCase());
          if (bIdx >= 0) wProd.batches[bIdx].quantity = (Number(wProd.batches[bIdx].quantity) || 0) + qty;
          else wProd.batches.push({ batchNo: targetBatch, expiry: oldItem.expiry || '', quantity: qty });
        }
      }

      // 2. APPLY — subtract the current screen state.
      for (const it of currentItems.filter(x => x.name)) {
        const qty = Number(it.quantity) || 0;
        const existing = resolveProduct(it.name, it.productId);
        if (!existing) continue;
        const wProd = getWorkingProd(existing);
        if (!Array.isArray(wProd.batches)) wProd.batches = [];

        wProd.stock = (Number(wProd.stock) || 0) - qty;
        if (wProd.stock <= lowStockThreshold) {
          lowStockWarnings.push(`${wProd.name} total stock is running low!`);
        }

        const targetBatch = String(it.batch || '').trim();
        if (targetBatch) {
          const bIdx = wProd.batches.findIndex(
            b => String(b.batchNo || '').trim().toLowerCase() === targetBatch.toLowerCase());
          if (bIdx >= 0) {
            wProd.batches[bIdx].quantity = (Number(wProd.batches[bIdx].quantity) || 0) - qty;
            if (wProd.batches[bIdx].quantity <= lowStockThreshold) {
              lowStockWarnings.push(`${wProd.name} (Batch ${targetBatch}) is running low!`);
            }
          } else {
            wProd.batches.push({ batchNo: targetBatch, expiry: it.expiry || '', quantity: -qty });
          }
        }
      }

      // 3. SAVE — prune empty batches, upsert touched products, lock the baseline.
      const upserts = [];
      for (const prod of modifiedProducts.values()) {
        if (Array.isArray(prod.batches)) {
          prod.batches = prod.batches.filter(b => b.quantity !== 0);
        }
        upserts.push(saveProduct(prod));
      }
      await Promise.all(upserts);

      previouslyDeductedItems.current = JSON.parse(JSON.stringify(currentItems));

      const refreshed = await getAllProducts();
      setProducts(refreshed);

      const uniqueWarnings = [...new Set(lowStockWarnings)];
      for (const warning of uniqueWarnings) toast(warning, 'warning');

      return { warnings: uniqueWarnings };
    } catch (e) {
      console.warn('Inventory deduction failed:', e);
      return { warnings: [], error: e };
    }
  }, [lowStockThreshold]);

  // Manually re-baseline (e.g. after discarding an edit without saving).
  const resetBaseline = useCallback((items) => {
    previouslyDeductedItems.current = JSON.parse(JSON.stringify(items || []));
  }, []);

  return {
    // catalog
    products,
    refreshProducts,
    // autocomplete
    productSearch,
    setProductSearch,
    onNameTyped,
    getSuggestions,
    selectProduct,
    clearSearch,
    // stock ledger
    syncStock,
    resetBaseline,
    previouslyDeductedItems,
  };
}

export default useProductSearch;