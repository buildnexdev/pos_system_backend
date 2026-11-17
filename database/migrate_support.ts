/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_support
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function tableExists(db, table) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0].cnt) > 0;
}

async function columnExists(db, table, column) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].cnt) > 0;
}

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
    multipleStatements: true,
  });

  if (!(await tableExists(db, 'support_settings'))) {
    await db.query(`
      CREATE TABLE support_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        shop_name VARCHAR(160) NOT NULL DEFAULT 'Buildnex Kadai',
        support_email VARCHAR(160) DEFAULT 'support@buildnexkadai.com',
        support_phone VARCHAR(40) DEFAULT NULL,
        whatsapp_number VARCHAR(40) DEFAULT NULL,
        business_hours VARCHAR(255) DEFAULT 'Mon–Sat, 9:00 AM – 7:00 PM IST',
        response_time_info VARCHAR(255) DEFAULT 'We typically reply within 24 business hours.',
        updated_by INT DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_support_settings_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created support_settings');
  } else {
    console.log('skip support_settings');
  }

  if (!(await tableExists(db, 'support_categories'))) {
    await db.query(`
      CREATE TABLE support_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        name VARCHAR(120) NOT NULL,
        slug VARCHAR(140) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uniq_support_cat_slug (tenant_id, slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created support_categories');
  } else {
    console.log('skip support_categories');
  }

  if (!(await tableExists(db, 'help_articles'))) {
    await db.query(`
      CREATE TABLE help_articles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        category_id INT DEFAULT NULL,
        title VARCHAR(220) NOT NULL,
        slug VARCHAR(240) NOT NULL,
        summary VARCHAR(500) DEFAULT NULL,
        body MEDIUMTEXT NOT NULL,
        tags VARCHAR(255) DEFAULT NULL,
        module_key VARCHAR(80) DEFAULT NULL,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_help_article_slug (tenant_id, slug),
        KEY idx_help_articles_cat (category_id),
        KEY idx_help_articles_search (title, tags)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created help_articles');
  } else {
    console.log('skip help_articles');
  }

  if (!(await tableExists(db, 'support_tickets'))) {
    await db.query(`
      CREATE TABLE support_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        ticket_no VARCHAR(32) NOT NULL,
        subject VARCHAR(220) NOT NULL,
        category VARCHAR(120) NOT NULL,
        related_module VARCHAR(80) DEFAULT NULL,
        priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
        status ENUM('open','in_progress','waiting_customer','resolved','closed') NOT NULL DEFAULT 'open',
        description TEXT NOT NULL,
        createdByUserID INT NOT NULL,
        assigned_to INT DEFAULT NULL,
        shop_name VARCHAR(160) DEFAULT NULL,
        first_response_at DATETIME DEFAULT NULL,
        resolved_at DATETIME DEFAULT NULL,
        closed_at DATETIME DEFAULT NULL,
        last_customer_reply_at DATETIME DEFAULT NULL,
        last_staff_reply_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_support_ticket_no (ticket_no),
        KEY idx_support_tickets_tenant (tenant_id),
        KEY idx_support_tickets_status (status),
        KEY idx_support_tickets_assigned (assigned_to),
        KEY idx_support_tickets_created_by (createdByUserID)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created support_tickets');
  } else {
    console.log('skip support_tickets');
  }

  // Align legacy created_by → createdByUserID used by API
  if (await tableExists(db, 'support_tickets')) {
    if (
      (await columnExists(db, 'support_tickets', 'created_by')) &&
      !(await columnExists(db, 'support_tickets', 'createdByUserID'))
    ) {
      await db.query(
        `ALTER TABLE support_tickets CHANGE COLUMN created_by createdByUserID INT NOT NULL`
      );
      console.log('renamed support_tickets.created_by → createdByUserID');
    }
  }

  if (!(await tableExists(db, 'support_ticket_messages'))) {
    await db.query(`
      CREATE TABLE support_ticket_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id INT NOT NULL,
        tenant_id INT NOT NULL DEFAULT 1,
        sender_id INT NOT NULL,
        sender_role ENUM('customer','support','admin') NOT NULL DEFAULT 'customer',
        message TEXT NOT NULL,
        is_internal TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_support_msg_ticket (ticket_id),
        KEY idx_support_msg_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created support_ticket_messages');
  } else {
    console.log('skip support_ticket_messages');
  }

  if (!(await tableExists(db, 'support_ticket_attachments'))) {
    await db.query(`
      CREATE TABLE support_ticket_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id INT NOT NULL,
        message_id INT DEFAULT NULL,
        tenant_id INT NOT NULL DEFAULT 1,
        original_name VARCHAR(255) NOT NULL,
        stored_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(120) NOT NULL,
        file_size INT NOT NULL DEFAULT 0,
        uploaded_by INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_support_att_ticket (ticket_id),
        KEY idx_support_att_message (message_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created support_ticket_attachments');
  } else {
    console.log('skip support_ticket_attachments');
  }

  if (!(await tableExists(db, 'support_ticket_history'))) {
    await db.query(`
      CREATE TABLE support_ticket_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id INT NOT NULL,
        tenant_id INT NOT NULL DEFAULT 1,
        actor_id INT DEFAULT NULL,
        action VARCHAR(80) NOT NULL,
        from_value VARCHAR(120) DEFAULT NULL,
        to_value VARCHAR(120) DEFAULT NULL,
        note VARCHAR(500) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_support_hist_ticket (ticket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('created support_ticket_history');
  } else {
    console.log('skip support_ticket_history');
  }

  const [[settingsCount]] = await db.query('SELECT COUNT(*) AS c FROM support_settings');
  if (!Number(settingsCount.c)) {
    await db.query(`
      INSERT INTO support_settings
        (tenant_id, shop_name, support_email, support_phone, whatsapp_number, business_hours, response_time_info)
      VALUES
        (1, 'Buildnex Kadai', 'support@buildnexkadai.com', '+91 98765 43210', '+91 98765 43210',
         'Mon–Sat, 9:00 AM – 7:00 PM IST', 'We typically reply within 24 business hours.')
    `);
    console.log('seeded support_settings');
  }

  const [[catCount]] = await db.query('SELECT COUNT(*) AS c FROM support_categories');
  if (!Number(catCount.c)) {
    const cats = [
      ['Getting Started', 'getting-started', 1],
      ['Product Management', 'product-management', 2],
      ['Inventory Management', 'inventory-management', 3],
      ['POS Billing', 'pos-billing', 4],
      ['Order Management', 'order-management', 5],
      ['Online Store', 'online-store', 6],
      ['Payment and Finance', 'payment-finance', 7],
      ['Account and Settings', 'account-settings', 8],
      ['Frequently Asked Questions', 'faq', 9],
    ];
    for (const [name, slug, sort] of cats) {
      await db.query(
        `INSERT INTO support_categories (tenant_id, name, slug, sort_order) VALUES (0, ?, ?, ?)`,
        [name, slug, sort]
      );
    }
    console.log('seeded support_categories');
  }

  const [[artCount]] = await db.query('SELECT COUNT(*) AS c FROM help_articles');
  if (!Number(artCount.c)) {
    const [cats] = await db.query('SELECT id, slug FROM support_categories');
    const bySlug = Object.fromEntries(cats.map((c) => [c.slug, c.id]));
    const articles = [
      {
        slug: 'getting-started',
        category: 'getting-started',
        title: 'Getting started with BuildNex ShopOS',
        summary: 'Learn how to set up your shop, invite staff, and configure branches.',
        module_key: 'dashboard',
        body: `## Welcome to BuildNex ShopOS

1. Complete your shop profile and branding.
2. Add branches and warehouses.
3. Create staff accounts and assign access rights.
4. Add product types, suppliers, and catalog products.
5. Open POS Billing to start selling.

Tip: Keep stock quantities accurate before your first sale day.`,
      },
      {
        slug: 'product-management',
        category: 'product-management',
        title: 'Managing products and variants',
        summary: 'Create catalog products, variants, pricing, and images.',
        module_key: 'catalog',
        body: `## Product Management

- Use **Products** to create catalog items.
- Add size, color, and SKU details in Stock.
- Set sale price and MRP carefully for POS and online orders.
- Archive discontinued items instead of deleting when history exists.`,
      },
      {
        slug: 'inventory-help',
        category: 'inventory-management',
        title: 'Inventory and stock movements',
        summary: 'Track stock, transfers, and low-stock alerts.',
        module_key: 'product',
        body: `## Inventory Help

- Record inbound stock against suppliers.
- Move stock between warehouses.
- Watch low-stock alerts from the header notifications.
- Use Stock Report for audits.`,
      },
      {
        slug: 'pos-billing-help',
        category: 'pos-billing',
        title: 'POS Billing guide',
        summary: 'Checkout customers quickly with cash, UPI, card, or split payments.',
        module_key: 'billing',
        body: `## POS Billing

1. Search available stock SKUs.
2. Add customer or walk-in.
3. Apply discounts if needed.
4. Collect payment and print/share invoice.
Only available stock can be billed.`,
      },
      {
        slug: 'order-management-help',
        category: 'order-management',
        title: 'Order management basics',
        summary: 'Track, fulfill, cancel, and archive customer orders.',
        module_key: 'order',
        body: `## Orders

- Filter by status and date.
- Update fulfillment progress.
- Cancel only when stock can be restored safely.
- Archive completed history for cleaner queues.`,
      },
      {
        slug: 'payment-finance-help',
        category: 'payment-finance',
        title: 'Payments, ledger and finance books',
        summary: 'Understand billing reports, expenses, and daybook entries.',
        module_key: 'finance',
        body: `## Payment & Finance

- Use Finance → Accounts, Ledger, Daybook for bookkeeping.
- Expense and Spent reports summarize outflow.
- Billing Report covers POS invoices.`,
      },
      {
        slug: 'account-settings-help',
        category: 'account-settings',
        title: 'Account, roles and access control',
        summary: 'Manage staff permissions safely.',
        module_key: 'access_control',
        body: `## Account & Settings

- Create roles under User Control.
- Assign module rights per staff member.
- Never share admin credentials.
- Update your profile from the header menu.`,
      },
      {
        slug: 'faq',
        category: 'faq',
        title: 'Frequently asked questions',
        summary: 'Quick answers to common shop owner questions.',
        module_key: null,
        body: `## FAQ

**How do I raise a ticket?**  
Open Help & Support → Create Ticket, attach a screenshot, and submit.

**Who can see my tickets?**  
Only your shop users and BuildNex support staff assigned to your ticket.

**Can I reopen a ticket?**  
Yes, Resolved tickets can be reopened when still within policy.`,
      },
    ];

    for (let i = 0; i < articles.length; i += 1) {
      const a = articles[i];
      await db.query(
        `INSERT INTO help_articles
          (tenant_id, category_id, title, slug, summary, body, tags, module_key, sort_order)
         VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bySlug[a.category] || null,
          a.title,
          a.slug,
          a.summary,
          a.body,
          a.title,
          a.module_key,
          i + 1,
        ]
      );
    }
    console.log('seeded help_articles');
  }

  await db.end();
  console.log('support migration done');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
