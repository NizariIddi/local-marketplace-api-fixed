const db = require("../config/db");

/* ─── CREATE ITEM ─── */
exports.createItem = async (req, res, next) => {
  try {
    const { title, description, price, category, location } = req.body;
    const userId = req.user.id;

    const [result] = await db.query(
      "INSERT INTO items (title, description, price, category, location, user_id) VALUES (?, ?, ?, ?, ?, ?)",
      [title, description, price, category, location, userId]
    );
    const itemId = result.insertId;

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        // Cloudinary returns file.path (full URL), local disk returns file.filename
        const imageUrl = file.path || file.filename;
        await db.query(
          "INSERT INTO item_images (item_id, image_url) VALUES (?, ?)",
          [itemId, imageUrl]
        );
      }
    }

    // Broadcast new item — non-critical, never crashes the request
    if (req.io) {
      try {
        const [newRows] = await db.query(
          "SELECT items.*, item_images.image_url FROM items LEFT JOIN item_images ON items.id = item_images.item_id WHERE items.id = ?",
          [itemId]
        );
        if (newRows.length > 0) {
          req.io.to("feed").emit("newItem", {
            ...newRows[0],
            images: newRows.filter(r => r.image_url).map(r => `/uploads/${r.image_url}`),
          });
        }
      } catch (e) {}
    }

    res.json({ message: "Item created successfully", itemId });
  } catch (error) {
    next(error);
  }
};

/* ─── GET ITEMS (browse/search/paginate) ─── */
exports.getItems = async (req, res, next) => {
  try {
    let { page = 1, limit = 10, category, minPrice, maxPrice, search } = req.query;
    page  = parseInt(page)  || 1;
    limit = parseInt(limit) || 10;
    const offset = (page - 1) * limit;

    // NOTE: Only select columns guaranteed to exist in the base schema.
    // Do NOT select views or is_sold here — add them to your DB with:
    // ALTER TABLE items ADD COLUMN IF NOT EXISTS views INT DEFAULT 0;
    // ALTER TABLE items ADD COLUMN IF NOT EXISTS is_sold TINYINT DEFAULT 0;
    let query = `
      SELECT
        items.id,
        items.title,
        items.description,
        items.price,
        items.location,
        items.category,
        items.created_at,
        items.user_id,
        item_images.image_url
      FROM items
      LEFT JOIN item_images ON items.id = item_images.item_id
      WHERE 1=1
    `;
    const params = [];

    if (search)   { query += " AND items.title LIKE ?"; params.push(`%${search}%`); }
    if (category) { query += " AND items.category = ?"; params.push(category); }
    if (minPrice) { query += " AND items.price >= ?";   params.push(Number(minPrice)); }
    if (maxPrice) { query += " AND items.price <= ?";   params.push(Number(maxPrice)); }

    query += " ORDER BY items.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [rows] = await db.query(query, params);

    const itemsMap = {};
    rows.forEach(row => {
      if (!itemsMap[row.id]) {
        itemsMap[row.id] = {
          id:          row.id,
          title:       row.title,
          description: row.description,
          price:       row.price,
          location:    row.location,
          category:    row.category,
          created_at:  row.created_at,
          user_id:     row.user_id,
          images:      [],
        };
      }
      if (row.image_url) itemsMap[row.id].images.push(`/uploads/${row.image_url}`);
    });

    res.json(Object.values(itemsMap));
  } catch (error) {
    next(error);
  }
};

/* ─── GET SINGLE ITEM ─── */
exports.getItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Increment views — silently ignored if column doesn't exist
    await db.query(
      "UPDATE items SET views = IFNULL(views, 0) + 1 WHERE id = ?", [id]
    ).catch(() => {});

    const [items] = await db.query("SELECT * FROM items WHERE id = ?", [id]);
    if (items.length === 0) return res.status(404).json({ message: "Item not found" });

    // Log recently viewed — silently ignored if table missing or duplicate
    if (req.user && req.user.id) {
      await db.query(
        "INSERT INTO recently_viewed (user_id, item_id) VALUES (?, ?)",
        [req.user.id, id]
      ).catch(() => {});
    }

    const [images] = await db.query(
      "SELECT image_url FROM item_images WHERE item_id = ?", [id]
    );

    res.json({
      ...items[0],
      views:   items[0].views   || 0,
      is_sold: items[0].is_sold || 0,
      images:  images.map(img => {
      // If it's already a full URL (Cloudinary), use as-is
      // If it's just a filename (local), prepend /uploads/
      const url = img.image_url;
      return url.startsWith('http') ? url : `/uploads/${url}`;
    }),
    });
  } catch (error) {
    next(error);
  }
};

