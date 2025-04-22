-- sample/seed.sql
-- Seed data for the e-commerce database

-- Insert Users
INSERT INTO users (username, email, role, shipping_address) VALUES
('alice_admin', 'alice@example.com', 'admin', ROW('123 Admin St', 'Admintown', 'A1A 1A1', 'CA')),
('bob_customer', 'bob@example.com', 'customer', ROW('456 Customer Ave', 'Custville', 'C2C 2C2', 'US')),
('charlie_customer', 'charlie@example.com', 'customer', ROW('789 Shopper Blvd', 'Shopburg', 'S3S 3S3', 'GB'));

-- Insert Products
-- Product 1: Always available
INSERT INTO products (name, description, price, stock_quantity, is_active) VALUES
('Laptop Pro', 'High-performance laptop', 1299.99, 50, TRUE),
('Wireless Mouse', 'Ergonomic wireless mouse', 25.50, 200, TRUE);

-- Product 2: Limited time offer (e.g., valid only in December 2024)
INSERT INTO products (name, description, price, stock_quantity, is_active, validity) VALUES
('Holiday Bundle', 'Special holiday gift set', 49.99, 100, TRUE,
 '[2024-12-01 00:00:00+00, 2025-01-01 00:00:00+00)'); -- Using timestamptz range

-- Product 3: Inactive product
INSERT INTO products (name, description, price, stock_quantity, is_active) VALUES
('Old Keyboard', 'Discontinued model', 15.00, 0, FALSE);

-- Insert Orders
-- Order 1: Bob buys a Laptop Pro and a Mouse
INSERT INTO orders (user_id, status, shipping_address) VALUES
((SELECT user_id FROM users WHERE username = 'bob_customer'), 'shipped', (SELECT shipping_address FROM users WHERE username = 'bob_customer')); -- Use Bob's default address

-- Order 2: Charlie buys a Mouse
INSERT INTO orders (user_id, status, shipping_address) VALUES
((SELECT user_id FROM users WHERE username = 'charlie_customer'), 'processing', ROW('10 Downing St', 'London', 'SW1A 2AA', 'GB')); -- Use a different address

-- Order 3: Bob buys the Holiday Bundle (assuming current date is within validity)
INSERT INTO orders (user_id, status, shipping_address) VALUES
((SELECT user_id FROM users WHERE username = 'bob_customer'), 'pending', (SELECT shipping_address FROM users WHERE username = 'bob_customer'));

-- Insert Order Items
-- Items for Order 1
INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES
(1, (SELECT product_id FROM products WHERE name = 'Laptop Pro'), 1, (SELECT price FROM products WHERE name = 'Laptop Pro')),
(1, (SELECT product_id FROM products WHERE name = 'Wireless Mouse'), 1, (SELECT price FROM products WHERE name = 'Wireless Mouse'));

-- Items for Order 2
INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES
(2, (SELECT product_id FROM products WHERE name = 'Wireless Mouse'), 2, (SELECT price FROM products WHERE name = 'Wireless Mouse'));

-- Items for Order 3
INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES
(3, (SELECT product_id FROM products WHERE name = 'Holiday Bundle'), 1, (SELECT price FROM products WHERE name = 'Holiday Bundle'));

-- Update order totals using the function
UPDATE orders SET total_amount = calculate_order_total(order_id) WHERE order_id = 1;
UPDATE orders SET total_amount = calculate_order_total(order_id) WHERE order_id = 2;
UPDATE orders SET total_amount = calculate_order_total(order_id) WHERE order_id = 3;

-- Refresh the materialized view to include the new data
REFRESH MATERIALIZED VIEW monthly_sales_summary;

-- Verify data (optional)
-- SELECT * FROM users;
-- SELECT * FROM products;
-- SELECT * FROM active_products;
-- SELECT * FROM orders;
-- SELECT * FROM order_items;
-- SELECT calculate_order_total(1);
-- SELECT * FROM monthly_sales_summary;
