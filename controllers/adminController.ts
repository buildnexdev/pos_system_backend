/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Admin dashboard, tblProduct, stock and tblOrder
 * Edit Date: 2026-11-14
 */

import bcrypt from 'bcryptjs';
import db from '../config/db';
import { ok, fail, slugify, orderNumber  } from '../utils/helpers';
import { USER_ROLE_JOIN, SQL_CUSTOMER_USER } from '../config/userRole';
import { getRoleId } from '../utils/roleLookup';
import { requireCompanyId, CompanyScopeError } from '../utils/companyScope';
import { applyStockChange,
  listStockHistory,
  listLowStock,
  listStockItems,
  stockReport,
  listWarehouses as listWarehousesService,
  ensureInventoryForVariant,
  computeStockStatus,
  syncProductStock,
  refreshStockStatus,
  getDefaultWarehouse,
  reserveStock,
  releaseReservedStock,
  finalizeReservedSale,
  restockReturnedSellable,
 } from '../utils/stockService';
import { ORDER_STATUSES,
  PAYMENT_STATUSES,
  ORDER_SOURCES,
  REFUND_STATUSES,
  canTransition,
  fulfillmentFromStatus,
  calcGrandTotal,
  logOrderHistory,
  applyOrderStockEffects,
 } from '../utils/orderWorkflow';

export const dashboard = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [[stats]] = await db.query(
      `
      SELECT
        (SELECT COUNT(*) FROM tblProduct WHERE companyID = :companyID) AS products,
        (SELECT COUNT(*) FROM tblOrder WHERE companyID = :companyID) AS orders,
        (SELECT COUNT(*) FROM tblUser u LEFT JOIN tblRole r ON r.roleID = u.roleID
          WHERE u.companyID = :companyID
            AND (r.RoleCode = 'customer' OR r.Level >= 90 OR u.roleID IS NULL)) AS customers,
        (SELECT COALESCE(SUM(total), 0) FROM tblOrder
          WHERE companyID = :companyID AND status <> 'cancelled') AS revenue
    `,
      { companyID }
    );
    const [recentOrders] = await db.query(
      `
      SELECT o.*, u.name AS customer_name
      FROM tblOrder o JOIN tblUser u ON u.userID = o.userID
      WHERE o.companyID = :companyID
      ORDER BY o.created_at DESC LIMIT 8
    `,
      { companyID }
    );
    const lowStock = await listLowStock({ limit: 8, companyID });
    return ok(res, { stats, recentOrders, lowStock });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load dashboard', 500);
  }
};

export const products = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [tblProduct] = await db.query(
      `
      SELECT p.*, c.name AS category_name, s.name AS supplier_name, pt.name AS product_type_name,
        (SELECT image_url FROM tblProductImage pi WHERE pi.productID = p.productID AND pi.is_primary = 1 LIMIT 1) AS image,
        (SELECT COUNT(*) FROM tblProductVariant pv WHERE pv.productID = p.productID) AS variant_count
      FROM tblProduct p
      JOIN tblCategory c ON c.categoryID = p.categoryID
      LEFT JOIN tblSupplier s ON s.supplierID = p.supplierID
      LEFT JOIN tblProductType pt ON pt.productTypeID = p.productTypeID
      WHERE p.companyID = :companyID
      ORDER BY p.created_at DESC
    `,
      { companyID }
    );

    if (tblProduct.length) {
      const ids = tblProduct.map((p) => p.productID);
      const [variants] = await db.query(
        `SELECT * FROM tblProductVariant WHERE productID IN (${ids.map(() => '?').join(',')})
         ORDER BY color, size`,
        ids
      );
      const byProduct: any = {};
      for (const v of variants) {
        if (!byProduct[v.productID]) byProduct[v.productID] = [];
        byProduct[v.productID].push(v);
      }
      for (const p of tblProduct) {
        p.variants = byProduct[p.productID] || [];
      }
    }

    return ok(res, { products: tblProduct });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load products', 500);
  }
};

export const getProduct = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [rows] = await db.query(
      'SELECT * FROM tblProduct WHERE productID = :id AND companyID = :companyID',
      { id: req.params.id, companyID }
    );
    if (!rows.length) return fail(res, 'Product not found', 404);
    const [images] = await db.query('SELECT * FROM tblProductImage WHERE productID = :id', {
      id: rows[0].id
    });
    const [variants] = await db.query(
      'SELECT * FROM tblProductVariant WHERE productID = :id ORDER BY color, size',
      { id: rows[0].id }
    );
    return ok(res, { product: { ...rows[0], variants }, images, variants });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load product', 500);
  }
};

