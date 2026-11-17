/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: POS lookup and checkout handlers
 * Edit Date: 2026-11-14
 */

import bcrypt from 'bcryptjs';
import db from '../config/db';
import { ok, fail, orderNumber  } from '../utils/helpers';
import { getRoleId } from '../utils/roleLookup';
import { requireCompanyId, getBranchId, CompanyScopeError } from '../utils/companyScope';
import { reserveStock,
  finalizeReservedSale,
  findVariant,
  getDefaultWarehouse,
 } from '../utils/stockService';
import { calcPosGrandTotal,
  logOrderHistory,
  finalizePosSaleStock,
  PAYMENT_STATUSES,
 } from '../utils/orderWorkflow';

const POS_METHODS = ['cash', 'upi', 'card', 'credit', 'online'];

function invoiceNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const seq = String(Date.now()).slice(-6);
  return `INV-${y}${m}${day}-${seq}`;
}

function normalizePosItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => ({
      productID: Number(item.productID),
      product_name: String(item.product_name || '').trim(),
      size: String(item.size || '').trim() || null,
      color: String(item.color || '').trim() || null,
      quantity: Math.max(1, Number(item.quantity) || 1),
      price: Number(item.price) || 0,
      item_discount: Math.max(0, Number(item.item_discount) || 0),
      barcode: String(item.barcode || item.stock_code || '').trim() || null,
    }))
    .filter((item) => item.productID && item.product_name && item.price >= 0);
}

function normalizePayments(rawPayments, fallbackMethod, total) {
  let rows = Array.isArray(rawPayments) ? rawPayments : [];
  if (!rows.length && fallbackMethod) {
    rows = [{ method: fallbackMethod, amount: total, status: 'paid', reference_no: '' }];
  }
  return rows
    .map((p) => ({
      method: String(p.method || '').toLowerCase(),
      amount: Number(p.amount) || 0,
      reference_no: String(p.reference_no || '').trim() || null,
      status: ['pending', 'paid', 'failed'].includes(String(p.status)) ? String(p.status) : 'paid',
    }))
    .filter((p) => POS_METHODS.includes(p.method) && p.amount > 0);
}

async function ensureWalkInCustomer(connection) {
  const email = 'walkin@buildnexkadai.local';
  const [rows] = await connection.query('SELECT userID AS id FROM tblUser WHERE email = :email LIMIT 1', { email });
  if (rows.length) return (rows[0].userID ?? rows[0].id);
  const password = await bcrypt.hash(`walkin-${Date.now()}`, 10);
  const customerRoleId = await getRoleId('customer');
  const [result] = await connection.query(
    `INSERT INTO tblUser (name, email, phone, password, roleID, is_active)
     VALUES ('Walk-in Customer', :email, '0000000000', :password, :roleID, 1)`,
    { email, password, roleID: customerRoleId }
  );
  return result.insertId;
}

async function upsertCustomerByPhone(connection, customer) {
  const phone = String(customer.phone || '').trim();
  const name = String(customer.name || '').trim();
  const address = String(customer.address || '').trim();
  const email = String(customer.email || '').trim() || null;
  const city = String(customer.city || '').trim() || 'Local';
  const state = String(customer.state || '').trim() || 'N/A';
  const pincode = String(customer.pincode || '').trim() || '000000';

  if (!phone || !name || !address) {
    throw new Error('Customer name, mobile and address are required');
  }

  const [existing] = await connection.query(
    `SELECT u.userID AS id FROM tblUser u
     LEFT JOIN tblRole r ON r.roleID = u.roleID
     WHERE (r.RoleCode = 'customer' OR r.Level >= 90 OR u.roleID IS NULL) AND u.phone = :phone
     LIMIT 1`,
    { phone }
  );

  if (existing.length) {
    const id = (existing[0].userID ?? existing[0].id);
    await connection.query(
      `UPDATE tblUser SET
        name = :name,
        address = :address,
        email = COALESCE(:email, email),
        city = :city,
        state = :state,
        pincode = :pincode
       WHERE userID = :id`,
      { id, name, address, email, city, state, pincode }
    );
    return id;
  }

  const safeEmail = email || `pos_${phone}@customer.local`;
  const [byEmail] = await connection.query('SELECT userID AS id FROM tblUser WHERE email = :email LIMIT 1', {
    email: safeEmail,
  });
  if (byEmail.length) {
    const id = (byEmail[0].userID ?? byEmail[0].id);
    await connection.query(
      `UPDATE tblUser SET name = :name, phone = :phone, address = :address, city = :city, state = :state, pincode = :pincode
       WHERE userID = :id`,
      { id, name, phone, address, city, state, pincode }
    );
    return id;
  }

  const password = await bcrypt.hash(`pos-${phone}-${Date.now()}`, 10);
  const customerRoleId = await getRoleId('customer');
  const [ins] = await connection.query(
    `INSERT INTO tblUser (name, email, phone, password, address, city, state, pincode, roleID, is_active)
     VALUES (:name, :email, :phone, :password, :address, :city, :state, :pincode, :roleID, 1)`,
    { name, email: safeEmail, phone, password, address, city, state, pincode, roleID: customerRoleId }
  );
  return ins.insertId;
}

