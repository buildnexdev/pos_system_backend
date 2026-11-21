/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Inventory stock queries, movements and reports
 * Edit Date: 2026-11-12
 */

import db from '../config/db';

function computeStockStatus(stock, minStock) {
  const qty = Number(stock) || 0;
  const min = Number(minStock);
  const threshold = Number.isFinite(min) && min >= 0 ? min : 10;
  if (qty <= 0) return 'out_of_stock';
  if (qty <= threshold) return 'low_stock';
  return 'in_stock';
}

function computeInventoryStatus(row) {
  if (Number(row.damaged_qty) > 0 && Number(row.available_qty) <= 0) return 'damaged';
  if (Number(row.reserved_qty) > 0 && Number(row.available_qty) <= 0) return 'reserved';
  return computeStockStatus(row.available_qty, row.min_stock);
}

async function getExecutor(connection) {
  return connection || db;
}

/** Normalize tbl* rows so callers can use `.id` after PK rename (productID / warehouseID / …). */
function withId(row, ...keys) {
  if (!row) return null;
  if (row.id != null) return row;
  for (const key of keys) {
    if (row[key] != null) return { ...row, id: row[key] };
  }
  return row;
}

async function getDefaultWarehouse(executor) {
  const [rows] = await executor.query(
    `SELECT * FROM tblWarehouse WHERE is_active = 1 ORDER BY is_default DESC, warehouseID ASC LIMIT 1`
  );
  if (rows.length) return withId(rows[0], 'warehouseID');
  const [ins] = await executor.query(
    `INSERT INTO tblWarehouse (name, code, is_default, is_active) VALUES ('Main Warehouse', 'MAIN', 1, 1)`
  );
  return { id: ins.insertId, warehouseID: ins.insertId, name: 'Main Warehouse', code: 'MAIN', is_default: 1 };
}

async function findVariant(executor, productId, { variantId, size, color }: any = {}) {
  if (variantId) {
    const [rows] = await executor.query(
      productId
        ? 'SELECT * FROM tblProductVariant WHERE productVariantID = :id AND productID = :productId LIMIT 1'
        : 'SELECT * FROM tblProductVariant WHERE productVariantID = :id LIMIT 1',
      productId ? { id: variantId, productId } : { id: variantId }
    );
    return withId(rows[0], 'productVariantID');
  }
  if (productId && size && color) {
    const [rows] = await executor.query(
      `SELECT * FROM tblProductVariant
       WHERE productID = :productId AND size = :size AND color = :color
       LIMIT 1`,
      { productId, size, color }
    );
    return withId(rows[0], 'productVariantID');
  }
  return null;
}

async function ensureInventoryRow(executor, { productId, variantId, warehouseId, minStock = 10 }) {
  const [rows] = await executor.query(
    `SELECT * FROM tblInventory WHERE productVariantID = :variantId AND warehouseID = :warehouseId LIMIT 1`,
    { variantId, warehouseId }
  );
  if (rows.length) return withId(rows[0], 'inventoryID');

  const status = computeStockStatus(0, minStock);
  const [ins] = await executor.query(
    `INSERT INTO tblInventory
      (productID, productVariantID, warehouseID, opening_stock, available_qty, min_stock, status)
     VALUES (:productId, :variantId, :warehouseId, 0, 0, :minStock, :status)`,
    { productId, variantId, warehouseId, minStock, status }
  );
  const [created] = await executor.query(`SELECT * FROM tblInventory WHERE inventoryID = :id`, { id: ins.insertId });
  return withId(created[0], 'inventoryID');
}

async function ensureInventoryForVariant(executor, variant, warehouseId = null) {
  const wh = warehouseId
    ? { id: warehouseId }
    : await getDefaultWarehouse(executor);
  return ensureInventoryRow(executor, {
    productId: variant.productID,
    variantId: variant.id,
    warehouseId: wh.id,
    minStock: 10,
  });
}

async function syncVariantFromInventory(executor, variantId) {
  const [[row]] = await executor.query(
    `SELECT COALESCE(SUM(available_qty), 0) AS total
     FROM tblInventory WHERE productVariantID = :variantId`,
    { variantId }
  );
  const total = Number(row?.total) || 0;
  await executor.query(`UPDATE tblProductVariant SET stock = :stock WHERE productVariantID = :id`, {
    stock: total,
    id: variantId,
  });
  return total;
}

