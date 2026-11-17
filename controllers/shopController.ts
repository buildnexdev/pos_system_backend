/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Public shop catalog and product handlers
 * Edit Date: 2026-11-14
 */

import db from '../config/db';
import { ok, fail, effectivePrice  } from '../utils/helpers';
import { getCompanyId } from '../utils/companyScope';

/** Public catalog uses JWT company when present, else first active company. Never trusts body.companyID. */
async function resolvePublicCompanyId(req): Promise<number> {
  const fromUser = getCompanyId(req.user);
  if (fromUser) return fromUser;
  const [rows] = await db.query(
    `SELECT companyID FROM tblCompany WHERE is_active = 1 ORDER BY companyID ASC LIMIT 1`
  );
  if (!rows.length) {
    const [any] = await db.query(`SELECT companyID FROM tblCompany ORDER BY companyID ASC LIMIT 1`);
    if (!any.length) throw new Error('No company configured');
    return Number(any[0].companyID);
  }
  return Number(rows[0].companyID);
}

export const home = async (req, res) => {
  try {
    const companyID = await resolvePublicCompanyId(req);
    const [tblCategory] = await db.query(
      'SELECT * FROM tblCategory WHERE companyID = :companyID ORDER BY name',
      { companyID }
    );
    const [featured] = await db.query(
      `
      SELECT p.*, c.name AS category_name,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
      FROM tblProduct p
      JOIN tblCategory c ON c.categoryID = p.categoryID
      WHERE p.companyID = :companyID AND p.is_active = 1 AND p.is_featured = 1
      ORDER BY p.created_at DESC LIMIT 8
    `,
      { companyID }
    );
    const [latest] = await db.query(
      `
      SELECT p.*, c.name AS category_name,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
      FROM tblProduct p
      JOIN tblCategory c ON c.categoryID = p.categoryID
      WHERE p.companyID = :companyID AND p.is_active = 1
      ORDER BY p.created_at DESC LIMIT 8
    `,
      { companyID }
    );
    return ok(res, { categories: tblCategory, featured, latest });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load home data', 500);
  }
};

export const categories = async (req, res) => {
  try {
    const companyID = await resolvePublicCompanyId(req);
    const [tblCategory] = await db.query(
      'SELECT * FROM tblCategory WHERE companyID = :companyID ORDER BY name',
      { companyID }
    );
    return ok(res, { categories: tblCategory });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load categories', 500);
  }
};

export const products = async (req, res) => {
  try {
    const companyID = await resolvePublicCompanyId(req);
    const { category, q, gender, sort, min, max } = req.query;
    const params: any = { companyID };
    let where = 'WHERE p.companyID = :companyID AND p.is_active = 1';

    if (category) {
      where += ' AND c.slug = :category';
      params.category = category;
    }
    if (gender) {
      where += ' AND p.gender = :gender';
      params.gender = gender;
    }
    if (q) {
      where += ' AND (p.name LIKE :q OR p.description LIKE :q OR p.brand LIKE :q)';
      params.q = `%${q}%`;
    }
    if (min) {
      where += ' AND COALESCE(p.sale_price, p.price) >= :min';
      params.min = Number(min);
    }
    if (max) {
      where += ' AND COALESCE(p.sale_price, p.price) <= :max';
      params.max = Number(max);
    }

    let orderBy = 'p.created_at DESC';
    if (sort === 'price_asc') orderBy = 'COALESCE(p.sale_price, p.price) ASC';
    if (sort === 'price_desc') orderBy = 'COALESCE(p.sale_price, p.price) DESC';
    if (sort === 'name') orderBy = 'p.name ASC';

    const [tblProduct] = await db.query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
       FROM tblProduct p
       JOIN tblCategory c ON c.categoryID = p.categoryID
       ${where}
       ORDER BY ${orderBy}`,
      params
    );

    return ok(res, { products: tblProduct, count: tblProduct.length });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load products', 500);
  }
};

export const productDetail = async (req, res) => {
  try {
    const companyID = await resolvePublicCompanyId(req);
    const [rows] = await db.query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM tblProduct p
       JOIN tblCategory c ON c.categoryID = p.categoryID
       WHERE p.slug = :slug AND p.is_active = 1 AND p.companyID = :companyID LIMIT 1`,
      { slug: req.params.slug, companyID }
    );
    if (!rows.length) return fail(res, 'Product not found', 404);

    const product = rows[0];
    const productId = product.productID ?? product.id;
    const [images] = await db.query(
      'SELECT * FROM tblProductImage WHERE productID = :id ORDER BY is_primary DESC, productImageID ASC',
      { id: productId }
    );
    const [related] = await db.query(
      `SELECT p.*,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image
       FROM tblProduct p
       WHERE p.companyID = :companyID AND p.categoryID = :categoryId AND p.productID <> :id AND p.is_active = 1 LIMIT 4`,
      { companyID, categoryId: product.categoryID, id: productId }
    );

    let inWishlist = false;
    if (req.user) {
      const [wish] = await db.query(
        'SELECT wishlistID AS id FROM tblWishlist WHERE userID = :userId AND productID = :productId',
        { userId: req.user.id, productId }
      );
      inWishlist = wish.length > 0;
    }

    const [variants] = await db.query(
      'SELECT productVariantID AS id, size, color, stock, price, discount, stock_code, barcode, image_url FROM tblProductVariant WHERE productID = :id ORDER BY color, size',
      { id: productId }
    );

    return ok(res, {
      product: {
        ...product,
        effective_price: effectivePrice(product),
        sizes: (product.sizes || '').split(',').map((s) => s.trim()).filter(Boolean),
        colors: (product.colors || '').split(',').map((c) => c.trim()).filter(Boolean),
        variants
      },
      images,
      related,
      inWishlist
    });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load product', 500);
  }
};
