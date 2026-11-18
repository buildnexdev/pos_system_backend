/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: API route table for auth, shop and panel endpoints
 * Edit Date: 2026-11-12
 */

import express from 'express';
const router = express.Router();
import { requireAuth,
  requireAdmin,
  requirePanelUser,
  optionalAuth,
  requireRight
 } from '../middleware/auth';

import * as auth from '../controllers/authController';
import * as shop from '../controllers/shopController';
import * as cart from '../controllers/cartController';
import * as orders from '../controllers/orderController';
import * as wishlist from '../controllers/wishlistController';
import * as admin from '../controllers/adminController';
import * as panel from '../controllers/panelController';
import * as pos from '../controllers/posController';
import * as support from '../controllers/supportController';
import * as paymentHistory from '../controllers/paymentHistoryController';
import * as invoiceAgreement from '../controllers/invoiceAgreementController';
import { upload } from '../middleware/upload';
import { companyUpload } from '../middleware/companyUpload';
import { staffUpload } from '../middleware/staffUpload';
import { supportUpload } from '../middleware/supportUpload';
import { storeUpload, makeFilename } from '../utils/s3Storage';
import { apiHomeHtml, wantsHtml } from '../utils/apiScreens';

router.get('/', (req, res) => {
  if (wantsHtml(req.headers.accept)) {
    return res.status(200).type('html').send(apiHomeHtml(process.env.PORT || 5000));
  }
  return res.json({
    success: true,
    message: 'BuildNex ShopOS API',
    health: '/api/health',
    docs: 'Use panel client or authenticated endpoints under /api/*',
  });
});

router.get('/health', (req, res) => res.json({ success: true, message: 'BuildNex ShopOS API running' }));

// Auth
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/forgot-password', auth.forgotPassword);
router.post('/auth/reset-password', auth.resetPasswordWithOtp);
router.post('/auth/company-request', auth.companyRegisterRequest);
router.get('/auth/me', requireAuth, auth.me);
router.put('/auth/profile', requireAuth, auth.updateProfile);
router.post('/auth/change-password', requireAuth, auth.changePassword);
router.post('/auth/logout', requireAuth, auth.logout);

// Shop (customer)
router.get('/home', shop.home);
router.get('/categories', shop.categories);
router.get('/products', shop.products);
router.get('/products/:slug', optionalAuth, shop.productDetail);
router.get('/cart', requireAuth, cart.viewCart);
router.post('/cart', requireAuth, cart.addToCart);
router.put('/cart/:id', requireAuth, cart.updateCart);
router.delete('/cart/:id', requireAuth, cart.removeFromCart);
router.get('/wishlist', requireAuth, wishlist.viewWishlist);
router.post('/wishlist/toggle', requireAuth, wishlist.toggleWishlist);
router.delete('/wishlist/:id', requireAuth, wishlist.removeWishlist);
router.post('/orders', requireAuth, orders.placeOrder);
router.get('/orders', requireAuth, orders.myOrders);
router.get('/orders/:id', requireAuth, orders.orderDetail);
router.post('/orders/:id/cancel', requireAuth, orders.cancelOrder);

// Panel modules list
router.get('/panel/modules', requireAuth, requirePanelUser, panel.modules);

// Staff
router.get('/panel/staff', requireAuth, requireRight('staff', 'view'), panel.listStaff);
router.get('/panel/staff/:id', requireAuth, requireRight('staff', 'view'), panel.getStaff);
router.post('/panel/staff', requireAuth, requireRight('staff', 'create'), panel.saveStaff);
router.put('/panel/staff/:id', requireAuth, requireRight('staff', 'edit'), panel.saveStaff);
router.patch('/panel/staff/:id/active', requireAuth, requireRight('staff', 'edit'), panel.toggleStaffActive);
router.delete('/panel/staff/:id', requireAuth, requireRight('staff', 'delete'), panel.deleteStaff);

// Roles
router.get('/panel/roles', requireAuth, requireRight('role', 'view'), panel.listRoles);
router.post('/panel/roles', requireAuth, requireRight('role', 'create'), panel.saveRole);
router.put('/panel/roles/:id', requireAuth, requireRight('role', 'edit'), panel.saveRole);
router.delete('/panel/roles/:id', requireAuth, requireRight('role', 'delete'), panel.deleteRole);

// Access control
router.get('/panel/staff-options', requireAuth, requireRight('access_control', 'view'), panel.staffOptions);
router.get('/panel/rights/:userId', requireAuth, requireRight('access_control', 'view'), panel.getRights);
router.put('/panel/rights/:userId', requireAuth, requireRight('access_control', 'edit'), panel.saveRights);