async function syncProductStock(executor, productId) {
  const [[row]] = await executor.query(
    `SELECT COALESCE(SUM(stock), 0) AS total
     FROM tblProductVariant WHERE productID = :productId`,
    { productId }
  );
  const total = Number(row?.total) || 0;
  await executor.query('UPDATE tblProduct SET stock = :stock WHERE productID = :id', {
    stock: total,
    id: productId,
  });
  return total;
}

async function getProductStockMeta(executor, productId) {
  const [rows] = await executor.query(
    `SELECT productID AS id, productID, stock, min_stock, warehouse, stock_status
     FROM tblProduct WHERE productID = :id LIMIT 1`,
    { id: productId }
  );
  return rows[0] || null;
}

async function refreshStockStatus(executor, productId) {
  const product = await getProductStockMeta(executor, productId);
  if (!product) return null;
  const status = computeStockStatus(product.stock, product.min_stock);
  await executor.query('UPDATE tblProduct SET stock_status = :status WHERE productID = :id', {
    status,
    id: productId,
  });
  return status;
}

async function refreshInventoryStatus(executor, inventoryId) {
  const [rows] = await executor.query(`SELECT * FROM tblInventory WHERE inventoryID = :id`, { id: inventoryId });
  if (!rows.length) return null;
  const status = computeInventoryStatus(rows[0]);
  await executor.query(`UPDATE tblInventory SET status = :status WHERE inventoryID = :id`, {
    status,
    id: inventoryId,
  });
  return status;
}

/**
 * Apply stock change against tblInventory (variant+warehouse), sync variant/product, write ledger.
 */