/* ─── GET USER ITEMS ─── */
exports.getUserItems = async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const [rows] = await db.query(
      `SELECT items.*, item_images.image_url
       FROM items
       LEFT JOIN item_images ON items.id = item_images.item_id
       WHERE items.user_id = ?
       ORDER BY items.created_at DESC`,
      [userId]
    );
    const itemsMap = {};
    rows.forEach(row => {
      if (!itemsMap[row.id]) {
        itemsMap[row.id] = {
          id: row.id, title: row.title, description: row.description,
          price: row.price, location: row.location, category: row.category,
          created_at: row.created_at, user_id: row.user_id,
          views: row.views || 0, is_sold: row.is_sold || 0, images: [],
        };
      }
      if (row.image_url) itemsMap[row.id].images.push(`/uploads/${row.image_url}`);
    });
    res.json(Object.values(itemsMap));
  } catch (error) {
    next(error);
  }
};

/* ─── SAVE ITEM ─── */
exports.saveItem = async (req, res, next) => {
  try {
    const userId     = req.user.id;
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ message: "itemId required" });

    // Check if already saved to avoid duplicate key errors
    const [existing] = await db.query(
      "SELECT id FROM saved_items WHERE user_id = ? AND item_id = ?",
      [userId, itemId]
    );
    if (existing.length > 0) {
      return res.json({ message: "Already saved" });
    }

    // Record current price for price-drop alerts (saved_price column added via migration)
    const [[item]] = await db.query("SELECT price FROM items WHERE id = ?", [itemId]);
    const savedPrice = item ? item.price : null;
    await db.query(
      "INSERT INTO saved_items (user_id, item_id, saved_price) VALUES (?, ?, ?)",
      [userId, itemId, savedPrice]
    ).catch(() => {
      // Fallback if saved_price column doesn't exist yet
      return db.query("INSERT INTO saved_items (user_id, item_id) VALUES (?, ?)", [userId, itemId]);
    });
    res.json({ message: "Item saved" });
  } catch (error) {
    next(error);
  }
};

/* ─── GET SAVED ITEMS ─── */
exports.getSavedItems = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT items.*, item_images.image_url
       FROM saved_items
       JOIN items ON saved_items.item_id = items.id
       LEFT JOIN item_images ON items.id = item_images.item_id
       WHERE saved_items.user_id = ?`,
      [userId]
    );
    const itemsMap = {};
    rows.forEach(row => {
      if (!itemsMap[row.id]) {
        itemsMap[row.id] = {
          id: row.id, title: row.title, description: row.description,
          price: row.price, location: row.location, category: row.category,
          created_at: row.created_at, user_id: row.user_id, images: [],
        };
      }
      if (row.image_url) itemsMap[row.id].images.push(`/uploads/${row.image_url}`);
    });
    res.json(Object.values(itemsMap));
  } catch (error) {
    next(error);
  }
};

/* ─── GET RECENTLY VIEWED ─── */
exports.getRecentlyViewed = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT items.*, item_images.image_url
       FROM recently_viewed
       JOIN items ON recently_viewed.item_id = items.id
       LEFT JOIN item_images ON items.id = item_images.item_id
       WHERE recently_viewed.user_id = ?
       ORDER BY recently_viewed.viewed_at DESC
       LIMIT 10`,
      [userId]
    );
    const itemsMap = {};
    rows.forEach(row => {
      if (!itemsMap[row.id]) {
        itemsMap[row.id] = {
          id: row.id, title: row.title, description: row.description,
          price: row.price, location: row.location, category: row.category,
          created_at: row.created_at, user_id: row.user_id, images: [],
        };
      }
      if (row.image_url) itemsMap[row.id].images.push(`/uploads/${row.image_url}`);
    });
    res.json(Object.values(itemsMap));
  } catch (error) {
    next(error);
  }
};

