/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Initial database schema and seed setup
 * Edit Date: 2026-11-12
 */

import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { MODULES, fullRights  } from '../config/modules';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const connection: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    multipleStatements: true
  });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await connection.query(schema);
  console.log('Schema created.');

  const adminHash = await bcrypt.hash('Admin@123', 10);
  const customerHash = await bcrypt.hash('Customer@123', 10);
  const staffHash = await bcrypt.hash('Staff@123', 10);

  // Ensure system roles exist (admin / staff / customer)
  await connection.query(
    `INSERT INTO tblRole (RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive) VALUES
     ('Admin', 'admin', 1, 'Company / system admin', '#7c3aed', 1, 1),
     ('Staff', 'staff', 7, 'Panel staff account', '#64748b', 1, 1),
     ('Customer', 'customer', 99, 'Storefront customer account', '#64748b', 1, 1)
     ON DUPLICATE KEY UPDATE IsActive = 1`
  );
  const [[adminRole]] = await connection.query(`SELECT roleID FROM tblRole WHERE RoleCode = 'admin' LIMIT 1`);
  const [[staffRole]] = await connection.query(`SELECT roleID FROM tblRole WHERE RoleCode = 'staff' LIMIT 1`);
  const [[customerRole]] = await connection.query(`SELECT roleID FROM tblRole WHERE RoleCode = 'customer' LIMIT 1`);

  await connection.query(
    `INSERT INTO tblUser (name, email, password, phone, address, city, state, pincode, roleID, is_active) VALUES
     (?, ?, ?, ?, ?, ?, ?, ?, ?, 1),
     (?, ?, ?, ?, ?, ?, ?, ?, ?, 1),
     (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      'Shop Admin', 'admin@garments.com', adminHash, '9876543210', '12 Fashion Street', 'Chennai', 'Tamil Nadu', '600001', adminRole.roleID,
      'Demo Customer', 'customer@garments.com', customerHash, '9123456780', '45 Market Road', 'Chennai', 'Tamil Nadu', '600002', customerRole.roleID,
      'Shop Staff', 'staff@garments.com', staffHash, '9000000001', '88 Staff Lane', 'Chennai', 'Tamil Nadu', '600003', staffRole.roleID
    ]
  );

  // Staff default rights: view most modules, limited create/edit
  for (const m of MODULES) {
    const canCreate = ['product', 'order', 'billing', 'dropshipping'].includes(m.key) ? 1 : 0;
    const canEdit = ['product', 'order', 'billing', 'dropshipping'].includes(m.key) ? 1 : 0;
    const canDelete = 0;
    const canView = m.key === 'access_control' || m.key === 'staff' ? 0 : 1;
    await connection.query(
      `INSERT INTO tblUserRight (userID, module_key, can_view, can_create, can_edit, can_delete)
       VALUES (3, ?, ?, ?, ?, ?)`,
      [m.key, canView, canCreate, canEdit, canDelete]
    );
  }

  await connection.query(`
    INSERT INTO tblCategory (name, slug, description) VALUES
    ('Men', 'men', 'Shirts, trousers, jeans and ethnic wear for men'),
    ('Women', 'women', 'Kurtis, dresses, tops and ethnic wear for women'),
    ('Kids', 'kids', 'Comfortable everyday wear for kids'),
    ('Accessories', 'accessories', 'Belts, caps, bags and finishing touches')
  `);

  await connection.query(`
    INSERT INTO tblProductType (name, slug, description) VALUES
    ('Apparel', 'apparel', 'Shirts, dresses, kurtis and clothing'),
    ('Bottom Wear', 'bottom-wear', 'Jeans, trousers, shorts'),
    ('Ethnic', 'ethnic', 'Kurtas, anarkali and festive wear'),
    ('Accessories', 'accessories', 'Belts, bags, caps')
  `);

  await connection.query(`
    INSERT INTO tblSupplier (name, phone, email, address, contact_person, is_active) VALUES
    ('StyleWear Suppliers', '9876500001', 'supply@stylewear.com', '12 Textile Hub, Tirupur', 'Ravi Kumar', 1),
    ('DenimCo India', '9876500002', 'tblOrder@denimco.in', '88 Denim Park, Bangalore', 'Anita Shah', 1),
    ('EthnicEdge Traders', '9876500003', 'hello@ethnicedge.in', '5 Silk Street, Surat', 'Meera Patel', 1)
  `);

  await connection.query(`
    INSERT INTO tblProduct (categoryID, productTypeID, name, slug, description, price, sale_price, sku, stock, sizes, colors, brand, gender, fabric, is_featured) VALUES
    (1, 1, 'Classic Cotton Shirt', 'classic-cotton-shirt', 'Breathable formal cotton shirt for office and casual wear.', 1499.00, 1199.00, 'MEN-SHIRT-001', 40, 'S,M,L,XL,XXL', 'White,Blue,Black', 'StyleWear', 'men', 'Cotton', 1),
    (1, 2, 'Slim Fit Denim Jeans', 'slim-fit-denim-jeans', 'Stretch denim jeans with a modern slim silhouette.', 1999.00, 1599.00, 'MEN-JEANS-001', 35, '28,30,32,34,36', 'Blue,Black', 'DenimCo', 'men', 'Denim', 1),
    (1, 1, 'Casual Polo T-Shirt', 'casual-polo-tshirt', 'Soft pique polo for weekend comfort.', 899.00, NULL, 'MEN-POLO-001', 50, 'S,M,L,XL', 'Navy,Olive,Maroon', 'StyleWear', 'men', 'Cotton', 0),
    (1, 3, 'Linen Summer Kurta', 'linen-summer-kurta', 'Light linen kurta for festive and casual occasions.', 1799.00, 1499.00, 'MEN-KURTA-001', 25, 'M,L,XL', 'Beige,White', 'EthnicEdge', 'men', 'Linen', 1),
    (2, 3, 'Floral Print Kurti', 'floral-print-kurti', 'Everyday ethnic kurti with soft floral print.', 1299.00, 999.00, 'WOM-KURTI-001', 45, 'S,M,L,XL', 'Pink,Yellow,Teal', 'EthnicEdge', 'women', 'Rayon', 1),
    (2, 1, 'A-Line Cotton Dress', 'a-line-cotton-dress', 'Comfortable A-line dress for day outings.', 1899.00, 1599.00, 'WOM-DRESS-001', 30, 'S,M,L,XL', 'Mint,Lavender', 'StyleWear', 'women', 'Cotton', 1),
    (2, 2, 'High-Rise Skinny Jeans', 'high-rise-skinny-jeans', 'Stretch skinny jeans with high waist fit.', 2099.00, NULL, 'WOM-JEANS-001', 28, '26,28,30,32', 'Blue,Black', 'DenimCo', 'women', 'Denim', 0),
    (2, 3, 'Embroidered Anarkali', 'embroidered-anarkali', 'Festive anarkali with delicate embroidery.', 3499.00, 2999.00, 'WOM-ANAR-001', 18, 'S,M,L,XL', 'Red,Green', 'EthnicEdge', 'women', 'Georgette', 1),
    (3, 1, 'Kids Graphic Tee', 'kids-graphic-tee', 'Soft cotton tee with playful graphic print.', 499.00, 399.00, 'KID-TEE-001', 60, '3-4Y,5-6Y,7-8Y,9-10Y', 'White,Yellow', 'KidJoy', 'kids', 'Cotton', 1),
    (3, 2, 'Kids Cargo Shorts', 'kids-cargo-shorts', 'Durable cargo shorts for active play.', 699.00, NULL, 'KID-SHORT-001', 40, '3-4Y,5-6Y,7-8Y', 'Khaki,Navy', 'KidJoy', 'kids', 'Cotton', 0),
    (3, 1, 'Girls Party Frock', 'girls-party-frock', 'Cute frock for birthdays and family events.', 1299.00, 1099.00, 'KID-FROCK-001', 22, '3-4Y,5-6Y,7-8Y', 'Pink,Peach', 'KidJoy', 'kids', 'Net', 1),
    (4, 4, 'Leather Belt', 'leather-belt', 'Classic leather belt with metal buckle.', 799.00, 649.00, 'ACC-BELT-001', 55, 'One Size', 'Brown,Black', 'StyleWear', 'unisex', 'Leather', 0),
    (4, 4, 'Canvas Tote Bag', 'canvas-tote-bag', 'Everyday canvas tote for shopping and travel.', 599.00, NULL, 'ACC-TOTE-001', 70, 'One Size', 'Beige,Black', 'StyleWear', 'unisex', 'Canvas', 1),
    (4, 4, 'Cotton Cap', 'cotton-cap', 'Adjustable cotton cap for sunny days.', 399.00, 299.00, 'ACC-CAP-001', 80, 'One Size', 'Black,Navy,Grey', 'StyleWear', 'unisex', 'Cotton', 0)
  `);

  await connection.query(`
    INSERT INTO tblProductImage (productID, image_url, is_primary) VALUES
    (1, 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600', 1),
    (2, 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600', 1),
    (3, 'https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?w=600', 1),
    (4, 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600', 1),
    (5, 'https://images.unsplash.com/photo-1610030469983-98e550d4803a?w=600', 1),
    (6, 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600', 1),
    (7, 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600', 1),
    (8, 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=600', 1),
    (9, 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=600', 1),
    (10, 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=600', 1),
    (11, 'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=600', 1),
    (12, 'https://images.unsplash.com/photo-1624222247344-550fb60583fd?w=600', 1),
    (13, 'https://images.unsplash.com/photo-1590874103328-eac38a67437a?w=600', 1),
    (14, 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600', 1)
  `);

  await connection.query(`
    INSERT INTO tblPaymentGateway (name, provider, api_key, secret_key, is_active, mode) VALUES
    ('Razorpay Test', 'razorpay', 'rzp_test_xxx', 'secret_xxx', 1, 'test'),
    ('Cash on Delivery', 'cod', NULL, NULL, 1, 'live')
  `);

  await connection.query(`
    INSERT INTO tblFinanceEntry (entry_date, type, category, amount, reference_no, description, createdByUserID) VALUES
    (CURDATE(), 'income', 'Sales', 1599.00, 'FIN-001', 'Demo sales income', 1),
    (CURDATE(), 'expense', 'Shipping', 120.00, 'FIN-002', 'Courier charges', 1)
  `);

  await connection.query(`
    INSERT INTO tblDropshipOrder
    (reference_no, supplier_name, product_name, quantity, cost_price, sell_price, customer_name, shipping_address, status)
    VALUES
    ('DS-1001', 'Supplier Hub', 'Classic Cotton Shirt', 2, 700.00, 1199.00, 'Demo Customer', '45 Market Road, Chennai', 'pending')
  `);

  console.log('Seed data inserted.');
  console.log('Admin: admin@garments.com / Admin@123');
  console.log('Staff: staff@garments.com / Staff@123');
  console.log('Customer: customer@garments.com / Customer@123');
  console.log('Modules:', MODULES.map((m) => m.key).join(', '));
  console.log('Admin has full rights:', fullRights().length);
  await connection.end();
}

run().catch((err) => {
  console.error('Database setup failed:', err.message);
  process.exit(1);
});