async function applyStockChange(options: any = {}, connection: any = null) {
  const executor = await getExecutor(connection);
  const {
    productId,
    variantId = null,
    size = null,
    color = null,
    type,
    qtyDelta = null,
    setQty = null,
    note = null,
    refType = null,
    refId = null,
    createdBy = null,
    fromLocation = null,
    toLocation = null,
    warehouse = null,
    warehouseId = null,
    toWarehouseId = null,
    supplierId = null,
    referenceNo = null,
    movementDate = null,
    purchasePrice = null,
    allowNegative = false,
  } = options;

  if (!productId || !type) {
    throw new Error('productId and type are required');
  }

  const product = await getProductStockMeta(executor, productId);
  if (!product) throw new Error('Product not found');

  const variant = await findVariant(executor, productId, { variantId, size, color });
  const defaultWh = await getDefaultWarehouse(executor);

  let warehouseRow = defaultWh;
  if (warehouseId) {
    const [rows] = await executor.query(`SELECT * FROM tblWarehouse WHERE warehouseID = :id`, { id: warehouseId });
    if (rows.length) warehouseRow = withId(rows[0], 'warehouseID');
  } else if (warehouse) {
    const [rows] = await executor.query(
      `SELECT * FROM tblWarehouse WHERE code = :code OR name = :code LIMIT 1`,
      { code: String(warehouse).trim() }
    );
    if (rows.length) warehouseRow = withId(rows[0], 'warehouseID');
  }

  let qtyBefore = 0;
  let qtyAfter = 0;
  let appliedDelta = 0;
  let inventoryId = null;
  let resolvedVariantId = variant?.id || null;

  if (variant) {
    const inv = await ensureInventoryRow(executor, {
      productId,
      variantId: variant.id,
      warehouseId: warehouseRow.id,
      minStock: product.min_stock || 10,
    });
    inventoryId = inv.id;
    qtyBefore = Number(inv.available_qty) || 0;

    if (type === 'transfer') {
      const destId = toWarehouseId || null;
      if (!destId || Number(destId) === Number(warehouseRow.id)) {
        throw new Error('Transfer requires a different destination warehouse');
      }
      const amount = Math.abs(Number(qtyDelta) || 0);
      if (!amount) throw new Error('Transfer quantity is required');
      if (amount > qtyBefore) throw new Error('Insufficient stock for transfer');

      await executor.query(
        `UPDATE tblInventory SET available_qty = available_qty - :qty WHERE inventoryID = :id`,
        { qty: amount, id: inv.id }
      );
      await refreshInventoryStatus(executor, inv.id);

      const destInv = await ensureInventoryRow(executor, {
        productId,
        variantId: variant.id,
        warehouseId: destId,
        minStock: product.min_stock || 10,
      });
      await executor.query(
        `UPDATE tblInventory SET available_qty = available_qty + :qty, purchased_qty = purchased_qty WHERE inventoryID = :id`,
        { qty: amount, id: destInv.id }
      );
      await refreshInventoryStatus(executor, destInv.id);

      qtyAfter = qtyBefore - amount;
      appliedDelta = -amount;

      const [destWh] = await executor.query(`SELECT * FROM tblWarehouse WHERE warehouseID = :id`, { id: destId });
      await syncVariantFromInventory(executor, variant.id);
      await syncProductStock(executor, productId);
      await refreshStockStatus(executor, productId);

      await executor.query(
        `INSERT INTO tblStockMovement
          (productID, productVariantID, warehouseID, supplierID, reference_no, movement_date,
           movement_type, qty, qty_before, qty_after, from_location, to_location,
           ref_type, ref_id, note, createdByUserID)
         VALUES
          (:productId, :variantId, :warehouseId, :supplierId, :referenceNo, :movementDate,
           :movementType, :qty, :qtyBefore, :qtyAfter, :fromLocation, :toLocation,
           :refType, :refId, :note, :createdBy)`,
        {
          productId,
          variantId: variant.id,
          warehouseId: warehouseRow.id,
          supplierId: supplierId || null,
          referenceNo: referenceNo || null,
          movementDate: movementDate || new Date(),
          movementType: 'transfer',
          qty: -amount,
          qtyBefore,
          qtyAfter,
          fromLocation: warehouseRow.name || warehouseRow.code,
          toLocation: destWh[0]?.name || destWh[0]?.code || String(destId),
          refType,
          refId,
          note,
          createdBy,
        }
      );

      return {
        productId,
        variantId: variant.id,
        warehouseId: warehouseRow.id,
        toWarehouseId: destId,
        qtyBefore,
        qtyAfter,
        qtyDelta: -amount,
        stock: await syncProductStock(executor, productId),
      };
    }

    if (setQty != null && setQty !== '') {
      qtyAfter = Math.max(0, Number(setQty) || 0);
      appliedDelta = qtyAfter - qtyBefore;
    } else {
      appliedDelta = Number(qtyDelta) || 0;
      qtyAfter = qtyBefore + appliedDelta;
      if (qtyAfter < 0) {
        if (allowNegative) {
          // Panel/manual tblOrder may oversell; clamp available to 0 and keep sold movement.
          appliedDelta = -qtyBefore;
          qtyAfter = 0;
        } else {
          throw new Error(`Insufficient stock for variant ${variant.size}/${variant.color}`);
        }
      }
    }

    const patch: any = { available_qty: qtyAfter };
    if (['in', 'purchase', 'opening'].includes(type) && appliedDelta > 0) {
      patch.purchased_qty = Number(inv.purchased_qty || 0) + appliedDelta;
    }
    if (['out', 'sale', 'pos'].includes(type) && appliedDelta < 0) {
      patch.sold_qty = Number(inv.sold_qty || 0) + Math.abs(appliedDelta);
    }
    if (type === 'return' && appliedDelta > 0) {
      patch.returned_qty = Number(inv.returned_qty || 0) + appliedDelta;
    }
    if (type === 'damaged' && appliedDelta < 0) {
      patch.damaged_qty = Number(inv.damaged_qty || 0) + Math.abs(appliedDelta);
    }
    if (type === 'cancel' && appliedDelta > 0) {
      patch.sold_qty = Math.max(0, Number(inv.sold_qty || 0) - appliedDelta);
    }

    await executor.query(
      `UPDATE tblInventory SET
         available_qty = :available_qty,
         purchased_qty = :purchased_qty,
         sold_qty = :sold_qty,
         returned_qty = :returned_qty,
         damaged_qty = :damaged_qty
       WHERE inventoryID = :id`,
      {
        id: inv.id,
        available_qty: qtyAfter,
        purchased_qty: patch.purchased_qty != null ? patch.purchased_qty : inv.purchased_qty,
        sold_qty: patch.sold_qty != null ? patch.sold_qty : inv.sold_qty,
        returned_qty: patch.returned_qty != null ? patch.returned_qty : inv.returned_qty,
        damaged_qty: patch.damaged_qty != null ? patch.damaged_qty : inv.damaged_qty,
      }
    );
    await refreshInventoryStatus(executor, inv.id);
    await syncVariantFromInventory(executor, variant.id);
    await syncProductStock(executor, productId);
  } else {
    // Product-level fallback (no variant)
    qtyBefore = Number(product.stock) || 0;
    if (setQty != null && setQty !== '') {
      qtyAfter = Math.max(0, Number(setQty) || 0);
      appliedDelta = qtyAfter - qtyBefore;
    } else {
      appliedDelta = Number(qtyDelta) || 0;
      qtyAfter = qtyBefore + appliedDelta;
      if (qtyAfter < 0) {
        if (allowNegative) {
          appliedDelta = -qtyBefore;
          qtyAfter = 0;
        } else {
          throw new Error('Insufficient product stock');
        }
      }
    }
    await executor.query('UPDATE tblProduct SET stock = :stock WHERE productID = :id', {
      stock: qtyAfter,
      id: productId,
    });
  }

  if (warehouse != null && String(warehouse).trim() !== '') {
    await executor.query('UPDATE tblProduct SET warehouse = :warehouse WHERE productID = :id', {
      warehouse: String(warehouse).trim(),
      id: productId,
    });
  }

  const status = await refreshStockStatus(executor, productId);

  await executor.query(
    `INSERT INTO tblStockMovement
      (productID, productVariantID, warehouseID, supplierID, reference_no, movement_date,
       movement_type, qty, qty_before, qty_after, from_location, to_location,
       ref_type, ref_id, note, createdByUserID)
     VALUES
      (:productId, :variantId, :warehouseId, :supplierId, :referenceNo, :movementDate,
       :movementType, :qty, :qtyBefore, :qtyAfter, :fromLocation, :toLocation,
       :refType, :refId, :note, :createdBy)`,
    {
      productId,
      variantId: resolvedVariantId,
      warehouseId: warehouseRow?.id || null,
      supplierId: supplierId || null,
      referenceNo: referenceNo || (purchasePrice != null ? `PP:${purchasePrice}` : null),
      movementDate: movementDate || new Date(),
      movementType: type,
      qty: appliedDelta,
      qtyBefore,
      qtyAfter,
      fromLocation: fromLocation || warehouseRow?.name || product.warehouse || null,
      toLocation: toLocation || null,
      refType,
      refId,
      note,
      createdBy,
    }
  );

  const synced = await getProductStockMeta(executor, productId);
  return {
    productId,
    variantId: resolvedVariantId,
    warehouseId: warehouseRow?.id || null,
    inventoryId,
    qtyBefore,
    qtyAfter,
    qtyDelta: appliedDelta,
    stock: Number(synced?.stock) || 0,
    stock_status: status || synced?.stock_status,
    warehouse: warehouseRow?.name || synced?.warehouse || null,
  };
}

