import { describe, it, expect } from 'vitest';
import { db, bills, clients, products, meta } from '../db/index.js';
import { eq } from 'drizzle-orm';

describe('SQLite & Drizzle Storage Layer', () => {
  it('queries active bills from SQLite database', () => {
    const activeBills = db.select().from(bills).where(eq(bills.isTrashed, false)).all();
    expect(activeBills.length).toBeGreaterThan(0);
    expect(activeBills[0]).toHaveProperty('id');
    expect(activeBills[0]).toHaveProperty('data');
  });

  it('queries products from SQLite database', () => {
    const allProducts = db.select().from(products).all();
    expect(allProducts.length).toBe(15);
    expect(allProducts[0]).toHaveProperty('name');
    expect(allProducts[0]).toHaveProperty('stock');
  });

  it('supports ACID transactions on the database', () => {
    const testKey = 'acid_test_' + Date.now();
    db.transaction((tx) => {
      tx.insert(meta).values({ key: testKey, value: 'test_val' }).run();
      const readBack = tx.select().from(meta).where(eq(meta.key, testKey)).get();
      expect(readBack?.value).toBe('test_val');
      tx.delete(meta).where(eq(meta.key, testKey)).run();
    });

    const verifyDeleted = db.select().from(meta).where(eq(meta.key, testKey)).get();
    expect(verifyDeleted).toBeUndefined();
  });
});
