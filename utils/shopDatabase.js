const pool = require('./database');

function normalizeProductName(value) {
  return value.trim().toLowerCase();
}

function createItemId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

//
// ✅ ADD CODE
//
async function addCode(
  productName,
  code,
  addedBy,
  oneTime = false,
  imageUrl = null,
  price = 0,
  robuxPrice = null
) {
  const id = createItemId();

  await pool.query(
    `INSERT INTO items 
    (id, product_name, product_key, code, image_url, price, robux_price, one_time, status, added_by, added_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'available',$9,NOW())`,
    [
      id,
      productName,
      normalizeProductName(productName),
      code,
      imageUrl,
      price,
      robuxPrice,
      oneTime,
      addedBy,
    ]
  );

  return {
    id,
    productName,
    code,
    imageUrl,
    price,
    robuxPrice,
    oneTime,
    status: 'available',
  };
}

//
// ✅ ADD TO BASKET
//
async function addToBasket(userId, code) {
  const { rows } = await pool.query(
    `SELECT * FROM items WHERE code = $1`,
    [code.trim()]
  );

  const item = rows[0];
  if (!item) return null;

  if (item.one_time && item.status !== 'available') return false;

  const existing = await pool.query(
    `SELECT quantity FROM baskets WHERE user_id=$1 AND item_id=$2`,
    [userId, item.id]
  );

  if (existing.rows.length > 0) {
    if (item.one_time) return 'duplicate';

    await pool.query(
      `UPDATE baskets
       SET quantity = quantity + 1, added_at = NOW()
       WHERE user_id=$1 AND item_id=$2`,
      [userId, item.id]
    );

    return item;
  }

  if (item.one_time) {
    await pool.query(
      `UPDATE items 
       SET status='reserved', reserved_by=$1, reserved_at=NOW() 
       WHERE id=$2`,
      [userId, item.id]
    );
  }

  await pool.query(
    `INSERT INTO baskets (user_id, item_id) VALUES ($1,$2)`,
    [userId, item.id]
  );

  return item;
}

async function addProductToBasket(userId, productName) {
  const productKey = normalizeProductName(productName);

  const reusableExisting = await pool.query(
    `
    SELECT i.*, b.quantity
    FROM baskets b
    JOIN items i ON i.id = b.item_id
    WHERE b.user_id = $1
      AND i.product_key = $2
      AND i.one_time = false
    ORDER BY b.added_at DESC, i.added_at ASC
    LIMIT 1
    `,
    [userId, productKey]
  );

  const existingReusableItem = reusableExisting.rows[0];

  if (existingReusableItem) {
    await pool.query(
      `UPDATE baskets
       SET quantity = quantity + 1, added_at = NOW()
       WHERE user_id=$1 AND item_id=$2`,
      [userId, existingReusableItem.id]
    );

    return existingReusableItem;
  }

  const { rows } = await pool.query(
    `
    SELECT i.*
    FROM items i
    WHERE i.product_key = $1
      AND (
        i.one_time = false
        OR (i.one_time = true AND i.status = 'available')
      )
    ORDER BY
      CASE WHEN i.one_time THEN 1 ELSE 0 END,
      i.added_at ASC
    LIMIT 1
    `,
    [productKey]
  );

  const item = rows[0];

  if (!item) {
    return null;
  }

  if (item.one_time) {
    await pool.query(
      `UPDATE items
       SET status='reserved', reserved_by=$1, reserved_at=NOW()
       WHERE id=$2`,
      [userId, item.id]
    );
  }

  await pool.query(
    `INSERT INTO baskets (user_id, item_id, quantity) VALUES ($1,$2,1)`,
    [userId, item.id]
  );

  return item;
}

//
// ✅ GET BASKET
//
async function getBasket(userId) {
  const { rows } = await pool.query(
    `SELECT i.* FROM baskets b
     JOIN items i ON b.item_id = i.id
     CROSS JOIN LATERAL generate_series(1, COALESCE(b.quantity, 1))
     WHERE b.user_id = $1`,
    [userId]
  );

  return rows;
}

