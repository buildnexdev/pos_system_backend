/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Shopping cart API handlers
 * Edit Date: 2026-11-12
 */

import db from '../config/db';
import { ok, fail, effectivePrice  } from '../utils/helpers';

export async function getCartItems(userId) {
  const [items] = await db.query(
    `SELECT ci.*, p.name, p.slug, p.price, p.sale_price, p.stock AS product_stock,
      COALESCE(pv.stock, p.stock) AS stock,
      pv.productVariantID AS productVariantID,
      (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
     FROM tblCartItem ci
     JOIN tblProduct p ON p.productID = ci.productID
     LEFT JOIN tblProductVariant pv
       ON pv.productID = ci.productID AND pv.size = ci.size AND pv.color = ci.color
     WHERE ci.userID = :userId
     ORDER BY ci.created_at DESC`,
    { userId }
  );

  const mapped = items.map((item) => {
    const unit = effectivePrice(item);
    return { ...item, unitPrice: unit, lineTotal: unit * item.quantity };
  });

  const subtotal = mapped.reduce((sum, item) => sum + item.lineTotal, 0);
  const shipping = subtotal >= 999 || subtotal === 0 ? 0 : 49;
  return { items: mapped, subtotal, shipping, total: subtotal + shipping, count: mapped.reduce((n, i) => n + i.quantity, 0) };
}

export const viewCart = async (req, res) => {
  try {
    const cart = await getCartItems(req.user.id);
    return ok(res, { cart });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load cart', 500);
  }
};

export const addToCart = async (req, res) => {
  try {
    const productId = Number(req.body.product_id ?? (req.body.product_id ?? req.body.productID));
    const quantity = Math.max(1, Number(req.body.quantity) || 1);
    const size = req.body.size || 'M';
    const color = req.body.color || 'Black';

    const [tblProduct] = await db.query(
      'SELECT id, stock, name FROM tblProduct WHERE productID = :id AND is_active = 1',
      { id: productId }
    );
    if (!tblProduct.length) return fail(res, 'Product not available');

    const [variants] = await db.query(
      `SELECT id, stock FROM tblProductVariant
       WHERE productID = :productId AND size = :size AND color = :color LIMIT 1`,
      { productId, size, color }
    );
    const available = variants.length ? Number(variants[0].stock) : Number(tblProduct[0].stock);

    const [existing] = await db.query(
      `SELECT cartItemID AS id, cartItemID, quantity FROM tblCartItem
       WHERE userID = :userId AND productID = :productId AND size = :size AND color = :color`,
      { userId: req.user.id, productId, size, color }
    );

    if (existing.length) {
      const newQty = existing[0].quantity + quantity;
      if (newQty > available) return fail(res, 'Not enough stock');
      await db.query('UPDATE tblCartItem SET quantity = :qty WHERE cartItemID = :id', {
        qty: newQty,
        id: (existing[0].cartItemID ?? existing[0].id)
      });
    } else {
      if (quantity > available) return fail(res, 'Not enough stock');
      await db.query(
        `INSERT INTO tblCartItem (userID, productID, size, color, quantity)
         VALUES (:userId, :productId, :size, :color, :quantity)`,
        { userId: req.user.id, productId, size, color, quantity }
      );
    }

    const cart = await getCartItems(req.user.id);
    return ok(res, { cart }, 'Added to cart');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not add to cart', 500);
  }
};

export const updateCart = async (req, res) => {
  try {
    const itemId = Number(req.params.id || req.body.item_id);
    const qty = Math.max(1, Number(req.body.quantity) || 1);
    await db.query(
      'UPDATE tblCartItem SET quantity = :qty WHERE cartItemID = :id AND userID = :userId',
      { qty, id: itemId, userId: req.user.id }
    );
    const cart = await getCartItems(req.user.id);
    return ok(res, { cart }, 'Cart updated');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not update cart', 500);
  }
};

export const removeFromCart = async (req, res) => {
  try {
    await db.query('DELETE FROM tblCartItem WHERE cartItemID = :id AND userID = :userId', {
      id: req.params.id,
      userId: req.user.id
    });
    const cart = await getCartItems(req.user.id);
    return ok(res, { cart }, 'Item removed');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not remove item', 500);
  }
};