export const saveProduct = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const catalogMode = req.body.catalog_mode === true || req.body.catalog_mode === 1 || req.body.catalog_mode === '1';
    const variantsInput = Array.isArray(req.body.variants) ? req.body.variants : [];
    const cleanedVariants = variantsInput
      .map((v) => ({
        size: String(v.size || '').trim(),
        color: String(v.color || '').trim(),
        stock:
          v.stock === undefined || v.stock === null || v.stock === ''
            ? null
            : Number(v.stock) || 0,
        price: v.price === '' || v.price == null ? null : Number(v.price),
        discount: v.discount === '' || v.discount == null ? 0 : Number(v.discount),
        stock_code: String(v.stock_code || v.sku || '').trim() || null,
        barcode: String(v.barcode || v.stock_code || v.sku || '').trim() || null,
        image_url: String(v.image_url || '').trim() || null,
        is_active: v.is_active === false || v.is_active === 0 || v.is_active === '0' ? 0 : 1,
      }))
      .filter((v) => v.size && v.color);

    const sizes = [...new Set(cleanedVariants.map((v) => v.size))];
    const colors = [...new Set(cleanedVariants.map((v) => v.color))];
    const knownStock = cleanedVariants
      .filter((v) => v.stock != null)
      .reduce((sum, v) => sum + (Number(v.stock) || 0), 0);

    let productId = req.params.id ? Number(req.params.id) : null;
    let existingProduct = null;
    if (productId) {
      const [rows] = await db.query(
        'SELECT * FROM tblProduct WHERE productID = :id AND companyID = :companyID',
        { id: productId, companyID }
      );
      existingProduct = rows[0] || null;
      if (!existingProduct) return fail(res, 'Product not found', 404);
    }

    const minStock =
      req.body.min_stock === '' || req.body.min_stock == null
        ? existingProduct?.min_stock ?? 10
        : Number(req.body.min_stock);
    const stockValue = cleanedVariants.length
      ? catalogMode && productId
        ? existingProduct?.stock ?? 0
        : knownStock
      : req.body.stock === undefined || req.body.stock === null || req.body.stock === ''
        ? existingProduct?.stock ?? 0
        : Number(req.body.stock) || 0;

    const discountType = req.body.discount_type === 'fixed' ? 'fixed' : 'percent';
    const discountValue =
      req.body.discount_value === '' || req.body.discount_value == null
        ? Number(req.body.discount_percent) || 0
        : Number(req.body.discount_value) || 0;

    const data = {
      categoryID: Number((req.body.category_id ?? req.body.categoryID)),
      subcategory: req.body.subcategory || null,
      productTypeID: (req.body.productTypeID ?? req.body.product_type_id)
        ? Number(req.body.productTypeID ?? req.body.product_type_id)
        : null,
      name: req.body.name,
      slug: slugify(req.body.slug || req.body.name),
      description: req.body.description || '',
      price: Number(req.body.price),
      purchase_price:
        req.body.purchase_price === '' || req.body.purchase_price == null
          ? null
          : Number(req.body.purchase_price),
      sale_price: req.body.sale_price ? Number(req.body.sale_price) : null,
      discount_percent: discountType === 'percent' ? discountValue : Number(req.body.discount_percent) || 0,
      discount_type: discountType,
      discount_value: discountValue,
      sku: req.body.sku,
      stock_code: req.body.stock_code || req.body.sku || null,
      barcode: req.body.barcode || req.body.stock_code || req.body.sku || null,
      hsn_code: req.body.hsn_code || null,
      gst_rate: req.body.gst_rate === '' || req.body.gst_rate == null ? 0 : Number(req.body.gst_rate),
      tax_inclusive: req.body.tax_inclusive === false || req.body.tax_inclusive === 0 ? 0 : 1,
      stock: stockValue,
      min_stock: Number.isFinite(Number(minStock)) ? Number(minStock) : 10,
      reorder_qty:
        req.body.reorder_qty === undefined || req.body.reorder_qty === null || req.body.reorder_qty === ''
          ? existingProduct?.reorder_qty ?? 0
          : Number(req.body.reorder_qty) || 0,
      warehouse:
        req.body.warehouse === undefined
          ? existingProduct?.warehouse ?? null
          : req.body.warehouse || null,
      stock_status:
        req.body.stock_status ||
        computeStockStatus(stockValue, Number.isFinite(Number(minStock)) ? Number(minStock) : 10),
      sizes: sizes.length ? sizes.join(',') : req.body.sizes || existingProduct?.sizes || 'S,M,L,XL',
      colors: colors.length ? colors.join(',') : req.body.colors || existingProduct?.colors || 'Black,White',
      brand: req.body.brand || 'BuildNex ShopOS',
      gender: req.body.gender || 'unisex',
      fabric: req.body.fabric || null,
      material: req.body.material || null,
      pattern: req.body.pattern || null,
      fit_type: req.body.fit_type || null,
      sleeve_type: req.body.sleeve_type || null,
      neck_type: req.body.neck_type || null,
      occasion: req.body.occasion || null,
      season: req.body.season || null,
      country_of_origin: req.body.country_of_origin || null,
      supplierID: (req.body.supplier_id ?? req.body.supplierID) ? Number((req.body.supplier_id ?? req.body.supplierID)) : null,
      is_featured: req.body.is_featured ? 1 : 0,
      is_active: req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
      publish_online: req.body.publish_online === false || req.body.publish_online === 0 ? 0 : 1,
      is_new_arrival: req.body.is_new_arrival ? 1 : 0,
      is_best_seller: req.body.is_best_seller ? 1 : 0,
      visibility: ['public', 'hidden', 'scheduled'].includes(req.body.visibility)
        ? req.body.visibility
        : 'public',
      seo_title: req.body.seo_title || null,
      seo_description: req.body.seo_description || null,
      companyID,
    };

    // Fail early with a clear message (global UNIQUE on sku / slug / stock_code)
    {
      const [skuHits] = await db.query(
        `SELECT productID FROM tblProduct
         WHERE sku = :sku AND (:id IS NULL OR productID <> :id) LIMIT 1`,
        { sku: data.sku, id: productId }
      );
      if (skuHits.length) {
        return fail(res, `SKU already exists: ${data.sku}. Generate a new product code and try again.`, 409);
      }
      const [slugHits] = await db.query(
        `SELECT productID FROM tblProduct
         WHERE slug = :slug AND (:id IS NULL OR productID <> :id) LIMIT 1`,
        { slug: data.slug, id: productId }
      );
      if (slugHits.length) {
        return fail(res, `Product slug already exists: "${data.slug}". Change the product name and try again.`, 409);
      }
      if (data.stock_code) {
        const [codeHits] = await db.query(
          `SELECT productID FROM tblProduct
           WHERE stock_code = :stock_code AND (:id IS NULL OR productID <> :id) LIMIT 1`,
          { stock_code: data.stock_code, id: productId }
        );
        if (codeHits.length) {
          return fail(res, `Stock code already exists: ${data.stock_code}. Generate a new product code and try again.`, 409);
        }
      }
    }

    if (productId) {
      await db.query(
        `UPDATE tblProduct SET categoryID=:categoryID, subcategory=:subcategory, productTypeID=:productTypeID, name=:name, slug=:slug, description=:description,
         price=:price, purchase_price=:purchase_price, sale_price=:sale_price, discount_percent=:discount_percent, discount_type=:discount_type, discount_value=:discount_value,
         sku=:sku, stock_code=:stock_code, barcode=:barcode, hsn_code=:hsn_code, gst_rate=:gst_rate, tax_inclusive=:tax_inclusive,
         stock=:stock, min_stock=:min_stock, reorder_qty=:reorder_qty, warehouse=:warehouse, stock_status=:stock_status,
         sizes=:sizes, colors=:colors, brand=:brand, gender=:gender, fabric=:fabric, material=:material, pattern=:pattern,
         fit_type=:fit_type, sleeve_type=:sleeve_type, neck_type=:neck_type, occasion=:occasion, season=:season, country_of_origin=:country_of_origin,
         supplierID=:supplierID, is_featured=:is_featured, is_active=:is_active, publish_online=:publish_online,
         is_new_arrival=:is_new_arrival, is_best_seller=:is_best_seller, visibility=:visibility, seo_title=:seo_title, seo_description=:seo_description
         WHERE productID = :id AND companyID = :companyID`,
        { ...data, id: productId }
      );
    } else {
      const [result] = await db.query(
        `INSERT INTO tblProduct
         (categoryID, subcategory, productTypeID, name, slug, description, price, purchase_price, sale_price, discount_percent, discount_type, discount_value,
          sku, stock_code, barcode, hsn_code, gst_rate, tax_inclusive, stock, min_stock, reorder_qty, warehouse, stock_status, sizes, colors, brand, gender, fabric,
          material, pattern, fit_type, sleeve_type, neck_type, occasion, season, country_of_origin,
          supplierID, is_featured, is_active, publish_online, is_new_arrival, is_best_seller, visibility, seo_title, seo_description, companyID)
         VALUES
         (:categoryID, :subcategory, :productTypeID, :name, :slug, :description, :price, :purchase_price, :sale_price, :discount_percent, :discount_type, :discount_value,
          :sku, :stock_code, :barcode, :hsn_code, :gst_rate, :tax_inclusive, :stock, :min_stock, :reorder_qty, :warehouse, :stock_status, :sizes, :colors, :brand, :gender, :fabric,
          :material, :pattern, :fit_type, :sleeve_type, :neck_type, :occasion, :season, :country_of_origin,
          :supplierID, :is_featured, :is_active, :publish_online, :is_new_arrival, :is_best_seller, :visibility, :seo_title, :seo_description, :companyID)`,
        data
      );
      productId = result.insertId;
    }

    if (variantsInput.length || !catalogMode) {
      const [existingVariants] = await db.query(
        'SELECT productVariantID AS id, size, color, stock FROM tblProductVariant WHERE productID = :id',
        { id: productId }
      );
      const existingMap = new Map<string, any>(
        (existingVariants || []).map((v) => [`${v.size}::${v.color}`, v])
      );
      const keepIds = [];

      for (const [index, v] of cleanedVariants.entries()) {
        const code = v.stock_code || `${data.stock_code || data.sku}-${String(index + 1).padStart(2, '0')}`;
        const key = `${v.size}::${v.color}`;
        const existing = existingMap.get(key);
        const nextStock =
          v.stock == null ? (existing ? Number(existing.stock) || 0 : 0) : Number(v.stock) || 0;

        if (existing) {
          await db.query(
            `UPDATE tblProductVariant
             SET stock=:stock, price=:price, discount=:discount, stock_code=:stock_code, barcode=:barcode, image_url=:image_url, is_active=:is_active
             WHERE productVariantID=:id AND productID=:productId`,
            {
              id: existing.id,
              productId,
              // Catalog must never overwrite tblInventory qty managed by Stock module
              stock: catalogMode ? Number(existing.stock) || 0 : nextStock,
              price: v.price,
              discount: v.discount || 0,
              stock_code: code,
              barcode: v.barcode || code,
              image_url: v.image_url,
              is_active: v.is_active,
            }
          );
          keepIds.push(existing.id);
          await ensureInventoryForVariant(db, { id: existing.id, productID: productId }).catch(() => null);
        } else {
          const [inserted] = await db.query(
            `INSERT INTO tblProductVariant (productID, size, color, stock, price, discount, stock_code, barcode, image_url, is_active)
             VALUES (:productId, :size, :color, :stock, :price, :discount, :stock_code, :barcode, :image_url, :is_active)`,
            {
              productId,
              size: v.size,
              color: v.color,
              stock: catalogMode ? 0 : nextStock,
              price: v.price,
              discount: v.discount || 0,
              stock_code: code,
              barcode: v.barcode || code,
              image_url: v.image_url,
              is_active: v.is_active,
            }
          );
          keepIds.push(inserted.insertId);
          await ensureInventoryForVariant(db, {
            id: inserted.insertId,
            productID: productId,
          }).catch(() => null);
        }
      }

      if (cleanedVariants.length) {
        if (keepIds.length) {
          await db.query(
            `DELETE FROM tblProductVariant
             WHERE productID = ? AND productVariantID NOT IN (${keepIds.map(() => '?').join(',')})`,
            [productId, ...keepIds]
          );
        } else {
          await db.query('DELETE FROM tblProductVariant WHERE productID = :id', { id: productId });
        }
      }
    }

    await syncProductStock(db, productId);
    await refreshStockStatus(db, productId);

    if (req.body.image_url) {
      await db.query('UPDATE tblProductImage SET is_primary = 0 WHERE productID = :id', { id: productId });
      await db.query(
        `INSERT INTO tblProductImage (productID, image_url, is_primary)
         VALUES (:productId, :imageUrl, 1)`,
        { productId, imageUrl: req.body.image_url }
      );
    }

    if (Array.isArray(req.body.gallery_images)) {
      const gallery = req.body.gallery_images
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .filter((url) => url !== String(req.body.image_url || '').trim());
      await db.query('DELETE FROM tblProductImage WHERE productID = :id AND is_primary = 0', {
        id: productId,
      });
      for (const imageUrl of gallery) {
        await db.query(
          `INSERT INTO tblProductImage (productID, image_url, is_primary)
           VALUES (:productId, :imageUrl, 0)`,
          { productId, imageUrl }
        );
      }
    }

    return ok(res, { productId }, 'Product saved');
  } catch (err: any) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    if (err?.code === 'ER_DUP_ENTRY') {
      const detail = String(err.sqlMessage || '');
      if (detail.includes('sku')) return fail(res, 'SKU already exists. Generate a new product code.', 409);
      if (detail.includes('slug')) return fail(res, 'Product slug already exists. Change the product name.', 409);
      if (detail.includes('stock_code')) return fail(res, 'Stock code already exists. Generate a new product code.', 409);
      return fail(res, 'Duplicate value — check SKU, slug or stock code uniqueness.', 409);
    }
    return fail(res, err?.sqlMessage || err?.message || 'Could not save product.', 500);
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = req.params.id;
    const [owned] = await db.query(
      'SELECT productID FROM tblProduct WHERE productID = :id AND companyID = :companyID',
      { id, companyID }
    );
    if (!owned.length) return fail(res, 'Product not found', 404);
    const [[tblOrder]] = await db.query(
      `SELECT COUNT(*) AS c FROM tblOrderItem WHERE productID = :id`,
      { id }
    );
    const [[moves]] = await db.query(
      `SELECT COUNT(*) AS c FROM tblStockMovement WHERE productID = :id`,
      { id }
    );
    if (Number(tblOrder.c) > 0 || Number(moves.c) > 0) {
      return fail(
        res,
        'Cannot delete: product has order or stock history. Set status to Inactive instead.',
        400,
        { has_orders: Number(tblOrder.c) > 0, has_movements: Number(moves.c) > 0 }
      );
    }
    await db.query('DELETE FROM tblProduct WHERE productID = :id AND companyID = :companyID', {
      id,
      companyID,
    });
    return ok(res, {}, 'Product deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete product', 500);
  }
};

