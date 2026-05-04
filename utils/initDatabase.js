const pool = require('./database');

async function ensureShopSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      product_name TEXT NOT NULL,
      product_key TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      image_url TEXT,
      price NUMERIC(10, 2) NOT NULL DEFAULT 0,
      robux_price INTEGER,
      one_time BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'available',
      added_by TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reserved_by TEXT,
      reserved_at TIMESTAMPTZ,
      purchased_by TEXT,
      purchased_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS baskets (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, item_id)
    )
  `);

  await pool.query(`
    ALTER TABLE baskets
    ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_items_product_key
      ON items (product_key)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_items_status
      ON items (status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_baskets_user_id
      ON baskets (user_id)
  `);
}

module.exports = { ensureShopSchema };