// Product types
router.get('/panel/product-types', requireAuth, requireRight('product_type', 'view'), panel.listProductTypes);
router.post('/panel/product-types', requireAuth, requireRight('product_type', 'create'), panel.saveProductType);
router.put('/panel/product-types/:id', requireAuth, requireRight('product_type', 'edit'), panel.saveProductType);
router.delete('/panel/product-types/:id', requireAuth, requireRight('product_type', 'delete'), panel.deleteProductType);

// Company master
router.get('/panel/companies', requireAuth, requireRight('company', 'view'), panel.listCompanies);
router.get('/panel/companies/:id', requireAuth, requireRight('company', 'view'), panel.getCompany);
router.post('/panel/companies', requireAuth, requireRight('company', 'create'), panel.saveCompany);
router.put('/panel/companies/:id', requireAuth, requireRight('company', 'edit'), panel.saveCompany);
router.delete('/panel/companies/:id', requireAuth, requireRight('company', 'delete'), panel.deleteCompany);

// Super Admin — Payment History + Mail Config
router.get('/panel/payment-history', requireAuth, requireRight('payment_history', 'view'), paymentHistory.listPayments);
router.get('/panel/payment-history/:id', requireAuth, requireRight('payment_history', 'view'), paymentHistory.getPayment);
router.post('/panel/payment-history', requireAuth, requireRight('payment_history', 'create'), paymentHistory.savePayment);
router.put('/panel/payment-history/:id', requireAuth, requireRight('payment_history', 'edit'), paymentHistory.savePayment);
router.delete('/panel/payment-history/:id', requireAuth, requireRight('payment_history', 'delete'), paymentHistory.deletePayment);
router.get('/panel/mail-config', requireAuth, requireRight('payment_history', 'view'), paymentHistory.getMailSettings);
router.put('/panel/mail-config', requireAuth, requireRight('payment_history', 'edit'), paymentHistory.saveMailSettings);
router.post('/panel/mail-config/test', requireAuth, requireRight('payment_history', 'edit'), paymentHistory.testMailSettings);

// Super Admin — Invoice & Agreement
router.get('/panel/invoice-agreement', requireAuth, requireRight('invoice_agreement', 'view'), invoiceAgreement.listItems);
router.get('/panel/invoice-agreement/:id', requireAuth, requireRight('invoice_agreement', 'view'), invoiceAgreement.getItem);
router.post('/panel/invoice-agreement', requireAuth, requireRight('invoice_agreement', 'create'), invoiceAgreement.saveItem);
router.put('/panel/invoice-agreement/:id', requireAuth, requireRight('invoice_agreement', 'edit'), invoiceAgreement.saveItem);
router.delete('/panel/invoice-agreement/:id', requireAuth, requireRight('invoice_agreement', 'delete'), invoiceAgreement.deleteItem);

// Suppliers (list available to panel for Stock dropdown; CRUD needs supplier rights)
router.get('/panel/suppliers', requireAuth, requirePanelUser, panel.listSuppliers);
router.post('/panel/suppliers', requireAuth, requireRight('supplier', 'create'), panel.saveSupplier);
router.put('/panel/suppliers/:id', requireAuth, requireRight('supplier', 'edit'), panel.saveSupplier);
router.delete('/panel/suppliers/:id', requireAuth, requireRight('supplier', 'delete'), panel.deleteSupplier);

// Products / Orders (reuse admin controller with rights)
router.get('/panel/dashboard', requireAuth, requireRight('dashboard', 'view'), admin.dashboard);
router.get('/panel/products', requireAuth, requireRight('product', 'view'), admin.products);
router.get('/panel/products/:id', requireAuth, requireRight('product', 'view'), admin.getProduct);
router.post('/panel/products', requireAuth, requireRight('product', 'create'), admin.saveProduct);
router.put('/panel/products/:id', requireAuth, requireRight('product', 'edit'), admin.saveProduct);
router.delete('/panel/products/:id', requireAuth, requireRight('product', 'delete'), admin.deleteProduct);
router.get('/panel/stock/items', requireAuth, requireRight('product', 'view'), admin.stockItems);
router.post('/panel/stock/move', requireAuth, requireRight('product', 'edit'), admin.stockMove);
router.get('/panel/stock/history', requireAuth, requireRight('product', 'view'), admin.stockHistory);
router.get('/panel/stock/low-alerts', requireAuth, requireRight('product', 'view'), admin.lowStockAlerts);
router.get('/panel/stock/reports/:type', requireAuth, requireRight('product', 'view'), admin.stockReports);

