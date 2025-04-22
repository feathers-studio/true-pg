-- Enum for user roles
CREATE TYPE user_role AS ENUM ('admin', 'customer');

-- Enum for order status
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');

-- Domain for email addresses with basic validation
CREATE DOMAIN email AS TEXT CHECK (VALUE ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');

-- Domain for positive numeric values (e.g., prices, quantities)
CREATE DOMAIN positive_numeric AS NUMERIC CHECK (VALUE > 0);

-- Composite type for addresses
CREATE TYPE address AS (
    street TEXT,
    city TEXT,
    postal_code VARCHAR(10),
    country VARCHAR(2) -- ISO 3166-1 alpha-2 country code
);

-- Range type for discount validity periods
CREATE TYPE validity_period AS RANGE (
    subtype = timestamptz
);

-- Table for users
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email email NOT NULL, -- Using the email domain
    role user_role NOT NULL DEFAULT 'customer', -- Using the user_role enum
    shipping_address address, -- Using the address composite type
    unknown_column pg_catalog.oidvector, -- This exists to test that the extractor can handle types that don't have a default mapping
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table for products
CREATE TABLE products (
    product_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price positive_numeric NOT NULL, -- Using the positive_numeric domain
    stock_quantity INT CHECK (stock_quantity >= 0) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    validity validity_period, -- Using the validity_period range type
    unknown_column pg_catalog.oidvector, -- This exists to test that the extractor can handle types that don't have a default mapping
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table for orders
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id),
    order_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    status order_status NOT NULL DEFAULT 'pending', -- Using the order_status enum
    shipping_address address, -- Using the address composite type (could be copied from user or specified per order)
    unknown_column pg_catalog.oidvector, -- This exists to test that the extractor can handle types that don't have a default mapping
    total_amount positive_numeric -- This could be calculated or updated later
);

-- Table for order items (linking orders and products)
CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id),
    quantity INT CHECK (quantity > 0) NOT NULL,
    price_at_purchase positive_numeric NOT NULL, -- Store the price at the time of purchase
    UNIQUE (order_id, product_id) -- Ensure a product appears only once per order
);

-- View for active products currently within their validity period
CREATE VIEW active_products AS
SELECT
    product_id,
    name,
    description,
    price,
    stock_quantity
FROM
    products
WHERE
    is_active = TRUE
    AND (validity IS NULL OR validity @> CURRENT_TIMESTAMP); -- Check if current time is within the range

-- Materialized view for monthly sales summary
CREATE MATERIALIZED VIEW monthly_sales_summary AS
SELECT
    DATE_TRUNC('month', o.order_date)::DATE AS sales_month,
    COUNT(DISTINCT o.order_id) AS total_orders,
    SUM(oi.quantity * oi.price_at_purchase) AS total_revenue,
    SUM(oi.quantity) AS total_items_sold
FROM
    orders o
JOIN
    order_items oi ON o.order_id = oi.order_id
WHERE
    o.status NOT IN ('cancelled') -- Exclude cancelled orders from sales summary
GROUP BY
    sales_month
ORDER BY
    sales_month;

-- To refresh the materialized view:
-- REFRESH MATERIALIZED VIEW monthly_sales_summary;

-- Function to calculate the total amount for a given order
CREATE OR REPLACE FUNCTION calculate_order_total(p_order_id INT)
RETURNS NUMERIC -- Using NUMERIC to allow for 0 total
LANGUAGE sql
STABLE -- Indicates the function cannot modify the database and always returns the same results for the same arguments within a single statement scan
AS $$
    SELECT COALESCE(SUM(quantity * price_at_purchase), 0)
    FROM order_items
    WHERE order_id = p_order_id;
$$;

-- Example of how to use the function to update the orders table:
-- UPDATE orders SET total_amount = calculate_order_total(order_id) WHERE order_id = some_order_id;

-- Alternatively, you could use a trigger on the order_items table
-- to automatically update the orders.total_amount whenever items are added/updated/deleted.
