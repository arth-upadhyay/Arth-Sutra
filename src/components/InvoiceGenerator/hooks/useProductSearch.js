import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllProducts, saveProduct } from '../../../store';
import { toast } from '../components/../../Toast';

// ============================================================================
// FEFO helpers — pure functions, no React
// ============================================================================

function parseExpiry(exp) {
  if (!exp) return Infinity;
  const m = String(exp).trim().match(/^(\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return Infinity;
  const month = parseInt(m[1], 10);
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return Infinity;
  return year * 12 + month;
}

function isExpired(exp, now = new Date()) {
  const v = parseExpiry(exp);
  if (!isFinite(v)) return false;
  const nowVal = now.getFullYear() * 12 + (now.getMonth() + 1);
  return v < nowVal;
}

function usableBatches(product) {
  if (!Array.isArray(product?.batches)) return [];
  return product.batches
    .filter(b => b && b.batchNo && Number(b.quantity) > 0)
    .filter(b => !isExpired(b.expiry))
    .slice()
    .sort((a, b) => parseExpiry(a.expiry) - parseExpiry(b.expiry));
}

function allocateFefo(product, qty) {
  const need = Number(qty) || 0;
  if (need <= 0) return [];
  const batches = usableBatches(product);
  const total = batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
  if (total < need) return null;
  const alloc = [];
  let remaining = need;
  for (const b of batches) {
    if (remaining <= 0) break;
    const avail = Number(b.quantity) || 0;
    const take = Math.min(avail, remaining);
    if (take > 0) {
      alloc.push({ batchNo: b.batchNo, expiry: b.expiry || '', quantity: take });
      remaining -= take;
    }
  }
  return alloc;
}

// ============================================================================

export function useProductSearch({
  updateItem,
  setItems,
  items = [],
  countryTaxRates = [0, 5, 12, 18, 28],
  editingBill = null,
  lowStockThreshold = 5,
  lowStockAlertsEnabled = true,
} = {}) {
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState({ itemId: null, query: '' });

  const previouslyDeductedItems = useRef(
    editingBill && !editingBill._isDuplicate && !editingBill._convertToType
      ? JSON.parse(JSON.stringify(editingBill.data?.items || []))
      : [],
  );

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

  useEffect(() => {
    getAllProducts().then(setProducts).catch(() => {});
  }, []);

  const refreshProducts = useCallback(() => {
    return getAllProducts().then(setProducts).catch(() => {});
  }, []);

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

  const selectProduct = useCallback((itemId, product) => {
    const salePrice = Number(product.sellingPrice ?? product.rate ?? 0);
    const mrpValue = Number(product.mrp) > 0 ? Number(product.mrp) : salePrice;
    const omrpValue = Number(product.omrp) > 0 ? Number(product.omrp) : 0;

    const fefo = usableBatches(product)[0] || null;

    updateItem?.(itemId, 'name', product.name);
    updateItem?.(itemId, 'hsn', product.hsn || '');
    updateItem?.(itemId, 'rate', salePrice);
    updateItem?.(itemId, 'taxPercent', product.taxPercent ?? (countryTaxRates[countryTaxRates.length - 2] ?? 18));
    updateItem?.(itemId, 'productId', product.id);
    if (product.unit) updateItem?.(itemId, 'unit', product.unit);
    updateItem?.(itemId, 'mrp', mrpValue);
    updateItem?.(itemId, 'omrp', omrpValue);
    updateItem?.(itemId, 'pkg', product.pkg || '');
    if (fefo) {
      updateItem?.(itemId, 'batch', fefo.batchNo);
      updateItem?.(itemId, 'expiry', fefo.expiry);
    }

    setProductSearch({ itemId: null, query: '' });
  }, [updateItem, countryTaxRates]);

  const rebalanceBatches = useCallback((itemId) => {
    if (!setItems) return;

    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const item = items[idx];
    if (!item?.name) return;

    let product = item.productId ? products.find(p => p.id === item.productId) : null;
    if (!product) {
      const lname = item.name.trim().toLowerCase();
      product = products.find(p => (p.name || '').trim().toLowerCase() === lname);
    }
    if (!product) return;
    if (!Array.isArray(product.batches) || product.batches.length === 0) return;

    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;

    const alloc = allocateFefo(product, qty);
    if (!alloc) {
      const total = usableBatches(product).reduce((s, b) => s + (Number(b.quantity) || 0), 0);
      toast(`Not enough stock of "${product.name}". Available: ${total}, needed: ${qty}.`, 'error');
      return;
    }

    if (alloc.length === 1) {
      const b = alloc[0];
      if (item.batch === b.batchNo && item.expiry === b.expiry) return;
      if (item.batch !== b.batchNo) updateItem?.(itemId, 'batch', b.batchNo);
      if (item.expiry !== b.expiry) updateItem?.(itemId, 'expiry', b.expiry);
      return;
    }

    const newRows = alloc.map((a, i) => ({
      ...item,
      id: i === 0 ? item.id : `split_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      batch: a.batchNo,
      expiry: a.expiry,
      quantity: a.quantity,
    }));

    setItems([
      ...items.slice(0, idx),
      ...newRows,
      ...items.slice(idx + 1),
    ]);
    toast(`Split into ${alloc.length} batches (FEFO).`, 'info');
  }, [items, products, updateItem, setItems]);

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

      const resolveProduct = (itemName, providedId) => {
        if (providedId && byId.has(providedId)) return byId.get(providedId);
        const searchName = (itemName || '').trim().toLowerCase();
        const matchedOld = previouslyDeductedItems.current.find(
          o => (o.name || '').trim().toLowerCase() === searchName && o.productId);
        if (matchedOld && byId.has(matchedOld.productId)) return byId.get(matchedOld.productId);
        return byName.get(searchName);
      };

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

      for (const it of currentItems.filter(x => x.name)) {
        const qty = Number(it.quantity) || 0;
        const existing = resolveProduct(it.name, it.productId);
        if (!existing) continue;
        const wProd = getWorkingProd(existing);
        if (!Array.isArray(wProd.batches)) wProd.batches = [];

        if (Number(it.mrp) > 0) wProd.mrp = Number(it.mrp);
        if (Number(it.omrp) > 0) wProd.omrp = Number(it.omrp);
        if (it.pkg && String(it.pkg).trim()) wProd.pkg = String(it.pkg).trim();

        wProd.stock = (Number(wProd.stock) || 0) - qty;
        if (lowStockAlertsEnabled && wProd.stock <= lowStockThreshold) {
          lowStockWarnings.push(`${wProd.name} total stock is running low!`);
        }

        const targetBatch = String(it.batch || '').trim();
        if (targetBatch) {
          const bIdx = wProd.batches.findIndex(
            b => String(b.batchNo || '').trim().toLowerCase() === targetBatch.toLowerCase());
          if (bIdx >= 0) {
            wProd.batches[bIdx].quantity = (Number(wProd.batches[bIdx].quantity) || 0) - qty;
            if (lowStockAlertsEnabled && wProd.batches[bIdx].quantity <= lowStockThreshold) {
              lowStockWarnings.push(`${wProd.name} (Batch ${targetBatch}) is running low!`);
            }
          } else {
            wProd.batches.push({ batchNo: targetBatch, expiry: it.expiry || '', quantity: -qty });
          }
        }
      }

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
  }, [lowStockThreshold, lowStockAlertsEnabled]);

  const resetBaseline = useCallback((items) => {
    previouslyDeductedItems.current = JSON.parse(JSON.stringify(items || []));
  }, []);

  return {
    products,
    refreshProducts,
    productSearch,
    setProductSearch,
    onNameTyped,
    getSuggestions,
    selectProduct,
    clearSearch,
    syncStock,
    resetBaseline,
    previouslyDeductedItems,
    rebalanceBatches,
    usableBatchesFor: usableBatches,
    allocateFefoFor: allocateFefo,
  };
}

export default useProductSearch;