async function ensureCompanyCategories(companyID: number) {
  const [[{ c }]] = await db.query(
    `SELECT COUNT(*) AS c FROM tblCategory WHERE companyID = :companyID`,
    { companyID }
  );
  if (Number(c) > 0) return;
  const defaults = [
    { name: 'Men', slug: 'men', description: 'Shirts, trousers, jeans and ethnic wear for men' },
    { name: 'Women', slug: 'women', description: 'Kurtis, dresses, tops and ethnic wear for women' },
    { name: 'Kids', slug: 'kids', description: 'Comfortable everyday wear for kids' },
    { name: 'Accessories', slug: 'accessories', description: 'Belts, caps, bags and finishing touches' },
  ];
  for (const row of defaults) {
    await db.query(
      `INSERT INTO tblCategory (name, slug, description, companyID)
       VALUES (:name, :slug, :description, :companyID)`,
      { ...row, companyID }
    );
  }
}

export const categories = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await ensureCompanyCategories(companyID);
    const [tblCategory] = await db.query(
      `
      SELECT c.*, c.categoryID AS id, COUNT(p.productID) AS product_count
      FROM tblCategory c
      LEFT JOIN tblProduct p ON p.categoryID = c.categoryID AND p.companyID = c.companyID
      WHERE c.companyID = :companyID
      GROUP BY c.categoryID
      ORDER BY c.name
    `,
      { companyID }
    );
    return ok(res, { categories: tblCategory });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load categories', 500);
  }
};

export const saveCategory = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const name = req.body.name;
    const slug = slugify(req.body.slug || name);
    const description = req.body.description || '';
    const id = req.body.id || req.params.id;
    if (id) {
      await db.query(
        `UPDATE tblCategory SET name=:name, slug=:slug, description=:description
         WHERE categoryID=:id AND companyID=:companyID`,
        { name, slug, description, id, companyID }
      );
    } else {
      await db.query(
        `INSERT INTO tblCategory (name, slug, description, companyID)
         VALUES (:name, :slug, :description, :companyID)`,
        { name, slug, description, companyID }
      );
    }
    return ok(res, {}, 'Category saved');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save category', 500);
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query(
      `DELETE FROM tblCategory WHERE categoryID = :id AND companyID = :companyID`,
      { id: req.params.id, companyID }
    );
    return ok(res, {}, 'Category deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete category', 500);
  }
};