async function writeMovement(executor, payload) {
  await executor.query(
    `INSERT INTO tblStockMovement
      (productID, productVariantID, warehouseID, supplierID, reference_no, movement_date,
       movement_type, qty, qty_before, qty_after, from_location, to_location,
       ref_type, ref_id, note, createdByUserID)
     VALUES
      (:productId, :variantId, :warehouseId, :supplierId, :referenceNo, :movementDate,
       :movementType, :qty, :qtyBefore, :qtyAfter, :fromLocation, :toLocation,
       :refType, :refId, :note, :createdBy)`,
    payload
  );
}

async function resolveVariantInventory(executor, { productId, size, color, variantId = null }) {
  const product = await getProductStockMeta(executor, productId);
  if (!product) throw new Error('Product not found');
  const variant = await findVariant(executor, productId, { variantId, size, color });
  if (!variant) throw new Error(`Variant not found for product ${productId}`);
  const warehouse = await getDefaultWarehouse(executor);
  const inv = await ensureInventoryRow(executor, {
    productId,
    variantId: variant.id,
    warehouseId: warehouse.id,
    minStock: product.min_stock || 10,
  });
  return { product, variant, warehouse, inv };
}

/** Reserve sellable stock for a confirmed order (available → reserved). */
async function reserveStock(options: any = {}, connection: any = null) {
  const executor = await getExecutor(connection);
  const qty = Math.abs(Number(options.qty) || 0);
  if (!qty) throw new Error('Reserve quantity is required');
  const { product, variant, warehouse, inv } = await resolveVariantInventory(executor, options);
  const available = Number(inv.available_qty) || 0;
  if (qty > available) {
    throw new Error(`Insufficient stock to reserve for variant ${variant.size}/${variant.color}`);
  }
  const availableAfter = available - qty;
  const reservedAfter = (Number(inv.reserved_qty) || 0) + qty;
  await executor.query(
    `UPDATE tblInventory SET available_qty = :available, reserved_qty = :reserved WHERE inventoryID = :id`,
    { available: availableAfter, reserved: reservedAfter, id: inv.id }
  );
  await refreshInventoryStatus(executor, inv.id);
  await syncVariantFromInventory(executor, variant.id);
  await syncProductStock(executor, product.id);
  await refreshStockStatus(executor, product.id);
  await writeMovement(executor, {
    productId: product.id,
    variantId: variant.id,
    warehouseId: warehouse.id,
    supplierId: null,
    referenceNo: null,
    movementDate: new Date(),
    movementType: 'reserve',
    qty: -qty,
    qtyBefore: available,
    qtyAfter: availableAfter,
    fromLocation: warehouse.name || warehouse.code,
    toLocation: 'reserved',
    refType: options.refType || 'order',
    refId: options.refId || null,
    note: options.note || 'Stock reserved for order',
    createdBy: options.createdBy || null,
  });
  return { variantId: variant.id, qty };
}

