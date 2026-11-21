/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Order status workflow and POS stock finalization
 * Edit Date: 2026-11-12
 */

const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'return_requested',
  'returned',
  'refund_pending',
  'refunded',
];

const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refund_pending', 'refunded'];
const ORDER_SOURCES = ['online', 'pos', 'admin'];
const REFUND_STATUSES = ['none', 'pending', 'completed', 'failed'];

const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'return_requested', 'returned'],
  delivered: ['return_requested', 'returned', 'cancelled'],
  cancelled: [],
  return_requested: ['returned', 'cancelled'],
  returned: ['refund_pending'],
  refund_pending: ['refunded'],
  refunded: [],
};

function fulfillmentFromStatus(status) {
  switch (status) {
    case 'processing':
      return 'processing';
    case 'packed':
      return 'packed';
    case 'shipped':
      return 'shipped';
    case 'delivered':
      return 'delivered';
    case 'returned':
    case 'return_requested':
      return 'returned';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unfulfilled';
  }
}

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

function calcGrandTotal({ subtotal = 0, discount = 0, coupon_discount = 0, tax_amount = 0, shipping_fee = 0 }) {
  const base = Math.max(0, Number(subtotal) || 0);
  const disc = Math.max(0, Number(discount) || 0);
  const coupon = Math.max(0, Number(coupon_discount) || 0);
  const tax = Math.max(0, Number(tax_amount) || 0);
  const ship = Math.max(0, Number(shipping_fee) || 0);
  return Number(Math.max(0, base - disc - coupon + tax + ship).toFixed(2));
}

async function logOrderHistory(executor, {
  orderId,
  fromStatus = null,
  toStatus,
  paymentStatus = null,
  fulfillmentStatus = null,
  note = null,
  createdBy = null,
}) {
  await executor.query(
    `INSERT INTO tblOrderStatusHistory
      (orderID, from_status, to_status, payment_status, fulfillment_status, note, createdByUserID)
     VALUES
      (:orderId, :fromStatus, :toStatus, :paymentStatus, :fulfillmentStatus, :note, :createdBy)`,
    {
      orderId,
      fromStatus,
      toStatus,
      paymentStatus,
      fulfillmentStatus,
      note,
      createdBy,
    }
  );
}

/**
 * Apply idempotent stock side-effects for a status transition.
 * Returns flag patches: { stock_reserved, stock_deducted, return_restocked }
 */