//
// ✅ TOTALS (GBP + ROBUX)
//
async function getBasketTotal(userId) {
  const { rows } = await pool.query(
    `SELECT 
      COALESCE(SUM(price * b.quantity),0) as total_gbp,
      COALESCE(SUM(COALESCE(robux_price, 0) * b.quantity),0) as total_robux
     FROM baskets b
     JOIN items i ON b.item_id = i.id
     WHERE b.user_id = $1`,
    [userId]
  );

  return {
    gbp: Number(rows[0].total_gbp),
    robux: Number(rows[0].total_robux),
  };
}

//
// ✅ REMOVE FROM BASKET
//
async function removeFromBasket(userId, code) {
  const { rows } = await pool.query(
    `SELECT i.* FROM items i
     JOIN baskets b ON b.item_id = i.id
     WHERE b.user_id = $1 AND i.code = $2`,
    [userId, code.trim()]
  );

  const item = rows[0];
  if (!item) return null;

  const basketEntry = await pool.query(
    `SELECT quantity FROM baskets WHERE user_id=$1 AND item_id=$2`,
    [userId, item.id]
  );

  const quantity = Number(basketEntry.rows[0]?.quantity || 0);

  if (quantity > 1 && !item.one_time) {
    await pool.query(
      `UPDATE baskets
       SET quantity = quantity - 1, added_at = NOW()
       WHERE user_id=$1 AND item_id=$2`,
      [userId, item.id]
    );
  } else {
    await pool.query(
      `DELETE FROM baskets WHERE user_id=$1 AND item_id=$2`,
      [userId, item.id]
    );
  }

  if (item.one_time) {
    await pool.query(
      `UPDATE items 
       SET status='available', reserved_by=NULL, reserved_at=NULL 
       WHERE id=$1`,
      [item.id]
    );
  }

  return item;
}

async function removeProductFromBasket(userId, productName) {
  const productKey = normalizeProductName(productName);

  const { rows } = await pool.query(
    `
    SELECT i.*
    FROM items i
    JOIN baskets b ON b.item_id = i.id
    WHERE b.user_id = $1
      AND i.product_key = $2
    ORDER BY b.added_at DESC, i.added_at DESC
    LIMIT 1
    `,
    [userId, productKey]
  );

  const item = rows[0];

  if (!item) {
    return null;
  }

  const basketEntry = await pool.query(
    `SELECT quantity FROM baskets WHERE user_id=$1 AND item_id=$2`,
    [userId, item.id]
  );

  const quantity = Number(basketEntry.rows[0]?.quantity || 0);

  if (quantity > 1 && !item.one_time) {
    await pool.query(
      `UPDATE baskets
       SET quantity = quantity - 1, added_at = NOW()
       WHERE user_id=$1 AND item_id=$2`,
      [userId, item.id]
    );
  } else {
    await pool.query(
      `DELETE FROM baskets WHERE user_id=$1 AND item_id=$2`,
      [userId, item.id]
    );
  }

  if (item.one_time) {
    await pool.query(
      `UPDATE items
       SET status='available', reserved_by=NULL, reserved_at=NULL
       WHERE id=$1`,
      [item.id]
    );
  }

  return item;
}

//
// ✅ CLEAR BASKET
//
async function clearBasket(userId) {
  const items = await getBasket(userId);

  for (const item of items) {
    await removeFromBasket(userId, item.code);
  }

  return items.length;
}

//
// ✅ COMPLETE PURCHASE
//
async function completePurchase(userId) {
  const items = await getBasket(userId);

  for (const item of items) {
    if (item.one_time) {
      await pool.query(
        `UPDATE items 
         SET status='purchased', purchased_by=$1, purchased_at=NOW()
         WHERE id=$2`,
        [userId, item.id]
      );
    }
  }

  await pool.query(`DELETE FROM baskets WHERE user_id=$1`, [userId]);

  return items;
}