/** Release previously reserved stock back to available. */
async function releaseReservedStock(options: any = {}, connection: any = null) {
  const executor = await getExecutor(connection);
  const qty = Math.abs(Number(options.qty) || 0);
  if (!qty) throw new Error('Release quantity is required');
  const { product, variant, warehouse, inv } = await resolveVariantInventory(executor, options);
  const reserved = Number(inv.reserved_qty) || 0;
  const releaseQty = Math.min(qty, reserved);
  if (!releaseQty) return { variantId: variant.id, qty: 0 };
  const availableAfter = (Number(inv.available_qty) || 0) + releaseQty;
  const reservedAfter = reserved - releaseQty;
  await executor.query(
    `UPDATE tblInventory SET available_qty = :available, reserved_qty = :reserved WHERE inventoryID = :id`,
    { available: availableAfter, reserved: reservedAfter, id: inv.id }
  );
  await refreshInventoryStatus(executor, inv.id);
  await syncVariantFromInventory(executor, variant.id);
  await syncProductStock(executor, product.id);
  await refreshStockStatus(executor, product.id);
  await writeMovement(executor, {
    productId: product.id,
    variantId: variant.id,
    warehouseId: warehouse.id,
    supplierId: null,
    referenceNo: null,
    movementDate: new Date(),
    movementType: 'release',
    qty: releaseQty,
    qtyBefore: Number(inv.available_qty) || 0,
    qtyAfter: availableAfter,
    fromLocation: 'reserved',
    toLocation: warehouse.name || warehouse.code,
    refType: options.refType || 'order',
    refId: options.refId || null,
    note: options.note || 'Reserved stock released',
    createdBy: options.createdBy || null,
  });
  return { variantId: variant.id, qty: releaseQty };
}