async function applyOrderStockEffects({
  connection,
  order,
  items,
  nextStatus,
  inspectionDone = false,
  createdBy = null,
  reserveStock,
  releaseReservedStock,
  finalizeReservedSale,
  restockReturnedSellable,
}) {
  const flags = {
    stock_reserved: Number(order.stock_reserved) ? 1 : 0,
    stock_deducted: Number(order.stock_deducted) ? 1 : 0,
    return_restocked: Number(order.return_restocked) ? 1 : 0,
  };

  const shouldReserve =
    ['confirmed', 'processing', 'packed'].includes(nextStatus) && !flags.stock_reserved && !flags.stock_deducted;
  const shouldRelease =
    nextStatus === 'cancelled' && flags.stock_reserved && !flags.stock_deducted;
  const shouldFinalize = nextStatus === 'shipped' && !flags.stock_deducted;
  const shouldRestock =
    ((nextStatus === 'returned' && inspectionDone) ||
      (nextStatus === 'cancelled' && flags.stock_deducted)) &&
    !flags.return_restocked;

  if (shouldReserve) {
    for (const item of items) {
      await reserveStock(
        {
          productId: item.productID,
          size: item.size,
          color: item.color,
          qty: item.quantity,
          refType: 'order',
          refId: order.id,
          note: `Reserve for order ${order.order_number}`,
          createdBy,
        },
        connection
      );
    }
    flags.stock_reserved = 1;
  }

  if (shouldRelease) {
    for (const item of items) {
      await releaseReservedStock(
        {
          productId: item.productID,
          size: item.size,
          color: item.color,
          qty: item.quantity,
          refType: 'order',
          refId: order.id,
          note: `Release reserve for cancelled order ${order.order_number}`,
          createdBy,
        },
        connection
      );
    }
    flags.stock_reserved = 0;
  }

  if (shouldFinalize) {
    // Ensure reserve exists for confirm→…→ship skip paths
    if (!flags.stock_reserved) {
      for (const item of items) {
        try {
          await reserveStock(
            {
              productId: item.productID,
              size: item.size,
              color: item.color,
              qty: item.quantity,
              refType: 'order',
              refId: order.id,
              note: `Auto-reserve before ship ${order.order_number}`,
              createdBy,
            },
            connection
          );
        } catch (e) {
          // allow finalize fallback inside finalizeReservedSale
        }
      }
      flags.stock_reserved = 1;
    }
    for (const item of items) {
      await finalizeReservedSale(
        {
          productId: item.productID,
          size: item.size,
          color: item.color,
          qty: item.quantity,
          refType: 'order',
          refId: order.id,
          note: `Ship finalize ${order.order_number}`,
          createdBy,
          allowNegative: true,
        },
        connection
      );
    }
    flags.stock_deducted = 1;
    flags.stock_reserved = 0;
  }

  if (shouldRestock) {
    const orderRef = order.orderID || order.id;
    for (const item of items) {
      await restockReturnedSellable(
        {
          productId: item.productID,
          size: item.size,
          color: item.color,
          qty: item.quantity,
          refType: 'order',
          refId: orderRef,
          note:
            nextStatus === 'cancelled'
              ? `Cancel restock ${order.order_number}`
              : `Return restock after inspection ${order.order_number}`,
          createdBy,
        },
        connection
      );
    }
    flags.return_restocked = 1;
  }

  return flags;
}

/**
 * POS one-shot: reserve then finalize (or sale fallback) in a single checkout.
 * Idempotent via order.stock_deducted / stock_reserved flags.
 */
async function finalizePosSaleStock({
  connection,
  order,
  items,
  createdBy = null,
  reserveStock,
  finalizeReservedSale,
}) {
  const flags = {
    stock_reserved: Number(order.stock_reserved) ? 1 : 0,
    stock_deducted: Number(order.stock_deducted) ? 1 : 0,
  };

  if (flags.stock_deducted) {
    return flags;
  }

  if (!flags.stock_reserved) {
    for (const item of items) {
      await reserveStock(
        {
          productId: item.productID,
          size: item.size,
          color: item.color,
          qty: item.quantity,
          refType: 'order',
          refId: order.id,
          note: `POS reserve ${order.order_number}`,
          createdBy,
        },
        connection
      );
    }
    flags.stock_reserved = 1;
  }

  for (const item of items) {
    await finalizeReservedSale(
      {
        productId: item.productID,
        size: item.size,
        color: item.color,
        qty: item.quantity,
        refType: 'order',
        refId: order.id,
        note: `POS sale ${order.order_number}`,
        createdBy,
        allowNegative: false,
      },
      connection
    );
  }

  flags.stock_deducted = 1;
  flags.stock_reserved = 0;
  return flags;
}

function calcPosGrandTotal({
  subtotal = 0,
  discount = 0,
  coupon_discount = 0,
  tax_amount = 0,
  shipping_fee = 0,
  round_off = 0,
}) {
  const base = calcGrandTotal({ subtotal, discount, coupon_discount, tax_amount, shipping_fee });
  return Number((base + (Number(round_off) || 0)).toFixed(2));
}

export { ORDER_STATUSES, PAYMENT_STATUSES, ORDER_SOURCES, REFUND_STATUSES, ALLOWED_TRANSITIONS, fulfillmentFromStatus, canTransition, calcGrandTotal, calcPosGrandTotal, logOrderHistory, applyOrderStockEffects, finalizePosSaleStock };