export const orders = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const status = String(req.query.status || '').trim();
    const paymentStatus = String(req.query.payment_status || '').trim();
    const paymentMethod = String(req.query.payment_method || '').trim();
    const orderSource = String(req.query.order_source || '').trim();
    const archived = String(req.query.is_archived || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const amountMin = req.query.amount_min !== undefined && req.query.amount_min !== '' ? Number(req.query.amount_min) : null;
    const amountMax = req.query.amount_max !== undefined && req.query.amount_max !== '' ? Number(req.query.amount_max) : null;
    const q = String(req.query.q || '').trim();
    let sql = `
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM tblOrder o JOIN tblUser u ON u.userID = o.userID
      WHERE o.companyID = :companyID
    `;
    const params: any = { companyID };
    if (status) {
      sql += ' AND o.status = :status';
      params.status = status;
    }
    if (paymentStatus) {
      sql += ' AND o.payment_status = :paymentStatus';
      params.paymentStatus = paymentStatus;
    }
    if (paymentMethod) {
      sql += ' AND o.payment_method = :paymentMethod';
      params.paymentMethod = paymentMethod;
    }
    if (ORDER_SOURCES.includes(orderSource)) {
      sql += ' AND o.order_source = :orderSource';
      params.orderSource = orderSource;
    }
    if (archived === '1' || archived === '0') {
      sql += ' AND o.is_archived = :isArchived';
      params.isArchived = Number(archived);
    } else {
      sql += ' AND o.is_archived = 0';
    }
    if (dateFrom) {
      sql += ' AND DATE(o.created_at) >= :dateFrom';
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      sql += ' AND DATE(o.created_at) <= :dateTo';
      params.dateTo = dateTo;
    }
    if (amountMin != null && Number.isFinite(amountMin)) {
      sql += ' AND o.total >= :amountMin';
      params.amountMin = amountMin;
    }
    if (amountMax != null && Number.isFinite(amountMax)) {
      sql += ' AND o.total <= :amountMax';
      params.amountMax = amountMax;
    }
    if (q) {
      sql += ` AND (
        o.order_number LIKE :q
        OR u.name LIKE :q
        OR u.email LIKE :q
        OR o.shipping_name LIKE :q
        OR o.shipping_phone LIKE :q
      )`;
      params.q = `%${q}%`;
    }
    sql += ' ORDER BY o.created_at DESC';
    const [tblOrder] = await db.query(sql, params);
    return ok(res, { orders: tblOrder });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load orders', 500);
  }
};