/** Convert reserved stock into sold on ship (no second available deduction). */
async function finalizeReservedSale(options: any = {}, connection: any = null) {
  const executor = await getExecutor(connection);
  const qty = Math.abs(Number(options.qty) || 0);
  if (!qty) throw new Error('Finalize quantity is required');
  const { product, variant, warehouse, inv } = await resolveVariantInventory(executor, options);
  const reserved = Number(inv.reserved_qty) || 0;
  const useQty = Math.min(qty, reserved);
  if (!useQty) {
    // Fallback: if nothing reserved (legacy tblOrder), deduct available once.
    return applyStockChange(
      {
        productId: product.id,
        size: variant.size,
        color: variant.color,
        type: 'sale',
        qtyDelta: -qty,
        refType: options.refType || 'order',
        refId: options.refId || null,
        note: options.note || 'Sale finalized without prior reserve',
        createdBy: options.createdBy || null,
        allowNegative: !!options.allowNegative,
      },
      connection
    );
  }
  const reservedAfter = reserved - useQty;
  const soldAfter = (Number(inv.sold_qty) || 0) + useQty;
  await executor.query(
    `UPDATE tblInventory SET reserved_qty = :reserved, sold_qty = :sold WHERE inventoryID = :id`,
    { reserved: reservedAfter, sold: soldAfter, id: inv.id }
  );
  await refreshInventoryStatus(executor, inv.id);
  await syncVariantFromInventory(executor, variant.id);
  await syncProductStock(executor, product.id);
  await refreshStockStatus(executor, product.id);
  await writeMovement(executor, {
    productId: product.id,
    variantId: variant.id,
    warehouseId: warehouse.id,
    supplierId: null,
    referenceNo: null,
    movementDate: new Date(),
    movementType: 'sale',
    qty: -useQty,
    qtyBefore: Number(inv.available_qty) || 0,
    qtyAfter: Number(inv.available_qty) || 0,
    fromLocation: 'reserved',
    toLocation: 'sold',
    refType: options.refType || 'order',
    refId: options.refId || null,
    note: options.note || 'Reserved stock finalized as sale',
    createdBy: options.createdBy || null,
  });
  return { variantId: variant.id, qty: useQty };
}

/** Return inspected goods to sellable stock once. */
async function restockReturnedSellable(options: any = {}, connection: any = null) {
  const executor = await getExecutor(connection);
  const qty = Math.abs(Number(options.qty) || 0);
  if (!qty) throw new Error('Restock quantity is required');
  const { product, variant, warehouse, inv } = await resolveVariantInventory(executor, options);
  const availableAfter = (Number(inv.available_qty) || 0) + qty;
  const returnedAfter = (Number(inv.returned_qty) || 0) + qty;
  await executor.query(
    `UPDATE tblInventory SET available_qty = :available, returned_qty = :returned WHERE inventoryID = :id`,
    { available: availableAfter, returned: returnedAfter, id: inv.id }
  );
  await refreshInventoryStatus(executor, inv.id);
  await syncVariantFromInventory(executor, variant.id);
  await syncProductStock(executor, product.id);
  await refreshStockStatus(executor, product.id);
  await writeMovement(executor, {
    productId: product.id,
    variantId: variant.id,
    warehouseId: warehouse.id,
    supplierId: null,
    referenceNo: null,
    movementDate: new Date(),
    movementType: 'return',
    qty,
    qtyBefore: Number(inv.available_qty) || 0,
    qtyAfter: availableAfter,
    fromLocation: 'returned',
    toLocation: warehouse.name || warehouse.code,
    refType: options.refType || 'order',
    refId: options.refId || null,
    note: options.note || 'Returned goods restocked after inspection',
    createdBy: options.createdBy || null,
  });
  return { variantId: variant.id, qty };
}

