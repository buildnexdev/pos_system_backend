CREATE DATABASE IF NOT EXISTS garments_shop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE garments_shop;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS tblFinanceEntry;
DROP TABLE IF EXISTS tblDropshipOrder;
DROP TABLE IF EXISTS tblBilling;
DROP TABLE IF EXISTS tblPosPayment;
DROP TABLE IF EXISTS tblPaymentGateway;
DROP TABLE IF EXISTS tblUserRight;
DROP TABLE IF EXISTS tblOrderItem;
DROP TABLE IF EXISTS tblOrder;
DROP TABLE IF EXISTS tblCartItem;
DROP TABLE IF EXISTS tblWishlist;
DROP TABLE IF EXISTS tblProductImage;
DROP TABLE IF EXISTS tblProduct;
DROP TABLE IF EXISTS tblProductType;
DROP TABLE IF EXISTS tblCategory;
DROP TABLE IF EXISTS tblUser;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE tblUser (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  state VARCHAR(100) DEFAULT NULL,
  pincode VARCHAR(20) DEFAULT NULL,
  roleID INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tblUserRight (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userID INT NOT NULL,
  module_key VARCHAR(60) NOT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 0,
  can_create TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_user_module (userID, module_key),
  CONSTRAINT fk_rights_user FOREIGN KEY (userID) REFERENCES tblUser(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblCategory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  image VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tblProductType (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  description TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tblSupplier (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(40) DEFAULT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  alternate_phone VARCHAR(30) DEFAULT NULL,
  email VARCHAR(150) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  state VARCHAR(100) DEFAULT NULL,
  pincode VARCHAR(20) DEFAULT NULL,
  country VARCHAR(80) DEFAULT 'India',
  gstin VARCHAR(30) DEFAULT NULL,
  pan VARCHAR(20) DEFAULT NULL,
  company_type VARCHAR(60) DEFAULT NULL,
  payment_terms VARCHAR(120) DEFAULT NULL,
  credit_days INT DEFAULT 0,
  credit_limit DECIMAL(12,2) DEFAULT 0,
  bank_name VARCHAR(120) DEFAULT NULL,
  bank_account_name VARCHAR(150) DEFAULT NULL,
  bank_account_no VARCHAR(60) DEFAULT NULL,
  bank_ifsc VARCHAR(30) DEFAULT NULL,
  website VARCHAR(180) DEFAULT NULL,
  contact_person VARCHAR(120) DEFAULT NULL,
  notes TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tblProduct (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoryID INT NOT NULL,
  productTypeID INT DEFAULT NULL,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  purchase_price DECIMAL(10,2) DEFAULT NULL,
  sale_price DECIMAL(10,2) DEFAULT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  sku VARCHAR(80) NOT NULL UNIQUE,
  stock_code VARCHAR(60) DEFAULT NULL,
  barcode VARCHAR(80) DEFAULT NULL,
  hsn_code VARCHAR(20) DEFAULT NULL,
  gst_rate DECIMAL(5,2) DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 10,
  reorder_qty INT NOT NULL DEFAULT 0,
  warehouse VARCHAR(120) DEFAULT NULL,
  stock_status ENUM('in_stock','low_stock','out_of_stock') NOT NULL DEFAULT 'in_stock',
  sizes VARCHAR(255) DEFAULT 'S,M,L,XL',
  colors VARCHAR(255) DEFAULT 'Black,White',
  brand VARCHAR(100) DEFAULT 'Buildnex Kadai',
  gender ENUM('men', 'women', 'kids', 'unisex') DEFAULT 'unisex',
  fabric VARCHAR(100) DEFAULT NULL,
  supplierID INT DEFAULT NULL,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (categoryID) REFERENCES tblCategory(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_type FOREIGN KEY (productTypeID) REFERENCES tblProductType(id) ON DELETE SET NULL,
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplierID) REFERENCES tblSupplier(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tblProductImage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  productID INT NOT NULL,
  image_url VARCHAR(255) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_images_product FOREIGN KEY (productID) REFERENCES tblProduct(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblProductVariant (
  id INT AUTO_INCREMENT PRIMARY KEY,
  productID INT NOT NULL,
  size VARCHAR(40) NOT NULL,
  color VARCHAR(50) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  price DECIMAL(10,2) DEFAULT NULL,
  discount DECIMAL(5,2) DEFAULT 0,
  stock_code VARCHAR(60) DEFAULT NULL,
  barcode VARCHAR(80) DEFAULT NULL,
  image_url VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_product_size_color (productID, size, color),
  CONSTRAINT fk_variants_product FOREIGN KEY (productID) REFERENCES tblProduct(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblStockMovement (
  id INT AUTO_INCREMENT PRIMARY KEY,
  productID INT NOT NULL,
  productVariantID INT DEFAULT NULL,
  movement_type ENUM('in','out','adjust','transfer','sale','return','purchase','cancel','pos') NOT NULL,
  qty INT NOT NULL,
  qty_before INT NOT NULL DEFAULT 0,
  qty_after INT NOT NULL DEFAULT 0,
  from_location VARCHAR(120) DEFAULT NULL,
  to_location VARCHAR(120) DEFAULT NULL,
  ref_type VARCHAR(40) DEFAULT NULL,
  ref_id INT DEFAULT NULL,
  note TEXT,
  createdByUserID INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_mov_product (productID),
  INDEX idx_stock_mov_variant (productVariantID),
  CONSTRAINT fk_stock_mov_product FOREIGN KEY (productID) REFERENCES tblProduct(id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_mov_variant FOREIGN KEY (productVariantID) REFERENCES tblProductVariant(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tblCartItem (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userID INT NOT NULL,
  productID INT NOT NULL,
  size VARCHAR(20) DEFAULT 'M',
  color VARCHAR(50) DEFAULT 'Black',
  quantity INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_cart_item (userID, productID, size, color),
  CONSTRAINT fk_cart_user FOREIGN KEY (userID) REFERENCES tblUser(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_product FOREIGN KEY (productID) REFERENCES tblProduct(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblWishlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userID INT NOT NULL,
  productID INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wishlist (userID, productID),
  CONSTRAINT fk_wish_user FOREIGN KEY (userID) REFERENCES tblUser(id) ON DELETE CASCADE,
  CONSTRAINT fk_wish_product FOREIGN KEY (productID) REFERENCES tblProduct(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblOrder (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userID INT NOT NULL,
  order_number VARCHAR(40) NOT NULL UNIQUE,
  order_source ENUM('online', 'pos', 'admin') NOT NULL DEFAULT 'admin',
  status ENUM(
    'pending', 'confirmed', 'processing', 'packed', 'shipped', 'delivered',
    'cancelled', 'return_requested', 'returned', 'refund_pending', 'refunded'
  ) NOT NULL DEFAULT 'pending',
  fulfillment_status ENUM(
    'unfulfilled', 'processing', 'packed', 'shipped', 'delivered', 'returned', 'cancelled'
  ) NOT NULL DEFAULT 'unfulfilled',
  payment_method ENUM('cod', 'online', 'cash', 'upi', 'card', 'credit', 'split') NOT NULL DEFAULT 'cod',
  payment_status ENUM('pending', 'paid', 'failed', 'refund_pending', 'refunded') NOT NULL DEFAULT 'pending',
  subtotal DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  round_off DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  amount_received DECIMAL(10,2) NOT NULL DEFAULT 0,
  change_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  shipping_name VARCHAR(120) NOT NULL,
  shipping_phone VARCHAR(20) NOT NULL,
  shipping_address TEXT NOT NULL,
  shipping_city VARCHAR(100) NOT NULL,
  shipping_state VARCHAR(100) NOT NULL,
  shipping_pincode VARCHAR(20) NOT NULL,
  notes TEXT DEFAULT NULL,
  client_request_id VARCHAR(64) DEFAULT NULL,
  courier VARCHAR(120) DEFAULT NULL,
  tracking_number VARCHAR(120) DEFAULT NULL,
  tracking_url VARCHAR(255) DEFAULT NULL,
  expected_delivery_date DATE DEFAULT NULL,
  shipped_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  cancellation_reason TEXT DEFAULT NULL,
  return_reason TEXT DEFAULT NULL,
  refund_amount DECIMAL(10,2) DEFAULT NULL,
  refund_method VARCHAR(80) DEFAULT NULL,
  refund_status ENUM('none', 'pending', 'completed', 'failed') NOT NULL DEFAULT 'none',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  stock_reserved TINYINT(1) NOT NULL DEFAULT 0,
  stock_deducted TINYINT(1) NOT NULL DEFAULT 0,
  refund_completed TINYINT(1) NOT NULL DEFAULT 0,
  return_restocked TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_orders_client_request (client_request_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (userID) REFERENCES tblUser(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblOrderStatusHistory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderID INT NOT NULL,
  from_status VARCHAR(40) DEFAULT NULL,
  to_status VARCHAR(40) NOT NULL,
  payment_status VARCHAR(40) DEFAULT NULL,
  fulfillment_status VARCHAR(40) DEFAULT NULL,
  note TEXT DEFAULT NULL,
  createdByUserID INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_osh_order (orderID),
  CONSTRAINT fk_osh_order FOREIGN KEY (orderID) REFERENCES tblOrder(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblOrderItem (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderID INT NOT NULL,
  productID INT NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  size VARCHAR(20) DEFAULT NULL,
  color VARCHAR(50) DEFAULT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (orderID) REFERENCES tblOrder(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (productID) REFERENCES tblProduct(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tblPosPayment (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderID INT NOT NULL,
  method ENUM('cash', 'upi', 'card', 'credit', 'online', 'cod') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference_no VARCHAR(120) DEFAULT NULL,
  status ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'paid',
  paid_at DATETIME DEFAULT NULL,
  receivedByUserID INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pos_pay_order (orderID),
  CONSTRAINT fk_pos_pay_order FOREIGN KEY (orderID) REFERENCES tblOrder(id) ON DELETE CASCADE,
  CONSTRAINT fk_pos_pay_user FOREIGN KEY (receivedByUserID) REFERENCES tblUser(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tblPaymentGateway (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  api_key VARCHAR(255) DEFAULT NULL,
  secret_key VARCHAR(255) DEFAULT NULL,
  webhook_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  mode ENUM('test', 'live') NOT NULL DEFAULT 'test',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tblBilling (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(40) NOT NULL UNIQUE,
  orderID INT DEFAULT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(150) DEFAULT NULL,
  amount DECIMAL(12,2) NOT NULL,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL,
  status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled') NOT NULL DEFAULT 'draft',
  due_date DATE DEFAULT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_billing_order FOREIGN KEY (orderID) REFERENCES tblOrder(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tblDropshipOrder (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_no VARCHAR(40) NOT NULL UNIQUE,
  supplier_name VARCHAR(150) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  sell_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  customer_name VARCHAR(120) NOT NULL,
  shipping_address TEXT NOT NULL,
  status ENUM('pending', 'ordered', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
  tracking_no VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tblFinanceEntry (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_date DATE NOT NULL,
  type ENUM('income', 'expense') NOT NULL,
  category VARCHAR(100) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference_no VARCHAR(80) DEFAULT NULL,
  description TEXT,
  createdByUserID INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_finance_user FOREIGN KEY (createdByUserID) REFERENCES tblUser(id) ON DELETE SET NULL
) ENGINE=InnoDB;