export const orderDetail = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [tblOrder] = await db.query(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email
       FROM tblOrder o JOIN tblUser u ON u.userID = o.userID
       WHERE o.orderID = :id AND o.companyID = :companyID`,
      { id: req.params.id, companyID }
    );
    if (!tblOrder.length) return fail(res, 'Order not found', 404);
    const [items] = await db.query('SELECT * FROM tblOrderItem WHERE orderID = :id', {
      id: req.params.id
    });
    const [history] = await db.query(
      `SELECT h.*, u.name AS created_by_name
       FROM tblOrderStatusHistory h
       LEFT JOIN tblUser u ON u.userID = h.createdByUserID
       WHERE h.orderID = :id
       ORDER BY h.created_at ASC, h.id ASC`,
      { id: req.params.id }
    );
    return ok(res, { order: tblOrder[0], items, history });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load order', 500);
  }
};

async function ensureWalkInCustomer(connection) {
  const email = 'walkin@buildnexkadai.local';
  const [rows] = await connection.query('SELECT userID AS id FROM tblUser WHERE email = :email LIMIT 1', { email });
  if (rows.length) return rows[0].id;
  const password = await bcrypt.hash(`walkin-${Date.now()}`, 10);
  const customerRoleId = await getRoleId('customer');
  const [result] = await connection.query(
    `INSERT INTO tblUser (name, email, phone, password, roleID, is_active)
     VALUES ('Walk-in Customer', :email, '0000000000', :password, :roleID, 1)`,
    { email, password, roleID: customerRoleId }
  );
  return result.insertId;
}

function normalizeOrderItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => ({
      productID: Number(item.productID),
      product_name: String(item.product_name || '').trim(),
      size: String(item.size || '').trim() || null,
      color: String(item.color || '').trim() || null,
      quantity: Math.max(1, Number(item.quantity) || 1),
      price: Number(item.price) || 0,
    }))
    .filter((item) => item.productID && item.product_name && item.price >= 0);
}

export const createOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const companyID = requireCompanyId(req.user);
    const items = normalizeOrderItems(req.body.items);
    if (!items.length) return fail(res, 'Add at least one order item');

    const shipping_name = String(req.body.shipping_name || '').trim();
    const shipping_phone = String(req.body.shipping_phone || '').trim();
    const shipping_address = String(req.body.shipping_address || '').trim();
    const shipping_city = String(req.body.shipping_city || '').trim();
    const shipping_state = String(req.body.shipping_state || '').trim();
    const shipping_pincode = String(req.body.shipping_pincode || '').trim();
    if (!shipping_name || !shipping_phone || !shipping_address || !shipping_city || !shipping_state || !shipping_pincode) {
      return fail(res, 'Please fill all shipping details');
    }

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discount = Number(req.body.discount) || 0;
    const coupon_discount = Number(req.body.coupon_discount) || 0;
    const tax_amount = Number(req.body.tax_amount) || 0;
    const shipping_fee = Number(req.body.shipping_fee) || 0;
    const total = calcGrandTotal({ subtotal, discount, coupon_discount, tax_amount, shipping_fee });
    // Panel create always starts pending — stock reserved only on confirm
    const status = 'pending';
    const fulfillment_status = fulfillmentFromStatus(status);
    const payment_method = req.body.payment_method === 'online' ? 'online' : 'cod';
    const payment_status = PAYMENT_STATUSES.includes(req.body.payment_status)
      ? req.body.payment_status
      : payment_method === 'online'
        ? 'paid'
        : 'pending';
    const order_source = ORDER_SOURCES.includes(req.body.order_source) ? req.body.order_source : 'admin';
    const number = orderNumber();

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
      console.warn('admin ensure branchID:', e.message);
    }

    await connection.beginTransaction();
    let userId = req.body.userID ? Number(req.body.userID) : null;
    if (userId) {
      const [tblUser] = await connection.query('SELECT userID AS id FROM tblUser WHERE userID = :id LIMIT 1', { id: userId });
      if (!tblUser.length) userId = null;
    }
    if (!userId) userId = await ensureWalkInCustomer(connection);

    const is_active = req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0' ? 0 : 1;

    const [orderResult] = await connection.query(
      `INSERT INTO tblOrder
       (userID, order_number, order_source, status, fulfillment_status, payment_method, payment_status,
        subtotal, discount, coupon_discount, tax_amount, shipping_fee, total,
        shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_pincode,
        notes, courier, tracking_number, tracking_url, expected_delivery_date, is_active, companyID, branchID)
       VALUES
       (:userId, :orderNumber, :orderSource, :status, :fulfillmentStatus, :paymentMethod, :paymentStatus,
        :subtotal, :discount, :couponDiscount, :taxAmount, :shippingFee, :total,
        :shippingName, :shippingPhone, :shippingAddress, :shippingCity, :shippingState, :shippingPincode,
        :notes, :courier, :trackingNumber, :trackingUrl, :expectedDeliveryDate, :isActive, :companyID, :branchID)`,
      {
        userId,
        orderNumber: number,
        orderSource: order_source,
        status,
        fulfillmentStatus: fulfillment_status,
        paymentMethod: payment_method,
        paymentStatus: payment_status,
        subtotal,
        discount,
        couponDiscount: coupon_discount,
        taxAmount: tax_amount,
        shippingFee: shipping_fee,
        total,
        shippingName: shipping_name,
        shippingPhone: shipping_phone,
        shippingAddress: shipping_address,
        shippingCity: shipping_city,
        shippingState: shipping_state,
        shippingPincode: shipping_pincode,
        notes: req.body.notes || null,
        courier: req.body.courier || null,
        trackingNumber: req.body.tracking_number || null,
        trackingUrl: req.body.tracking_url || null,
        expectedDeliveryDate: req.body.expected_delivery_date || null,
        isActive: is_active,
        companyID,
        branchID: Number(req.user?.branchID || req.body.branchID || 0) || 0,
      }
    );

    for (const item of items) {
      await connection.query(
        `INSERT INTO tblOrderItem (orderID, productID, product_name, size, color, quantity, price)
         VALUES (:orderId, :productId, :productName, :size, :color, :quantity, :price)`,
        {
          orderId: orderResult.insertId,
          productId: item.productID,
          productName: item.product_name,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          price: item.price,
        }
      );
    }

    await logOrderHistory(connection, {
      orderId: orderResult.insertId,
      fromStatus: null,
      toStatus: status,
      paymentStatus: payment_status,
      fulfillmentStatus: fulfillment_status,
      note: `Order created (${order_source})`,
      createdBy: req.user?.id || null,
    });

    await connection.commit();
    return ok(res, { orderId: orderResult.insertId, orderNumber: number }, 'Order created', 201);
  } catch (err) {
    await connection.rollback();
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, err.message || 'Could not create order', 500);
  } finally {
    connection.release();
  }
};

export const updateOrderStatus = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const companyID = requireCompanyId(req.user);
    const [tblOrder] = await connection.query(
      'SELECT * FROM tblOrder WHERE orderID = :id AND companyID = :companyID',
      { id: req.params.id, companyID }
    );
    if (!tblOrder.length) return fail(res, 'Order not found', 404);
    const previous = tblOrder[0];

    const status = ORDER_STATUSES.includes(req.body.status) ? req.body.status : previous.status;
    if (!canTransition(previous.status, status)) {
      return fail(res, `Invalid status transition: ${previous.status} → ${status}`);
    }

    let payment_status = PAYMENT_STATUSES.includes(req.body.payment_status)
      ? req.body.payment_status
      : previous.payment_status;
    // Delivered must NOT auto-mark COD as paid
    if (status === 'delivered' && previous.payment_method === 'cod' && req.body.payment_status == null) {
      payment_status = previous.payment_status;
    }

    const refund_status = REFUND_STATUSES.includes(req.body.refund_status)
      ? req.body.refund_status
      : previous.refund_status || 'none';
    let refund_completed = Number(previous.refund_completed) ? 1 : 0;
    if (refund_status === 'completed') refund_completed = 1;

    if (status === 'refunded' && !refund_completed) {
      return fail(res, 'Refund must be completed before setting status to Refunded');
    }

    const payment_method =
      req.body.payment_method === 'online' || req.body.payment_method === 'cod'
        ? req.body.payment_method
        : previous.payment_method;

    const is_active =
      req.body.is_active === undefined
        ? previous.is_active
        : req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0'
          ? 0
          : 1;

    const shipping_name =
      req.body.shipping_name != null ? String(req.body.shipping_name).trim() : previous.shipping_name;
    const shipping_phone =
      req.body.shipping_phone != null ? String(req.body.shipping_phone).trim() : previous.shipping_phone;
    const shipping_address =
      req.body.shipping_address != null ? String(req.body.shipping_address).trim() : previous.shipping_address;
    const shipping_city =
      req.body.shipping_city != null ? String(req.body.shipping_city).trim() : previous.shipping_city;
    const shipping_state =
      req.body.shipping_state != null ? String(req.body.shipping_state).trim() : previous.shipping_state;
    const shipping_pincode =
      req.body.shipping_pincode != null ? String(req.body.shipping_pincode).trim() : previous.shipping_pincode;
    const notes = req.body.notes !== undefined ? req.body.notes || null : previous.notes;
    const discount =
      req.body.discount !== undefined && req.body.discount !== ''
        ? Number(req.body.discount) || 0
        : Number(previous.discount) || 0;
    const coupon_discount =
      req.body.coupon_discount !== undefined && req.body.coupon_discount !== ''
        ? Number(req.body.coupon_discount) || 0
        : Number(previous.coupon_discount) || 0;
    const tax_amount =
      req.body.tax_amount !== undefined && req.body.tax_amount !== ''
        ? Number(req.body.tax_amount) || 0
        : Number(previous.tax_amount) || 0;
    const shipping_fee =
      req.body.shipping_fee !== undefined && req.body.shipping_fee !== ''
        ? Number(req.body.shipping_fee) || 0
        : Number(previous.shipping_fee) || 0;
    const total = calcGrandTotal({
      subtotal: previous.subtotal,
      discount,
      coupon_discount,
      tax_amount,
      shipping_fee,
    });
    const fulfillment_status = fulfillmentFromStatus(status);
    const order_source = ORDER_SOURCES.includes(req.body.order_source)
      ? req.body.order_source
      : previous.order_source || 'admin';

    const courier = req.body.courier !== undefined ? req.body.courier || null : previous.courier;
    const tracking_number =
      req.body.tracking_number !== undefined ? req.body.tracking_number || null : previous.tracking_number;
    const tracking_url =
      req.body.tracking_url !== undefined ? req.body.tracking_url || null : previous.tracking_url;
    const expected_delivery_date =
      req.body.expected_delivery_date !== undefined
        ? req.body.expected_delivery_date || null
        : previous.expected_delivery_date;
    let shipped_at = previous.shipped_at;
    let delivered_at = previous.delivered_at;
    if (status === 'shipped' && !shipped_at) shipped_at = req.body.shipped_at || new Date();
    if (req.body.shipped_at) shipped_at = req.body.shipped_at;
    if (status === 'delivered' && !delivered_at) delivered_at = req.body.delivered_at || new Date();
    if (req.body.delivered_at) delivered_at = req.body.delivered_at;

    const cancellation_reason =
      req.body.cancellation_reason !== undefined
        ? req.body.cancellation_reason || null
        : previous.cancellation_reason;
    const return_reason =
      req.body.return_reason !== undefined ? req.body.return_reason || null : previous.return_reason;
    const refund_amount =
      req.body.refund_amount !== undefined && req.body.refund_amount !== ''
        ? Number(req.body.refund_amount)
        : previous.refund_amount;
    const refund_method =
      req.body.refund_method !== undefined ? req.body.refund_method || null : previous.refund_method;

    if (status === 'cancelled' && !String(cancellation_reason || '').trim() && previous.status !== 'cancelled') {
      return fail(res, 'Cancellation reason is required');
    }

    const inspectionDone =
      req.body.inspection_done === true ||
      req.body.inspection_done === 1 ||
      req.body.inspection_done === '1';

    await connection.beginTransaction();
    const [items] = await connection.query(
      'SELECT productID, size, color, quantity FROM tblOrderItem WHERE orderID = :orderId',
      { orderId: previous.id }
    );

    const flags = await applyOrderStockEffects({
      connection,
      order: previous,
      items,
      nextStatus: status,
      inspectionDone,
      createdBy: req.user?.id || null,
      reserveStock,
      releaseReservedStock,
      finalizeReservedSale,
      restockReturnedSellable,
    });

    await connection.query(
      `UPDATE tblOrder SET
        status = :status,
        fulfillment_status = :fulfillmentStatus,
        payment_status = :paymentStatus,
        payment_method = :paymentMethod,
        order_source = :orderSource,
        shipping_name = :shippingName,
        shipping_phone = :shippingPhone,
        shipping_address = :shippingAddress,
        shipping_city = :shippingCity,
        shipping_state = :shippingState,
        shipping_pincode = :shippingPincode,
        notes = :notes,
        discount = :discount,
        coupon_discount = :couponDiscount,
        tax_amount = :taxAmount,
        shipping_fee = :shippingFee,
        total = :total,
        courier = :courier,
        tracking_number = :trackingNumber,
        tracking_url = :trackingUrl,
        expected_delivery_date = :expectedDeliveryDate,
        shipped_at = :shippedAt,
        delivered_at = :deliveredAt,
        cancellation_reason = :cancellationReason,
        return_reason = :returnReason,
        refund_amount = :refundAmount,
        refund_method = :refundMethod,
        refund_status = :refundStatus,
        refund_completed = :refundCompleted,
        stock_reserved = :stockReserved,
        stock_deducted = :stockDeducted,
        return_restocked = :returnRestocked,
        is_active = :isActive
       WHERE orderID = :id`,
      {
        status,
        fulfillmentStatus: fulfillment_status,
        paymentStatus: payment_status,
        paymentMethod: payment_method,
        orderSource: order_source,
        shippingName: shipping_name,
        shippingPhone: shipping_phone,
        shippingAddress: shipping_address,
        shippingCity: shipping_city,
        shippingState: shipping_state,
        shippingPincode: shipping_pincode,
        notes,
        discount,
        couponDiscount: coupon_discount,
        taxAmount: tax_amount,
        shippingFee: shipping_fee,
        total,
        courier,
        trackingNumber: tracking_number,
        trackingUrl: tracking_url,
        expectedDeliveryDate: expected_delivery_date,
        shippedAt: shipped_at,
        deliveredAt: delivered_at,
        cancellationReason: cancellation_reason,
        returnReason: return_reason,
        refundAmount: refund_amount,
        refundMethod: refund_method,
        refundStatus: refund_status,
        refundCompleted: refund_completed,
        stockReserved: flags.stock_reserved,
        stockDeducted: flags.stock_deducted,
        returnRestocked: flags.return_restocked,
        isActive: is_active,
        id: req.params.id,
      }
    );

    if (previous.status !== status || previous.payment_status !== payment_status) {
      await logOrderHistory(connection, {
        orderId: previous.id,
        fromStatus: previous.status,
        toStatus: status,
        paymentStatus: payment_status,
        fulfillmentStatus: fulfillment_status,
        note: req.body.history_note || null,
        createdBy: req.user?.id || null,
      });
    }

    await connection.commit();
    return ok(res, {}, 'Order updated');
  } catch (err) {
    await connection.rollback();
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, err.message || 'Could not update order', 500);
  } finally {
    connection.release();
  }
};

export const cancelOrderPanel = async (req, res) => {
  req.body = {
    ...req.body,
    status: 'cancelled',
    cancellation_reason: req.body.cancellation_reason || req.body.reason,
    history_note: 'Cancelled from panel',
  };
  return exports.updateOrderStatus(req, res);
};

export const archiveOrder = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const archived = req.body.is_archived === false || req.body.is_archived === 0 || req.body.is_archived === '0' ? 0 : 1;
    const [result] = await db.query(
      'UPDATE tblOrder SET is_archived = :archived WHERE orderID = :id AND companyID = :companyID',
      { archived, id: req.params.id, companyID }
    );
    if (!result.affectedRows) return fail(res, 'Order not found', 404);
    return ok(res, {}, archived ? 'Order archived' : 'Order restored');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not archive order', 500);
  }
};

/** Hard delete disabled for financial integrity — archive instead. */
export const deleteOrder = async (req, res) => {
  return fail(res, 'Hard delete is disabled. Cancel or archive the order instead.', 400);
};

export const stockMove = async (req, res) => {
  try {
    const {
      productID,
      productVariantID,
      size,
      color,
      type,
      qty,
      set_qty,
      note,
      reason,
      from_location,
      to_location,
      warehouse,
      warehouseID,
      toWarehouseID,
      supplierID,
      reference_no,
      purchase_price,
      movement_date,
      adjustment_type,
      ref_type,
      ref_id,
    } = req.body;

    const allowed = ['in', 'out', 'adjust', 'transfer', 'purchase', 'pos', 'return', 'opening', 'damaged'];
    if (!productID || !type || !allowed.includes(type)) {
      return fail(res, 'Valid productID and type are required');
    }
    if ((type === 'adjust' || type === 'out' || type === 'damaged') && !(reason || note)) {
      return fail(res, 'Reason / remarks is required for this movement');
    }

    let qtyDelta = null;
    let setQty = null;
    if (type === 'adjust') {
      if (set_qty != null && set_qty !== '') {
        setQty = Number(set_qty);
      } else if (adjustment_type === 'decrease') {
        qtyDelta = -Math.abs(Number(qty) || 0);
      } else if (adjustment_type === 'increase') {
        qtyDelta = Math.abs(Number(qty) || 0);
      } else {
        qtyDelta = Number(qty) || 0;
      }
      if (!setQty && !qtyDelta) return fail(res, 'Adjustment quantity is required');
    } else {
      const amount = Math.abs(Number(qty) || 0);
      if (!amount && type !== 'transfer') return fail(res, 'Quantity is required');
      if (type === 'out' || type === 'pos' || type === 'damaged') qtyDelta = -amount;
      else if (type === 'transfer') qtyDelta = amount;
      else qtyDelta = amount;
    }

    const result = await applyStockChange({
      productId: Number(productID),
      variantId: productVariantID ? Number(productVariantID) : null,
      size: size || null,
      color: color || null,
      type,
      qtyDelta,
      setQty,
      note: note || reason || null,
      fromLocation: from_location || null,
      toLocation: to_location || null,
      warehouse: warehouse || null,
      warehouseId: warehouseID ? Number(warehouseID) : null,
      toWarehouseId: toWarehouseID ? Number(toWarehouseID) : null,
      supplierId: supplierID ? Number(supplierID) : null,
      referenceNo: reference_no || null,
      purchasePrice: purchase_price != null && purchase_price !== '' ? Number(purchase_price) : null,
      movementDate: movement_date || null,
      refType: ref_type || 'manual',
      refId: ref_id ? Number(ref_id) : null,
      createdBy: req.user?.id || null,
    });

    return ok(res, { movement: result }, 'Stock updated');
  } catch (err) {
    console.error(err);
    return fail(res, err.message || 'Could not update stock', 500);
  }
};

export const stockHistory = async (req, res) => {
  try {
    const history = await listStockHistory({
      productID: req.query.productID ? Number(req.query.productID) : null,
      productVariantID: req.query.productVariantID ? Number(req.query.productVariantID) : null,
      warehouseID: req.query.warehouseID ? Number(req.query.warehouseID) : null,
      type: req.query.type || null,
      sku: req.query.sku || null,
      from: req.query.from || null,
      to: req.query.to || null,
      limit: req.query.limit || 50,
    });
    return ok(res, { history });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load stock history', 500);
  }
};

export const lowStockAlerts = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const items = await listLowStock({ limit: req.query.limit || 50, companyID });
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load low stock alerts', 500);
  }
};

export const stockItems = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const items = await listStockItems({
      companyID,
      q: req.query.q || '',
      categoryID: req.query.categoryID || '',
      brand: req.query.brand || '',
      size: req.query.size || '',
      color: req.query.color || '',
      warehouseID: req.query.warehouseID || '',
      status: req.query.status || '',
    });
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load stock items', 500);
  }
};

export const stockReports = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const type = req.params.type || 'current';
    const rows = await stockReport(type, { companyID });
    return ok(res, { type, rows });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load stock report', 500);
  }
};

export const listBranches = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [items] = await db.query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM tblWarehouse w WHERE w.branchID = b.branchID) AS warehouse_count
       FROM tblBranch b
       WHERE b.companyID = :companyID
       ORDER BY b.name ASC`,
      { companyID }
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load branches', 500);
  }
};

