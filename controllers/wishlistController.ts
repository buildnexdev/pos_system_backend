/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Customer tblWishlist API handlers
 * Edit Date: 2026-11-12
 */

import db from '../config/db';
import { ok, fail  } from '../utils/helpers';

export const viewWishlist = async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT w.warehouseID AS wish_id, p.*,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
       FROM tblWishlist w
       JOIN tblProduct p ON p.productID = w.productID
       WHERE w.userID = :userId
       ORDER BY w.created_at DESC`,
      { userId: req.user.id }
    );
    return ok(res, { items });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load tblWishlist', 500);
  }
};

export const toggleWishlist = async (req, res) => {
  try {
    const productId = Number((req.body.product_id ?? req.body.productID));
    const [existing] = await db.query(
      'SELECT wishlistID AS id FROM tblWishlist WHERE userID = :userId AND productID = :productId',
      { userId: req.user.id, productId }
    );

    if (existing.length) {
      await db.query('DELETE FROM tblWishlist WHERE wishlistID = :id', { id: existing[0].id });
      return ok(res, { inWishlist: false }, 'Removed from tblWishlist');
    }

    await db.query(
      'INSERT INTO tblWishlist (userID, productID) VALUES (:userId, :productId)',
      { userId: req.user.id, productId }
    );
    return ok(res, { inWishlist: true }, 'Added to tblWishlist');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not update tblWishlist', 500);
  }
};

export const removeWishlist = async (req, res) => {
  try {
    await db.query('DELETE FROM tblWishlist WHERE wishlistID = :id AND userID = :userId', {
      id: req.params.id,
      userId: req.user.id
    });
    return ok(res, {}, 'Removed from tblWishlist');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not remove item', 500);
  }
};