async function staffCanEditBilling(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const [rows] = await db.query(
    `SELECT can_edit FROM tblUserRight WHERE userID = :userId AND module_key = 'billing' LIMIT 1`,
    { userId: user.id }
  );
  return !!Number(rows[0]?.can_edit);
}

async function assertStockAvailable(executor, items) {
  const warehouse = await getDefaultWarehouse(executor);
  for (const item of items) {
    const variant = await findVariant(executor, item.productID, {
      size: item.size,
      color: item.color,
    });
    if (!variant) {
      throw new Error(`Variant not found for ${item.product_name} (${item.color || '—'}/${item.size || '—'})`);
    }
    const [invRows] = await executor.query(
      `SELECT available_qty FROM tblInventory
       WHERE productVariantID = :variantId AND warehouseID = :warehouseId LIMIT 1`,
      { variantId: (variant.productVariantID ?? variant.id), warehouseId: (warehouse.warehouseID ?? warehouse.id) }
    );
    const available = Number(invRows[0]?.available_qty ?? variant.stock ?? 0);
    if (item.quantity > available) {
      throw new Error(
        `Insufficient stock for ${item.product_name} (${item.color || '—'}/${item.size || '—'}). Available: ${available}`
      );
    }
  }
}

export const lookupProduct = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const code = String(req.query.code || req.query.q || '').trim();
    if (!code) return fail(res, 'Barcode or search term required');

    const like = `%${code}%`;
    const [rows] = await db.query(
      `SELECT
          i.id AS inventory_id,
          i.available_qty, i.min_stock, i.status AS stock_status, i.warehouseID,
          w.name AS warehouse_name, w.code AS warehouse_code,
          pv.productVariantID AS productVariantID, pv.size, pv.color, pv.stock_code, pv.barcode,
          pv.image_url AS variant_image, pv.price AS variant_price,
          p.productID AS productID, p.name AS product_name, p.sku AS product_code, p.sku, p.brand,
          p.price AS mrp, p.sale_price,
          (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
       FROM tblInventory i
       JOIN tblProductVariant pv ON pv.productVariantID = i.productVariantID
       JOIN tblProduct p ON p.productID = i.productID
       JOIN tblWarehouse w ON w.warehouseID = i.warehouseID
       WHERE p.companyID = :companyID
         AND i.available_qty > 0
         AND (p.name LIKE :like OR p.sku LIKE :like OR pv.stock_code LIKE :like OR pv.barcode LIKE :like)
       ORDER BY p.name ASC, pv.color ASC, pv.size ASC
       LIMIT 40`,
      { companyID, like }
    );
    const exact = rows;
    const match =
      exact.find(
        (r) =>
          String(r.barcode || '').toLowerCase() === code.toLowerCase() ||
          String(r.stock_code || '').toLowerCase() === code.toLowerCase() ||
          String(r.sku || '').toLowerCase() === code.toLowerCase() ||
          String(r.product_code || '').toLowerCase() === code.toLowerCase()
      ) || null;

    if (!match && !exact.length) return fail(res, 'No available stock for this product', 404);
    return ok(res, { item: match || exact[0], items: exact.slice(0, 30) });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Product lookup failed', 500);
  }
};