export const saveBranch = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || name || 'BR')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 40);
    if (!name) return fail(res, 'Branch name is required');
    if (!code) return fail(res, 'Branch code is required');

    const data = {
      name,
      code,
      phone: req.body.phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      city: req.body.city || null,
      state: req.body.state || null,
      pincode: req.body.pincode || null,
      country: req.body.country || 'India',
      is_active: req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0' ? 0 : 1,
      companyID,
    };

    const id = req.params.id || req.body.id;
    if (id) {
      await db.query(
        `UPDATE tblBranch SET name=:name, code=:code, phone=:phone, email=:email, address=:address,
         city=:city, state=:state, pincode=:pincode, country=:country, is_active=:is_active
         WHERE branchID=:id AND companyID=:companyID`,
        { ...data, id }
      );
      return ok(res, { id: Number(id) }, 'Branch updated');
    }

    const [result] = await db.query(
      `INSERT INTO tblBranch (name, code, phone, email, address, city, state, pincode, country, is_active, companyID)
       VALUES (:name, :code, :phone, :email, :address, :city, :state, :pincode, :country, :is_active, :companyID)`,
      data
    );
    return ok(res, { id: result.insertId }, 'Branch created', 201);
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save branch (code may already exist)', 500);
  }
};

export const deleteBranch = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = req.params.id;
    const [owned] = await db.query(
      'SELECT branchID FROM tblBranch WHERE branchID = :id AND companyID = :companyID',
      { id, companyID }
    );
    if (!owned.length) return fail(res, 'Branch not found', 404);
    const [[linked]] = await db.query(
      `SELECT COUNT(*) AS c FROM tblWarehouse WHERE branchID = :id`,
      { id }
    );
    if (Number(linked.c) > 0) {
      return fail(res, 'Cannot delete: tblWarehouse are linked to this branch. Set Inactive instead.', 400);
    }
    await db.query(`DELETE FROM tblBranch WHERE branchID = :id AND companyID = :companyID`, {
      id,
      companyID,
    });
    return ok(res, {}, 'Branch deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete branch', 500);
  }
};