// Branches (list available to panel for Warehouse dropdown; CRUD needs branch rights)
router.get('/panel/branches', requireAuth, requirePanelUser, admin.listBranches);
router.post('/panel/branches', requireAuth, requireRight('branch', 'create'), admin.saveBranch);
router.put('/panel/branches/:id', requireAuth, requireRight('branch', 'edit'), admin.saveBranch);
router.delete('/panel/branches/:id', requireAuth, requireRight('branch', 'delete'), admin.deleteBranch);

// Warehouses (list available to panel for Stock dropdowns; CRUD needs warehouse rights)
router.get('/panel/warehouses', requireAuth, requirePanelUser, admin.listWarehouses);
router.post('/panel/warehouses', requireAuth, requireRight('warehouse', 'create'), admin.saveWarehouse);
router.put('/panel/warehouses/:id', requireAuth, requireRight('warehouse', 'edit'), admin.saveWarehouse);
router.delete('/panel/warehouses/:id', requireAuth, requireRight('warehouse', 'delete'), admin.deleteWarehouse);
router.post(
  '/panel/upload/product-image',
  requireAuth,
  requirePanelUser,
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image uploaded' });
      }
      const filename = makeFilename('product', req.file.originalname, '.jpg');
      const stored = await storeUpload(req.file, 'products', filename);
      return res.json({
        success: true,
        data: { url: stored.url, filename: stored.filename, storage: stored.storage },
        message: 'Image uploaded',
      });
    } catch (err: any) {
      console.error('product-image upload:', err);
      return res.status(500).json({
        success: false,
        message: err?.message || 'Image upload failed',
      });
    }
  }
);
router.post(
  '/panel/upload/staff-photo',
  requireAuth,
  requirePanelUser,
  staffUpload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image uploaded' });
      }
      const filename = makeFilename('staff', req.file.originalname, '.jpg');
      const stored = await storeUpload(req.file, 'staff', filename);
      return res.json({
        success: true,
        data: { url: stored.url, filename: stored.filename, storage: stored.storage },
        message: 'Photo uploaded',
      });
    } catch (err: any) {
      console.error('staff-photo upload:', err);
      return res.status(500).json({
        success: false,
        message: err?.message || 'Photo upload failed',
      });
    }
  }
);
router.post(
  '/panel/upload/company-document',
  requireAuth,
  requireRight('company', 'edit'),
  companyUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const filename = makeFilename('company', req.file.originalname);
      const stored = await storeUpload(req.file, 'company', filename);
      return res.json({
        success: true,
        data: {
          url: stored.url,
          filename: stored.filename,
          original_name: req.file.originalname,
          mime_type: req.file.mimetype,
          size: req.file.size,
          storage: stored.storage,
        },
        message: 'Document uploaded',
      });
    } catch (err: any) {
      console.error('company-document upload:', err);
      return res.status(500).json({
        success: false,
        message: err?.message || 'Document upload failed',
      });
    }
  }
);
router.get('/panel/categories', requireAuth, requireRight('product', 'view'), admin.categories);
router.get('/panel/orders', requireAuth, requireRight('order', 'view'), admin.orders);
router.get('/panel/orders/:id', requireAuth, requireRight('order', 'view'), admin.orderDetail);
router.post('/panel/orders', requireAuth, requireRight('order', 'create'), admin.createOrder);
router.put('/panel/orders/:id', requireAuth, requireRight('order', 'edit'), admin.updateOrderStatus);
router.post('/panel/orders/:id/cancel', requireAuth, requireRight('order', 'edit'), admin.cancelOrderPanel);
router.post('/panel/orders/:id/archive', requireAuth, requireRight('order', 'edit'), admin.archiveOrder);
router.delete('/panel/orders/:id', requireAuth, requireRight('order', 'delete'), admin.deleteOrder);
router.get('/panel/customers', requireAuth, requireRight('customer', 'view'), admin.customers);
router.post('/panel/customers', requireAuth, requireRight('customer', 'create'), admin.saveCustomer);
router.put('/panel/customers/:id', requireAuth, requireRight('customer', 'edit'), admin.saveCustomer);
router.delete('/panel/customers/:id', requireAuth, requireRight('customer', 'delete'), admin.deleteCustomer);

// POS Billing
router.get('/panel/pos/lookup', requireAuth, requireRight('billing', 'view'), pos.lookupProduct);
router.get('/panel/pos/customers', requireAuth, requireRight('billing', 'view'), admin.customers);
router.post('/panel/pos/checkout', requireAuth, requireRight('billing', 'create'), pos.checkout);