//
// ✅ GET CODES (FIXED FOR /viewcodes)
//
async function getCodes(productName = null) {
  let query = `
    SELECT i.*,
      COALESCE(SUM(b.quantity), 0) as basket_reservations
    FROM items i
    LEFT JOIN baskets b ON b.item_id = i.id
  `;

  const values = [];

  if (productName) {
    query += ` WHERE i.product_key = $1`;
    values.push(normalizeProductName(productName));
  }

  query += `
    GROUP BY i.id
    ORDER BY i.product_name ASC, i.added_at ASC
  `;

  const { rows } = await pool.query(query, values);

  return rows.map(item => ({
    ...item,
    basketReservations: Number(item.basket_reservations),
  }));
}

//
// ✅ DELETE CODE
//
async function deleteCode(itemId) {
  const { rows } = await pool.query(
    `DELETE FROM items WHERE id = $1 RETURNING *`,
    [itemId]
  );

  if (rows.length === 0) return null;

  await pool.query(`DELETE FROM baskets WHERE item_id = $1`, [itemId]);

  return rows[0];
}

//
// ✅ PRODUCT SUMMARY
//
async function getProductSummary(productName) {
  const productKey = normalizeProductName(productName);

  const { rows } = await pool.query(
    `
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status='available') as available,
      COUNT(*) FILTER (WHERE status='reserved') as reserved,
      COUNT(*) FILTER (WHERE one_time=true) as one_time,
      COUNT(*) FILTER (WHERE one_time=false) as reusable
    FROM items
    WHERE product_key = $1
    `,
    [productKey]
  );

  return {
    productName,
    total: Number(rows[0].total),
    available: Number(rows[0].available),
    reserved: Number(rows[0].reserved),
    oneTime: Number(rows[0].one_time),
    reusable: Number(rows[0].reusable),
  };
}

//
// ✅ STOCK SUMMARY
//
async function getStockSummary() {
  const { rows } = await pool.query(`
    SELECT 
      product_name,
      product_key,
      COUNT(*) FILTER (WHERE status='available') as available,
      COUNT(*) FILTER (WHERE status='reserved') as reserved,
      COUNT(*) FILTER (WHERE one_time=true) as one_time,
      COUNT(*) FILTER (WHERE one_time=false) as reusable
    FROM items
    GROUP BY product_name, product_key
    ORDER BY product_name ASC
  `);

  return rows.map(row => ({
    productName: row.product_name,
    available: Number(row.available),
    reserved: Number(row.reserved),
    oneTime: Number(row.one_time),
    reusable: Number(row.reusable),
  }));
}

async function getProductListingData(productName) {
  const productKey = normalizeProductName(productName);

  const { rows } = await pool.query(
    `
    SELECT
      product_name,
      COUNT(*) FILTER (WHERE status = 'available') AS available,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT price ORDER BY price), NULL) AS prices,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT robux_price ORDER BY robux_price), NULL) AS robux_prices,
      COALESCE(
        MAX(CASE WHEN image_url IS NOT NULL AND image_url <> '' THEN image_url END),
        NULL
      ) AS image_url
    FROM items
    WHERE product_key = $1
    GROUP BY product_name
    `,
    [productKey]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    productName: row.product_name,
    available: Number(row.available),
    prices: (row.prices || []).map((value) => Number(value)),
    robuxPrices: (row.robux_prices || []).map((value) => Number(value)),
    imageUrl: row.image_url || null,
  };
}

module.exports = {
  addCode,
  addToBasket,
  addProductToBasket,
  getBasket,
  getBasketTotal,
  removeFromBasket,
  removeProductFromBasket,
  clearBasket,
  completePurchase,
  getCodes,
  deleteCode,
  getProductSummary,
  getStockSummary,
  getProductListingData,
};