export const listWarehouses = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    let [tblWarehouse] = await db.query(
      `SELECT w.*, w.warehouseID AS id, w.branchID AS branch_id,
              b.name AS branch_name, b.code AS branch_code
       FROM tblWarehouse w
       LEFT JOIN tblBranch b ON b.branchID = w.branchID
       WHERE w.companyID = :companyID
       ORDER BY w.is_default DESC, w.name ASC`,
      { companyID }
    );
    if (!tblWarehouse.length) {
      const fallback = await listWarehousesService();
      tblWarehouse = fallback.filter(
        (w: any) => !w.companyID || Number(w.companyID) === companyID
      );
    }
    return ok(res, { warehouses: tblWarehouse });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load warehouses', 500);
  }
};

export const saveWarehouse = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || name || 'WH')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 40);
    if (!name) return fail(res, 'Warehouse name is required');
    if (!code) return fail(res, 'Warehouse code is required');

    const isDefault = req.body.is_default === true || req.body.is_default === 1 || req.body.is_default === '1' ? 1 : 0;
    const rawBranch = req.body.branch_id ?? req.body.branchID;
    const branchID = rawBranch === '' || rawBranch == null ? null : Number(rawBranch);
    const data = {
      name,
      code,
      branchID: Number.isFinite(branchID as number) ? branchID : null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      city: req.body.city || null,
      state: req.body.state || null,
      pincode: req.body.pincode || null,
      country: req.body.country || 'India',
      contact_person: req.body.contact_person || null,
      is_default: isDefault,
      is_active: req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0' ? 0 : 1,
      companyID,
    };

    const id = req.params.id || req.body.id;
    if (isDefault) {
      await db.query(`UPDATE tblWarehouse SET is_default = 0 WHERE companyID = :companyID`, {
        companyID,
      });
    }

    if (id) {
      await db.query(
        `UPDATE tblWarehouse SET name=:name, code=:code, branchID=:branchID, phone=:phone, email=:email,
         address=:address, city=:city, state=:state, pincode=:pincode, country=:country,
         contact_person=:contact_person, is_default=:is_default, is_active=:is_active
         WHERE warehouseID=:id AND companyID=:companyID`,
        { ...data, id }
      );
      return ok(res, { id: Number(id) }, 'Warehouse updated');
    }

    const [result] = await db.query(
      `INSERT INTO tblWarehouse
        (name, code, branchID, phone, email, address, city, state, pincode, country, contact_person, is_default, is_active, companyID)
       VALUES
        (:name, :code, :branchID, :phone, :email, :address, :city, :state, :pincode, :country, :contact_person, :is_default, :is_active, :companyID)`,
      data
    );
    return ok(res, { id: result.insertId }, 'Warehouse created', 201);
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save warehouse (code may already exist)', 500);
  }
};

export const deleteWarehouse = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = req.params.id;
    const [[inv]] = await db.query(
      `SELECT COUNT(*) AS c FROM tblInventory WHERE warehouseID = :id`,
      { id }
    );
    if (Number(inv.c) > 0) {
      return fail(res, 'Cannot delete: warehouse has tblInventory rows. Set Inactive instead.', 400);
    }
    const [[row]] = await db.query(
      `SELECT is_default FROM tblWarehouse WHERE warehouseID = :id AND companyID = :companyID`,
      { id, companyID }
    );
    if (!row) return fail(res, 'Warehouse not found', 404);
    if (Number(row.is_default) === 1) {
      return fail(res, 'Cannot delete the default warehouse. Set another as default first.', 400);
    }
    await db.query(`DELETE FROM tblWarehouse WHERE warehouseID = :id AND companyID = :companyID`, {
      id,
      companyID,
    });
    return ok(res, {}, 'Warehouse deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete warehouse', 500);
  }
};