async function listStockItems(filters: any = {}) {
  const params = [];
  let where = '1=1';
  if (filters.companyID) {
    where += ' AND p.companyID = ? AND i.companyID = ? AND w.companyID = ?';
    params.push(filters.companyID, filters.companyID, filters.companyID);
  }
  if (filters.q) {
    where += ` AND (p.name LIKE ? OR p.sku LIKE ? OR pv.stock_code LIKE ? OR pv.barcode LIKE ?)`;
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
  }
  if (filters.categoryID) {
    where += ' AND p.categoryID = ?';
    params.push(filters.categoryID);
  }
  if (filters.brand) {
    where += ' AND p.brand = ?';
    params.push(filters.brand);
  }
  if (filters.size) {
    where += ' AND pv.size = ?';
    params.push(filters.size);
  }
  if (filters.color) {
    where += ' AND pv.color = ?';
    params.push(filters.color);
  }
  if (filters.warehouseID) {
    where += ' AND i.warehouseID = ?';
    params.push(filters.warehouseID);
  }
  if (filters.status) {
    where += ' AND i.status = ?';
    params.push(filters.status);
  }

  const [rows] = await db.query(
    `SELECT
        i.inventoryID AS inventory_id,
        i.inventoryID AS id,
        i.available_qty, i.opening_stock, i.purchased_qty, i.sold_qty, i.damaged_qty,
        i.returned_qty, i.reserved_qty, i.min_stock, i.status AS stock_status,
        i.warehouseID AS warehouse_id,
        i.warehouseID,
        w.name AS warehouse_name, w.code AS warehouse_code,
        pv.productVariantID AS variant_id,
        pv.productVariantID AS productVariantID, pv.size, pv.color, pv.stock_code, pv.barcode, pv.image_url AS variant_image,
        pv.is_active AS variant_active, pv.price AS variant_price,
        p.productID AS product_id,
        p.productID AS productID, p.name AS product_name, p.sku AS product_code, p.brand, p.price AS mrp,
        p.sale_price, p.is_active AS product_active,
        c.name AS category_name, pt.name AS product_type_name,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
     FROM tblInventory i
     JOIN tblProductVariant pv ON pv.productVariantID = i.productVariantID
     JOIN tblProduct p ON p.productID = i.productID
     JOIN tblWarehouse w ON w.warehouseID = i.warehouseID
     LEFT JOIN tblCategory c ON c.categoryID = p.categoryID
     LEFT JOIN tblProductType pt ON pt.productTypeID = p.productTypeID
     WHERE ${where}
     ORDER BY p.name ASC, pv.color ASC, pv.size ASC`,
    params
  );
  return rows;
}

async function stockStatusSummary(companyID?: number) {
  const params: any[] = [];
  let companySql = '';
  if (companyID) {
    companySql = ' AND i.companyID = ? AND p.companyID = ?';
    params.push(companyID, companyID);
  }
  const [[row]] = await db.query(
    `SELECT
        COUNT(*) AS current_total,
        COALESCE(SUM(CASE WHEN i.status = 'low_stock' THEN 1 ELSE 0 END), 0) AS low_total,
        COALESCE(SUM(CASE WHEN i.status = 'out_of_stock' THEN 1 ELSE 0 END), 0) AS out_total,
        COALESCE(SUM(CASE WHEN i.damaged_qty > 0 OR i.status = 'damaged' THEN 1 ELSE 0 END), 0) AS damaged_total,
        COALESCE(SUM(i.available_qty), 0) AS available_units
     FROM tblInventory i
     JOIN tblProduct p ON p.productID = i.productID
     WHERE 1=1 ${companySql}`,
    params
  );
  return {
    current: Number(row?.current_total || 0),
    low: Number(row?.low_total || 0),
    out: Number(row?.out_total || 0),
    damaged: Number(row?.damaged_total || 0),
    available_units: Number(row?.available_units || 0),
  };
}

async function listStockHistory(filters: any = {}) {
  const safeLimit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const params = [];
  let where = '1=1';
  if (filters.productID) {
    where += ' AND sm.productID = ?';
    params.push(filters.productID);
  }
  if (filters.productVariantID) {
    where += ' AND sm.productVariantID = ?';
    params.push(filters.productVariantID);
  }
  if (filters.warehouseID) {
    where += ' AND sm.warehouseID = ?';
    params.push(filters.warehouseID);
  }
  if (filters.type) {
    where += ' AND sm.movement_type = ?';
    params.push(filters.type);
  }
  if (filters.sku) {
    where += ' AND (p.sku LIKE ? OR pv.stock_code LIKE ? OR pv.barcode LIKE ?)';
    const like = `%${filters.sku}%`;
    params.push(like, like, like);
  }
  if (filters.from) {
    where += ' AND COALESCE(sm.movement_date, sm.created_at) >= ?';
    params.push(filters.from);
  }
  if (filters.to) {
    where += ' AND COALESCE(sm.movement_date, sm.created_at) <= ?';
    params.push(filters.to);
  }

  const [rows] = await db.query(
    `SELECT sm.*, p.name AS product_name, p.sku,
            pv.size, pv.color, pv.stock_code, pv.barcode AS variant_barcode,
            w.name AS warehouse_name,
            u.name AS created_by_name
     FROM tblStockMovement sm
     JOIN tblProduct p ON p.productID = sm.productID
     LEFT JOIN tblProductVariant pv ON pv.productVariantID = sm.productVariantID
     LEFT JOIN tblWarehouse w ON w.warehouseID = sm.warehouseID
     LEFT JOIN tblUser u ON u.userID = sm.createdByUserID
     WHERE ${where}
     ORDER BY COALESCE(sm.movement_date, sm.created_at) DESC, sm.stockMovementID DESC
     LIMIT ${safeLimit}`,
    params
  );
  return rows;
}

