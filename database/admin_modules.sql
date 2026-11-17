USE garments_shop;

ALTER TABLE tblUser
  MODIFY role ENUM('customer', 'admin', 'staff') NOT NULL DEFAULT 'customer';

ALTER TABLE tblUser
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;

-- MySQL versions without IF NOT EXISTS for columns: safe recreate helpers below
CREATE TABLE IF NOT EXISTS tblProductType (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  description TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tblUserRight (
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

CREATE TABLE IF NOT EXISTS tblPaymentGateway (
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

CREATE TABLE IF NOT EXISTS tblBilling (
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

CREATE TABLE IF NOT EXISTS tblDropshipOrder (
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

CREATE TABLE IF NOT EXISTS tblFinanceEntry (
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

-- Link tblProduct to product type if column missing (ignore error if exists)
-- ALTER TABLE tblProduct ADD COLUMN productTypeID INT NULL;