export const checkout = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const companyID = requireCompanyId(req.user);
    const items = normalizePosItems(req.body.items);
    if (!items.length) return fail(res, 'Add at least one product to the cart');

    const walkIn = !!req.body.walk_in;
    const clientRequestId = String(req.body.client_request_id || '').trim() || null;

    if (clientRequestId) {
      const [dup] = await connection.query(
        'SELECT orderID AS id, orderID, order_number FROM tblOrder WHERE client_request_id = :id AND companyID = :companyID LIMIT 1',
        { id: clientRequestId, companyID }
      );
      if (dup.length) {
        const [bill] = await connection.query('SELECT * FROM tblBilling WHERE orderID = :oid LIMIT 1', {
          oid: (dup[0].orderID ?? dup[0].id),
        });
        const [pays] = await connection.query('SELECT * FROM tblPosPayment WHERE orderID = :oid', {
          oid: (dup[0].orderID ?? dup[0].id),
        });
        return ok(
          res,
          {
            orderId: (dup[0].orderID ?? dup[0].id),
            orderNumber: dup[0].order_number,
            invoice: bill[0] || null,
            payments: pays,
            duplicate: true,
          },
          'Sale already processed'
        );
      }
    }

    const discount = Math.max(0, Number(req.body.discount) || 0);
    const coupon_discount = Math.max(0, Number(req.body.coupon_discount) || 0);
    const tax_amount = Math.max(0, Number(req.body.tax_amount) || 0);
    const shipping_fee = Math.max(0, Number(req.body.additional_charges ?? req.body.shipping_fee) || 0);
    const round_off = Number(req.body.round_off) || 0;
    const amount_received = Math.max(0, Number(req.body.amount_received) || 0);

    const lineSubtotal = items.reduce(
      (sum, item) => sum + Math.max(0, item.price * item.quantity - item.item_discount),
      0
    );
    const subtotal = Number(lineSubtotal.toFixed(2));
    const total = calcPosGrandTotal({
      subtotal,
      discount,
      coupon_discount,
      tax_amount,
      shipping_fee,
      round_off,
    });

    if (req.body.total != null && Math.abs(Number(req.body.total) - total) > 0.05) {
      return fail(res, 'Bill total mismatch. Refresh totals and try again.', 400, { expected_total: total });
    }

    let paymentRows = normalizePayments(req.body.payments, req.body.payment_method, total);
    if (!paymentRows.length) return fail(res, 'Add at least one payment');

    const paidSum = paymentRows.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const creditSum = paymentRows.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0);
    const hasCredit = creditSum > 0;
    const isSplit = paymentRows.length > 1;
    const primaryMethod = isSplit ? 'split' : paymentRows[0].method;

    if (hasCredit) {
      const allowed = await staffCanEditBilling(req.user);
      if (!allowed) return fail(res, 'Credit / pay later requires billing edit permission', 403);
    }

    const covered = paidSum + creditSum;
    if (covered < total - 0.05) {
      return fail(res, 'Payment amount is less than grand total');
    }

    let payment_status = paidSum >= total - 0.05 ? 'paid' : hasCredit ? 'pending' : 'paid';
    if (!PAYMENT_STATUSES.includes(payment_status)) payment_status = 'pending';

    const change_amount = Math.max(0, Number((amount_received - total).toFixed(2)));

    await assertStockAvailable(connection, items);

    let userId = req.body.userID ? Number(req.body.userID) : null;
    const customerPayload = req.body.customer || {};
    const branchID = getBranchId(req.user);

    try {
      const [cols]: any = await connection.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblOrder' AND COLUMN_NAME = 'branchID'`
      );
      if (Number(cols[0]?.c) === 0) {
        await connection.query(
          `ALTER TABLE tblOrder ADD COLUMN branchID INT NOT NULL DEFAULT 0 AFTER companyID`
        );
      }
    } catch (e: any) {
      console.warn('pos ensure branchID:', e.message);
    }

    await connection.beginTransaction();

    if (walkIn) {
      userId = await ensureWalkInCustomer(connection);
    } else if (!userId) {
      userId = await upsertCustomerByPhone(connection, {
        name: customerPayload.name || req.body.shipping_name,
        phone: customerPayload.phone || req.body.shipping_phone,
        address: customerPayload.address || req.body.shipping_address,
        email: customerPayload.email || req.body.customer_email,
        city: customerPayload.city || req.body.shipping_city,
        state: customerPayload.state || req.body.shipping_state,
        pincode: customerPayload.pincode || req.body.shipping_pincode,
      });
    } else {
      const [tblUser] = await connection.query('SELECT userID AS id FROM tblUser WHERE userID = :id LIMIT 1', { id: userId });
      if (!tblUser.length) userId = await ensureWalkInCustomer(connection);
    }

    const [custRows] = await connection.query(
      'SELECT name, phone, address, city, state, pincode, email FROM tblUser WHERE userID = :id LIMIT 1',
      { id: userId }
    );
    const cust = custRows[0] || {};

    const shipping_name = String(req.body.shipping_name || cust.name || 'Walk-in Customer').trim();
    const shipping_phone = String(req.body.shipping_phone || cust.phone || '0000000000').trim();
    const shipping_address = String(req.body.shipping_address || cust.address || 'Store pickup').trim();
    const shipping_city = String(req.body.shipping_city || cust.city || 'Local').trim();
    const shipping_state = String(req.body.shipping_state || cust.state || 'N/A').trim();
    const shipping_pincode = String(req.body.shipping_pincode || cust.pincode || '000000').trim();
    const notes = String(req.body.notes || '').trim() || null;

    const number = orderNumber();
    const now = new Date();

    // Verify line products belong to this company (ignore any body.companyID)
    for (const item of items) {
      const [owned] = await connection.query(
        'SELECT productID FROM tblProduct WHERE productID = :id AND companyID = :companyID LIMIT 1',
        { id: item.productID, companyID }
      );
      if (!owned.length) {
        throw new Error(`Product not found for this company: ${item.product_name}`);
      }
    }

    const [orderResult] = await connection.query(
      `INSERT INTO tblOrder
       (userID, order_number, order_source, status, fulfillment_status, payment_method, payment_status,
        subtotal, discount, coupon_discount, tax_amount, shipping_fee, round_off, total,
        amount_received, change_amount,
        shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_pincode,
        notes, client_request_id, shipped_at, delivered_at, is_active, stock_reserved, stock_deducted, companyID, branchID)
       VALUES
       (:userId, :orderNumber, 'pos', 'delivered', 'delivered', :paymentMethod, :paymentStatus,
        :subtotal, :discount, :couponDiscount, :taxAmount, :shippingFee, :roundOff, :total,
        :amountReceived, :changeAmount,
        :shippingName, :shippingPhone, :shippingAddress, :shippingCity, :shippingState, :shippingPincode,
        :notes, :clientRequestId, :shippedAt, :deliveredAt, 1, 0, 0, :companyID, :branchID)`,
      {
        userId,
        orderNumber: number,
        paymentMethod: primaryMethod,
        paymentStatus: payment_status,
        subtotal,
        discount,
        couponDiscount: coupon_discount,
        taxAmount: tax_amount,
        shippingFee: shipping_fee,
        roundOff: round_off,
        total,
        amountReceived: amount_received || paidSum,
        changeAmount: change_amount,
        shippingName: shipping_name,
        shippingPhone: shipping_phone,
        shippingAddress: shipping_address,
        shippingCity: shipping_city,
        shippingState: shipping_state,
        shippingPincode: shipping_pincode,
        notes,
        clientRequestId,
        shippedAt: now,
        deliveredAt: now,
        companyID,
        branchID,
      }
    );

    const orderId = orderResult.insertId;

    for (const item of items) {
      await connection.query(
        `INSERT INTO tblOrderItem (orderID, productID, product_name, size, color, quantity, price)
         VALUES (:orderId, :productId, :productName, :size, :color, :quantity, :price)`,
        {
          orderId,
          productId: item.productID,
          productName: item.product_name,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          price: item.price,
        }
      );
    }

    const orderRow = {
      id: orderId,
      order_number: number,
      stock_reserved: 0,
      stock_deducted: 0,
    };

    const flags = await finalizePosSaleStock({
      connection,
      order: orderRow,
      items,
      createdBy: req.user?.id || null,
      reserveStock,
      finalizeReservedSale,
    });

    await connection.query(
      `UPDATE tblOrder SET stock_reserved = :reserved, stock_deducted = :deducted WHERE orderID = :id`,
      {
        reserved: flags.stock_reserved ? 1 : 0,
        deducted: flags.stock_deducted ? 1 : 0,
        id: orderId,
      }
    );

    for (const pay of paymentRows) {
      await connection.query(
        `INSERT INTO tblPosPayment
          (orderID, method, amount, reference_no, status, paid_at, receivedByUserID)
         VALUES
          (:orderId, :method, :amount, :referenceNo, :status, :paidAt, :receivedBy)`,
        {
          orderId,
          method: pay.method,
          amount: pay.amount,
          referenceNo: pay.reference_no,
          status: pay.method === 'credit' ? 'pending' : pay.status,
          paidAt: pay.method === 'credit' || pay.status !== 'paid' ? null : now,
          receivedBy: req.user?.id || null,
        }
      );
    }

    const invNo = invoiceNumber();
    const [billResult] = await connection.query(
      `INSERT INTO tblBilling
        (invoice_no, orderID, customer_name, customer_email, amount, tax, total, status, notes, companyID)
       VALUES
        (:invoiceNo, :orderId, :customerName, :customerEmail, :amount, :tax, :total, :status, :notes, :companyID)`,
      {
        invoiceNo: invNo,
        orderId,
        customerName: shipping_name,
        customerEmail: cust.email || null,
        amount: subtotal,
        tax: tax_amount,
        total,
        status: payment_status === 'paid' ? 'paid' : 'sent',
        notes: `POS ${number}`,
        companyID,
      }
    );

    await connection.query(
      `INSERT INTO tblFinanceEntry
        (entry_date, type, category, amount, reference_no, description, createdByUserID, companyID)
       VALUES
        (:entryDate, 'income', 'POS Sale', :amount, :referenceNo, :description, :createdBy, :companyID)`,
      {
        entryDate: now.toISOString().slice(0, 10),
        amount: payment_status === 'paid' ? total : paidSum,
        referenceNo: invNo,
        description: `POS sale ${number} / ${invNo}`,
        createdBy: req.user?.id || null,
        companyID,
      }
    );

    await logOrderHistory(connection, {
      orderId,
      fromStatus: null,
      toStatus: 'delivered',
      paymentStatus: payment_status,
      fulfillmentStatus: 'delivered',
      note: 'POS checkout completed',
      createdBy: req.user?.id || null,
    });

    await connection.commit();

    const [payments] = await connection.query('SELECT * FROM tblPosPayment WHERE orderID = :id', {
      id: orderId,
    });
    const [billRows] = await connection.query('SELECT * FROM tblBilling WHERE billingID = :id', {
      id: billResult.insertId,
    });
    const [itemRows] = await connection.query('SELECT * FROM tblOrderItem WHERE orderID = :id', {
      id: orderId,
    });

    return ok(
      res,
      {
        orderId,
        orderNumber: number,
        invoice: billRows[0],
        payments,
        items: itemRows,
        totals: {
          subtotal,
          discount,
          coupon_discount,
          tax_amount,
          additional_charges: shipping_fee,
          round_off,
          total,
          amount_received: amount_received || paidSum,
          change_amount,
          outstanding: Math.max(0, Number((total - paidSum).toFixed(2))),
        },
      },
      'POS sale completed',
      201
    );
  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) {
      /* ignore */
    }
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    const msg = err?.message || 'POS checkout failed';
    if (/Insufficient stock|Variant not found|Customer name|Product not found for this company/i.test(msg)) {
      return fail(res, msg, 400);
    }
    if (err?.code === 'ER_DUP_ENTRY') {
      return fail(res, 'Duplicate sale request', 409);
    }
    return fail(res, msg, 500);
  } finally {
    connection.release();
  }
};