// Payment / Billing / Dropship / Finance / Report
router.get('/panel/payment-gateways', requireAuth, requireRight('payment_gateway', 'view'), panel.listGateways);
router.post('/panel/payment-gateways', requireAuth, requireRight('payment_gateway', 'create'), panel.saveGateway);
router.put('/panel/payment-gateways/:id', requireAuth, requireRight('payment_gateway', 'edit'), panel.saveGateway);
router.delete('/panel/payment-gateways/:id', requireAuth, requireRight('payment_gateway', 'delete'), panel.deleteGateway);

router.get('/panel/billings', requireAuth, requireRight('billing', 'view'), panel.listBillings);
router.post('/panel/billings', requireAuth, requireRight('billing', 'create'), panel.saveBilling);
router.put('/panel/billings/:id', requireAuth, requireRight('billing', 'edit'), panel.saveBilling);
router.delete('/panel/billings/:id', requireAuth, requireRight('billing', 'delete'), panel.deleteBilling);

router.get('/panel/dropshipping', requireAuth, requireRight('dropshipping', 'view'), panel.listDropships);
router.post('/panel/dropshipping', requireAuth, requireRight('dropshipping', 'create'), panel.saveDropship);
router.put('/panel/dropshipping/:id', requireAuth, requireRight('dropshipping', 'edit'), panel.saveDropship);
router.delete('/panel/dropshipping/:id', requireAuth, requireRight('dropshipping', 'delete'), panel.deleteDropship);

router.get('/panel/finance', requireAuth, requireRight('finance', 'view'), panel.listFinance);
router.post('/panel/finance', requireAuth, requireRight('finance', 'create'), panel.saveFinance);
router.put('/panel/finance/:id', requireAuth, requireRight('finance', 'edit'), panel.saveFinance);
router.delete('/panel/finance/:id', requireAuth, requireRight('finance', 'delete'), panel.deleteFinance);

router.get('/panel/reports', requireAuth, requireRight('report', 'view'), panel.reports);

// Help & Support
router.get('/panel/support/meta', requireAuth, requirePanelUser, support.meta);
router.get('/panel/support/settings', requireAuth, requireRight('support', 'view'), support.getSettings);
router.put('/panel/support/settings', requireAuth, requireAdmin, support.saveSettings);
router.get('/panel/support/categories', requireAuth, requireRight('support', 'view'), support.listCategories);
router.get('/panel/support/articles', requireAuth, requireRight('support', 'view'), support.listArticles);
router.get('/panel/support/articles/:slugOrId', requireAuth, requireRight('support', 'view'), support.getArticle);
router.get('/panel/support/tickets', requireAuth, requireRight('support', 'view'), support.listTickets);
router.post(
  '/panel/support/tickets',
  requireAuth,
  requireRight('support', 'create'),
  supportUpload.array('attachments', 5),
  support.createTicket
);
router.get('/panel/support/tickets/:id', requireAuth, requireRight('support', 'view'), support.getTicket);
router.post(
  '/panel/support/tickets/:id/reply',
  requireAuth,
  requireRight('support', 'view'),
  supportUpload.array('attachments', 5),
  support.replyTicket
);
router.patch('/panel/support/tickets/:id', requireAuth, requireRight('support', 'edit'), support.updateTicket);
router.delete('/panel/support/tickets/:id', requireAuth, requireRight('support', 'delete'), support.deleteTicket);
router.get('/panel/support/staff-options', requireAuth, requireAdmin, support.staffOptions);
router.get(
  '/panel/support/attachments/:id',
  requireAuth,
  requireRight('support', 'view'),
  support.downloadAttachment
);

// Legacy admin routes (admin only)
router.get('/admin/dashboard', requireAuth, requireAdmin, admin.dashboard);
router.get('/admin/products', requireAuth, requireAdmin, admin.products);
router.get('/admin/products/:id', requireAuth, requireAdmin, admin.getProduct);
router.post('/admin/products', requireAuth, requireAdmin, admin.saveProduct);
router.put('/admin/products/:id', requireAuth, requireAdmin, admin.saveProduct);
router.delete('/admin/products/:id', requireAuth, requireAdmin, admin.deleteProduct);
router.get('/admin/categories', requireAuth, requireAdmin, admin.categories);
router.post('/admin/categories', requireAuth, requireAdmin, admin.saveCategory);
router.put('/admin/categories/:id', requireAuth, requireAdmin, admin.saveCategory);
router.delete('/admin/categories/:id', requireAuth, requireAdmin, admin.deleteCategory);
router.get('/admin/orders', requireAuth, requireAdmin, admin.orders);
router.get('/admin/orders/:id', requireAuth, requireAdmin, admin.orderDetail);
router.put('/admin/orders/:id', requireAuth, requireAdmin, admin.updateOrderStatus);
router.get('/admin/customers', requireAuth, requireAdmin, admin.customers);

export default router;
