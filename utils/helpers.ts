/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Shared HTTP helpers, slugify, pricing and order numbers
 * Edit Date: 2026-11-14
 */

import type { Response } from 'express';

/** Primary-key column preference for API `id` compatibility */
const PK_KEYS = [
  'userID',
  'productID',
  'orderID',
  'categoryID',
  'supplierID',
  'productTypeID',
  'productVariantID',
  'productImageID',
  'branchID',
  'warehouseID',
  'billingID',
  'cartItemID',
  'wishlistID',
  'orderItemID',
  'orderStatusHistoryID',
  'paymentGatewayID',
  'posPaymentID',
  'financeEntryID',
  'dropshipOrderID',
  'inventoryID',
  'stockMovementID',
  'roleID',
  'userRightID',
  'staffProfileID',
  'staffEducationID',
  'staffExperienceID',
  'staffDocumentID',
  'staffHistoryID',
] as const;

function hydrateId<T extends Record<string, any>>(row: T | null | undefined): T | null | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  if (row.id != null) return row;
  for (const key of PK_KEYS) {
    if (row[key] != null) {
      return { ...row, id: row[key] };
    }
  }
  return row;
}

function hydrateData(data: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === 'object' ? hydrateId(item as Record<string, any>) : item
      );
    } else if (value && typeof value === 'object') {
      out[key] = hydrateId(value as Record<string, any>);
    }
  }
  return out;
}

function slugify(text: unknown): string {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function orderNumber(): string {
  return 'GS' + Date.now().toString().slice(-10) + Math.floor(Math.random() * 90 + 10);
}

function effectivePrice(product: { sale_price?: unknown; price?: unknown }): number {
  return product.sale_price != null ? Number(product.sale_price) : Number(product.price);
}

function ok(res: Response, data: Record<string, unknown> = {}, message = 'OK', status = 200) {
  return res.status(status).json({ success: true, message, ...hydrateData(data) });
}

function fail(res: Response, message = 'Request failed', status = 400, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

export { slugify, orderNumber, effectivePrice, ok, fail, hydrateId };
