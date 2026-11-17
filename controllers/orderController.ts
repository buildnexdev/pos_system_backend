/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Customer order place/list/detail/cancel handlers
 * Edit Date: 2026-11-12
 */

import db from '../config/db';
import { getCartItems  } from './cartController';
import { ok, fail, orderNumber  } from '../utils/helpers';
import { reserveStock,
  releaseReservedStock,
  finalizeReservedSale,
  restockReturnedSellable,
 } from '../utils/stockService';
import { canTransition,
  fulfillmentFromStatus,
  logOrderHistory,
  applyOrderStockEffects,
 } from '../utils/orderWorkflow';

export const placeOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const cart = await getCartItems(req.user.id);
    if (!cart.items.length) return fail(res, 'Your cart is empty');

    const {
      shipping_name,
      shipping_phone,
      shipping_address,
      shipping_city,
      shipping_state,
      shipping_pincode,
      payment_method,
      notes
    } = req.body;

    if (!shipping_name || !shipping_phone || !shipping_address || !shipping_city || !shipping_state || !shipping_pincode) {
      return fail(res, 'Please fill all shipping details');
    }

    const number = orderNumber();
    const status = 'pending';
    const fulfillment_status = fulfillmentFromStatus(status);
    await connection.beginTransaction();

    const [orderResult] = await connection.query(
      `INSERT INTO tblOrder
       (userID, order_number, order_source, status, fulfillment_status, payment_method, payment_status,
        subtotal, shipping_fee, total,
        shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_pincode, notes)
       VALUES
       (:userId, :orderNumber, 'online', :status, :fulfillmentStatus, :paymentMethod, :paymentStatus,
        :subtotal, :shippingFee, :total,
        :shippingName, :shippingPhone, :shippingAddress, :shippingCity, :shippingState, :shippingPincode, :notes)`,
      {
        userId: req.user.id,
        orderNumber: number,
        status,
        fulfillmentStatus: fulfillment_status,
        paymentMethod: payment_method === 'online' ? 'online' : 'cod',
        paymentStatus: payment_method === 'online' ? 'paid' : 'pending',
        subtotal: cart.subtotal,
        shippingFee: cart.shipping,
        total: cart.total,
        shippingName: shipping_name,
        shippingPhone: shipping_phone,
        shippingAddress: shipping_address,
        shippingCity: shipping_city,
        shippingState: shipping_state,
        shippingPincode: shipping_pincode,
        notes: notes || null
      }
    );

    for (const item of cart.items) {
      await connection.query(
        `INSERT INTO tblOrderItem (orderID, productID, product_name, size, color, quantity, price)
         VALUES (:orderId, :productId, :productName, :size, :color, :quantity, :price)`,
        {
          orderId: orderResult.insertId,
          productId: item.productID,
          productName: item.name,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          price: item.unitPrice
        }
      );
    }

    // Pending only — stock reserved when panel/admin confirms
    await logOrderHistory(connection, {
      orderId: orderResult.insertId,
      fromStatus: null,
      toStatus: status,
      paymentStatus: payment_method === 'online' ? 'paid' : 'pending',
      fulfillmentStatus: fulfillment_status,
      note: 'Online order placed',
      createdBy: req.user.id,
    });

    await connection.query('DELETE FROM tblCartItem WHERE userID = :userId', { userId: req.user.id });
    await connection.commit();

    return ok(res, { orderId: orderResult.insertId, orderNumber: number }, 'Order placed successfully', 201);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return fail(res, err.message || 'Could not place order', 500);
  } finally {
    connection.release();
  }
};

export const myOrders = async (req, res) => {
  try {
    const [tblOrder] = await db.query(
      'SELECT * FROM tblOrder WHERE userID = :userId ORDER BY created_at DESC',
      { userId: req.user.id }
    );
    return ok(res, { orders: tblOrder });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load orders', 500);
  }
};

export const orderDetail = async (req, res) => {
  try {
    const [tblOrder] = await db.query(
      'SELECT * FROM tblOrder WHERE orderID = :id AND userID = :userId',
      { id: req.params.id, userId: req.user.id }
    );
    if (!tblOrder.length) return fail(res, 'Order not found', 404);

    const [items] = await db.query(
      `SELECT oi.*,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = oi.productID AND pi.is_primary = 1 LIMIT 1) AS image
       FROM tblOrderItem oi WHERE oi.orderID = :orderId`,
      { orderId: tblOrder[0].id }
    );

    return ok(res, { order: tblOrder[0], items });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load order', 500);
  }
};

export const cancelOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [tblOrder] = await connection.query(
      `SELECT * FROM tblOrder WHERE orderID = :id AND userID = :userId`,
      { id: req.params.id, userId: req.user.id }
    );
    if (!tblOrder.length) return fail(res, 'Order not found', 404);
    const previous = tblOrder[0];
    if (!canTransition(previous.status, 'cancelled')) {
      return fail(res, 'Order cannot be cancelled at this stage');
    }

    await connection.beginTransaction();
    const [items] = await connection.query(
      'SELECT productID, size, color, quantity FROM tblOrderItem WHERE orderID = :orderId',
      { orderId: previous.id }
    );

    const flags = await applyOrderStockEffects({
      connection,
      order: previous,
      items,
      nextStatus: 'cancelled',
      createdBy: req.user.id,
      reserveStock,
      releaseReservedStock,
      finalizeReservedSale,
      restockReturnedSellable,
    });

    const paymentStatus =
      previous.payment_status === 'paid' ? 'refund_pending' : previous.payment_status;
    const fulfillment = fulfillmentFromStatus('cancelled');

    await connection.query(
      `UPDATE tblOrder SET
        status = 'cancelled',
        fulfillment_status = :fulfillment,
        payment_status = :paymentStatus,
        cancellation_reason = :reason,
        stock_reserved = :stockReserved,
        stock_deducted = :stockDeducted,
        return_restocked = :returnRestocked
       WHERE orderID = :id`,
      {
        fulfillment,
        paymentStatus,
        reason: req.body.reason || req.body.cancellation_reason || 'Customer cancelled',
        stockReserved: flags.stock_reserved,
        stockDeducted: flags.stock_deducted,
        returnRestocked: flags.return_restocked,
        id: previous.id,
      }
    );

    await logOrderHistory(connection, {
      orderId: previous.id,
      fromStatus: previous.status,
      toStatus: 'cancelled',
      paymentStatus,
      fulfillmentStatus: fulfillment,
      note: 'Customer cancelled order',
      createdBy: req.user.id,
    });

    await connection.commit();
    return ok(res, {}, 'Order cancelled');
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return fail(res, err.message || 'Could not cancel order', 500);
  } finally {
    connection.release();
  }
};