export const customers = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const phone = String(req.query.phone || '').trim();
    const q = String(req.query.q || '').trim();
    const params: any = { companyID };
    let where = `${SQL_CUSTOMER_USER} AND u.companyID = :companyID AND COALESCE(u.is_active, 1) = 1`;
    if (phone) {
      where += ' AND u.phone = :phone';
      params.phone = phone;
    }
    if (q) {
      where +=
        ' AND (u.name LIKE :q OR u.email LIKE :q OR u.phone LIKE :q OR u.city LIKE :q OR u.address LIKE :q)';
      params.q = `%${q}%`;
    }
    const [customers] = await db.query(
      `
      SELECT u.userID AS id, u.userID, u.name, u.email, u.phone, u.address, u.city, u.state, u.pincode,
             u.is_active, u.created_at, u.companyID,
        COUNT(o.orderID) AS order_count, COALESCE(SUM(o.total), 0) AS spent
      FROM tblUser u
      ${USER_ROLE_JOIN}
      LEFT JOIN tblOrder o ON o.userID = u.userID AND o.status <> 'cancelled'
      WHERE ${where}
      GROUP BY u.userID
      ORDER BY u.created_at DESC
      ${phone ? 'LIMIT 5' : ''}
    `,
      params
    );
    return ok(res, { customers, items: customers, customer: customers[0] || null });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load customers', 500);
  }
};

export const saveCustomer = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const customerId = req.params.id ? Number(req.params.id) : Number(req.body.id || 0) || null;
    const phone = String(req.body.phone || '').trim();
    const name = String(req.body.name || '').trim();
    const address = String(req.body.address || '').trim();
    const email = String(req.body.email || '').trim() || null;
    const city = String(req.body.city || '').trim() || 'Local';
    const state = String(req.body.state || '').trim() || 'N/A';
    const pincode = String(req.body.pincode || '').trim() || '000000';
    const isActive =
      req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0' ? 0 : 1;

    if (!phone || !name || !address) {
      return fail(res, 'Customer name, mobile and address are required');
    }

    if (customerId) {
      const [owned] = await db.query(
        `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
         WHERE u.userID = :id AND u.companyID = :companyID AND ${SQL_CUSTOMER_USER} LIMIT 1`,
        { id: customerId, companyID }
      );
      if (!owned.length) return fail(res, 'Customer not found', 404);

      const [phoneClash] = await db.query(
        `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
         WHERE ${SQL_CUSTOMER_USER} AND u.companyID = :companyID AND u.phone = :phone AND u.userID <> :id LIMIT 1`,
        { companyID, phone, id: customerId }
      );
      if (phoneClash.length) return fail(res, 'Another customer already uses this phone', 400);

      await db.query(
        `UPDATE tblUser SET
          name = :name, phone = :phone, address = :address,
          email = COALESCE(:email, email),
          city = :city, state = :state, pincode = :pincode, is_active = :is_active
         WHERE userID = :id AND companyID = :companyID`,
        { id: customerId, companyID, name, phone, address, email, city, state, pincode, is_active: isActive }
      );
      const [rows] = await db.query(
        `SELECT userID AS id, name, email, phone, address, city, state, pincode, is_active
         FROM tblUser WHERE userID = :id`,
        { id: customerId }
      );
      return ok(res, { customer: rows[0] }, 'Customer updated');
    }

    const [existing] = await db.query(
      `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
       WHERE ${SQL_CUSTOMER_USER} AND u.companyID = :companyID AND u.phone = :phone LIMIT 1`,
      { companyID, phone }
    );

    if (existing.length) {
      const id = existing[0].id;
      await db.query(
        `UPDATE tblUser SET
          name = :name, address = :address, email = COALESCE(:email, email),
          city = :city, state = :state, pincode = :pincode, is_active = 1
         WHERE userID = :id AND companyID = :companyID`,
        { id, companyID, name, address, email, city, state, pincode }
      );
      const [rows] = await db.query(
        `SELECT userID AS id, name, email, phone, address, city, state, pincode, is_active
         FROM tblUser WHERE userID = :id`,
        { id }
      );
      return ok(res, { customer: rows[0] }, 'Customer updated');
    }

    const safeEmail = email || `pos_${phone}@customer.local`;
    const [byEmail] = await db.query(
      'SELECT userID AS id FROM tblUser WHERE email = :email LIMIT 1',
      { email: safeEmail }
    );
    if (byEmail.length) {
      const id = byEmail[0].id;
      await db.query(
        `UPDATE tblUser SET name = :name, phone = :phone, address = :address, city = :city, state = :state,
         pincode = :pincode, companyID = :companyID, is_active = 1
         WHERE userID = :id`,
        { id, name, phone, address, city, state, pincode, companyID }
      );
      const [rows] = await db.query(
        `SELECT userID AS id, name, email, phone, address, city, state, pincode, is_active
         FROM tblUser WHERE userID = :id`,
        { id }
      );
      return ok(res, { customer: rows[0] }, 'Customer updated');
    }

    const password = await bcrypt.hash(`pos-${phone}-${Date.now()}`, 10);
    const customerRoleId = await getRoleId('customer');
    const [ins] = await db.query(
      `INSERT INTO tblUser
       (name, email, phone, password, address, city, state, pincode, roleID, companyID, isAdmin, isSuperAdmin, branchID, is_active)
       VALUES
       (:name, :email, :phone, :password, :address, :city, :state, :pincode, :roleID, :companyID, 0, 0, 0, 1)`,
      {
        name,
        email: safeEmail,
        phone,
        password,
        address,
        city,
        state,
        pincode,
        roleID: customerRoleId,
        companyID,
      }
    );
    const [rows] = await db.query(
      `SELECT userID AS id, name, email, phone, address, city, state, pincode, is_active
       FROM tblUser WHERE userID = :id`,
      { id: ins.insertId }
    );
    return ok(res, { customer: rows[0] }, 'Customer created', 201);
  } catch (err: any) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, err.message || 'Failed to save customer', 500);
  }
};

export const deleteCustomer = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = Number(req.params.id);
    const [owned] = await db.query(
      `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID AND ${SQL_CUSTOMER_USER} LIMIT 1`,
      { id, companyID }
    );
    if (!owned.length) return fail(res, 'Customer not found', 404);

    const [[orders]] = await db.query(
      `SELECT COUNT(*) AS c FROM tblOrder WHERE userID = :id AND status <> 'cancelled'`,
      { id }
    );
    if (Number(orders.c) > 0) {
      await db.query(
        `UPDATE tblUser SET is_active = 0 WHERE userID = :id AND companyID = :companyID`,
        { id, companyID }
      );
      return ok(res, { soft: true }, 'Customer has orders — set to Inactive');
    }

    await db.query(`DELETE FROM tblUser WHERE userID = :id AND companyID = :companyID`, {
      id,
      companyID,
    });
    return ok(res, {}, 'Customer deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete customer', 500);
  }
};