async function listLowStock({ limit = 50, companyID }: any = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params: any[] = [];
  let companySql = '';
  if (companyID) {
    companySql = ' AND p.companyID = ? AND i.companyID = ? AND w.companyID = ?';
    params.push(companyID, companyID, companyID);
  }
  const [rows] = await db.query(
    `SELECT i.*, p.name, p.sku, pv.size, pv.color, pv.stock_code,
            w.name AS warehouse_name,
            (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
     FROM tblInventory i
     JOIN tblProduct p ON p.productID = i.productID
     JOIN tblProductVariant pv ON pv.productVariantID = i.productVariantID
     JOIN tblWarehouse w ON w.warehouseID = i.warehouseID
     WHERE p.is_active = 1
       AND i.status IN ('low_stock', 'out_of_stock', 'damaged')
       ${companySql}
     ORDER BY i.available_qty ASC
     LIMIT ${safeLimit}`,
    params
  );
  return rows;
}

async function stockReport(type = 'current', filters: any = {}) {
  const companyID = filters.companyID;
  if (type === 'low') {
    return listLowStock({ limit: 200, companyID }).then((rows) =>
      rows.filter((r) => r.status === 'low_stock')
    );
  }
  if (type === 'out') {
    return listLowStock({ limit: 200, companyID }).then((rows) =>
      rows.filter((r) => r.status === 'out_of_stock')
    );
  }
  if (type === 'damaged') {
    const params: any[] = [];
    let companySql = '';
    if (companyID) {
      companySql = ' AND p.companyID = ? AND i.companyID = ? AND w.companyID = ?';
      params.push(companyID, companyID, companyID);
    }
    const [rows] = await db.query(
      `SELECT i.*, p.name, p.sku, pv.size, pv.color, w.name AS warehouse_name
       FROM tblInventory i
       JOIN tblProduct p ON p.productID = i.productID
       JOIN tblProductVariant pv ON pv.productVariantID = i.productVariantID
       JOIN tblWarehouse w ON w.warehouseID = i.warehouseID
       WHERE (i.damaged_qty > 0 OR i.status = 'damaged')
         ${companySql}
       ORDER BY i.damaged_qty DESC`,
      params
    );
    return rows;
  }
  if (type === 'movement') return listStockHistory({ limit: 200, companyID });
  if (type === 'warehouse') {
    const params: any[] = [];
    let where = '1=1';
    if (companyID) {
      where += ' AND w.companyID = ?';
      params.push(companyID);
    }
    const [rows] = await db.query(
      `SELECT w.warehouseID, w.name, w.code,
              COUNT(i.inventoryID) AS sku_count,
              COALESCE(SUM(i.available_qty),0) AS available_units
       FROM tblWarehouse w
       LEFT JOIN tblInventory i ON i.warehouseID = w.warehouseID
       WHERE ${where}
       GROUP BY w.warehouseID
       ORDER BY w.name`,
      params
    );
    return rows;
  }
  return listStockItems({ companyID });
}

async function listWarehouses(companyID?: number) {
  if (companyID) {
    const [rows] = await db.query(
      `SELECT * FROM tblWarehouse WHERE is_active = 1 AND companyID = ? ORDER BY is_default DESC, name`,
      [companyID]
    );
    if (!rows.length) {
      const wh = await getDefaultWarehouse(db);
      return [wh];
    }
    return rows;
  }
  const [rows] = await db.query(`SELECT * FROM tblWarehouse WHERE is_active = 1 ORDER BY is_default DESC, name`);
  if (!rows.length) {
    const wh = await getDefaultWarehouse(db);
    return [wh];
  }
  return rows;
}

export { computeStockStatus, findVariant, syncProductStock, refreshStockStatus, applyStockChange, reserveStock, releaseReservedStock, finalizeReservedSale, restockReturnedSellable, listStockHistory, listLowStock, listStockItems, stockStatusSummary, stockReport, listWarehouses, getDefaultWarehouse, ensureInventoryForVariant, ensureInventoryRow };