/* ─── DELETE ITEM ─── */
exports.deleteItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await db.query(
      "DELETE FROM items WHERE id = ? AND user_id = ?",
      [id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(403).json({ message: "Item not found or not yours" });
    }
    res.json({ message: "Item deleted" });
  } catch (error) {
    next(error);
  }
};

/* ─── GET RECOMMENDED ITEMS ─── */
exports.getRecommendedItems = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const [[item]] = await db.query(
      "SELECT category, price FROM items WHERE id = ?", [itemId]
    );
    if (!item) return res.status(404).json({ message: "Item not found" });

    const [rows] = await db.query(
      `SELECT items.*, item_images.image_url
       FROM items
       LEFT JOIN item_images ON items.id = item_images.item_id
       WHERE items.category = ? AND items.price BETWEEN ? AND ? AND items.id != ?
       ORDER BY items.created_at DESC
       LIMIT 10`,
      [item.category, item.price * 0.7, item.price * 1.3, itemId]
    );
    const itemsMap = {};
    rows.forEach(row => {
      if (!itemsMap[row.id]) {
        itemsMap[row.id] = {
          id: row.id, title: row.title, description: row.description,
          price: row.price, location: row.location, category: row.category,
          created_at: row.created_at, user_id: row.user_id, images: [],
        };
      }
      if (row.image_url) itemsMap[row.id].images.push(`/uploads/${row.image_url}`);
    });
    res.json(Object.values(itemsMap));
  } catch (error) {
    next(error);
  }
};

/* ─── UPDATE ITEM ─── */
exports.updateItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, price, category, location } = req.body;

    // Verify ownership first
    const [rows] = await db.query("SELECT user_id FROM items WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Item not found" });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ message: "Not authorized" });

    await db.query(
      "UPDATE items SET title=?, description=?, price=?, category=?, location=? WHERE id=?",
      [title, description, price, category, location, id]
    );

    res.json({ message: "Item updated" });
  } catch (error) {
    next(error);
  }
};

/* ─── MARK AS SOLD ─── */
exports.markAsSold = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query("SELECT user_id FROM items WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Item not found" });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ message: "Not authorized" });

    await db.query("UPDATE items SET is_sold = 1 WHERE id = ?", [id]);
    res.json({ message: "Item marked as sold" });
  } catch (error) {
    next(error);
  }
};

/* ─── GET ITEM STATS (views + saves count) ─── */
exports.getItemStats = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[item]] = await db.query(
      "SELECT views, is_sold FROM items WHERE id = ?", [id]
    );
    if (!item) return res.status(404).json({ message: "Item not found" });

    // Count saves
    const [[saveRow]] = await db.query(
      "SELECT COUNT(*) as saves FROM saved_items WHERE item_id = ?", [id]
    );

    res.json({
      views:   item.views   || 0,
      is_sold: item.is_sold || 0,
      saves:   saveRow.saves || 0,
    });
  } catch (error) {
    next(error);
  }
};

/* ─── GET USER PROFILE (public) ─── */
exports.getUserProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [[user]] = await db.query(
      "SELECT id, username, created_at FROM users WHERE id = ?", [userId]
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    next(error);
  }
};

/* ─── UNSAVE ITEM ─── */
exports.unsaveItem = async (req, res, next) => {
  try {
    const userId  = req.user.id;
    const { itemId } = req.body;
    await db.query(
      "DELETE FROM saved_items WHERE user_id = ? AND item_id = ?",
      [userId, itemId]
    );
    res.json({ message: "Item unsaved" });
  } catch (error) { next(error); }
};

/* ─── CHECK IF ITEM IS SAVED ─── */
exports.checkSaved = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const [rows] = await db.query(
      "SELECT id FROM saved_items WHERE user_id = ? AND item_id = ?",
      [userId, id]
    );
    res.json({ saved: rows.length > 0 });
  } catch (error) { next(error); }
};

/* ─── CHECK PRICE DROPS ON SAVED ITEMS ─── */
exports.checkPriceDrops = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // Get saved items where current price < price when saved
    const [rows] = await db.query(`
      SELECT i.id, i.title, i.price, si.saved_price,
             (si.saved_price - i.price) AS drop_amount
      FROM saved_items si
      JOIN items i ON si.item_id = i.id
      WHERE si.user_id = ?
        AND si.saved_price IS NOT NULL
        AND i.price < si.saved_price
    `, [userId]);
    res.json(rows);
  } catch (error) { next(error); }
};
