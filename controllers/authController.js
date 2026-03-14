const db     = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");

exports.register = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const [existingUser] = await db.query(
      "SELECT id FROM users WHERE email = ?", [email]
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashedPassword]
    );

    res.json({ message: "User registered successfully", userId: result.insertId });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (users.length === 0) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const user    = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (error) {
    next(error);
  }
};

exports.profile = async (req, res, next) => {
  try {
    const [users] = await db.query(
      "SELECT id, username, email, created_at FROM users WHERE id = ?",
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ message: "User not found" });
    res.json(users[0]);
  } catch (error) {
    next(error);
  }
};

/* ─── UPDATE PROFILE ─── */
exports.updateProfile = async (req, res, next) => {
  try {
    const { username, email } = req.body;
    if (!username || !email) return res.status(400).json({ message: "Username and email required" });

    // Check email not taken by another user
    const [existing] = await db.query(
      "SELECT id FROM users WHERE email = ? AND id != ?", [email, req.user.id]
    );
    if (existing.length > 0) return res.status(400).json({ message: "Email already in use" });

    await db.query(
      "UPDATE users SET username = ?, email = ? WHERE id = ?",
      [username.trim(), email.trim(), req.user.id]
    );
    res.json({ message: "Profile updated" });
  } catch (error) { next(error); }
};

/* ─── CHANGE PASSWORD ─── */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: "Both fields required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const isMatch = await require("bcryptjs").compare(currentPassword, users[0].password);
    if (!isMatch) return res.status(400).json({ message: "Current password is incorrect" });

    const hashed = await require("bcryptjs").hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);
    res.json({ message: "Password changed" });
  } catch (error) { next(error); }
};

/* ─── SUBMIT RATING ─── */
exports.submitRating = async (req, res, next) => {
  try {
    const { sellerId, rating, comment, itemId } = req.body;
    const reviewerId = req.user.id;
    if (sellerId === reviewerId) return res.status(400).json({ message: "Cannot rate yourself" });
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: "Rating must be 1-5" });

    // Check if already rated this seller for this item
    const [existing] = await db.query(
      "SELECT id FROM ratings WHERE reviewer_id = ? AND seller_id = ? AND item_id = ?",
      [reviewerId, sellerId, itemId || null]
    );
    if (existing.length > 0) return res.status(400).json({ message: "Already rated this seller for this item" });

    await db.query(
      "INSERT INTO ratings (reviewer_id, seller_id, rating, comment, item_id) VALUES (?, ?, ?, ?, ?)",
      [reviewerId, sellerId, rating, comment || null, itemId || null]
    );
    res.json({ message: "Rating submitted" });
  } catch (error) { next(error); }
};

/* ─── GET SELLER RATINGS ─── */
exports.getSellerRatings = async (req, res, next) => {
  try {
    const { sellerId } = req.params;
    const [rows] = await db.query(`
      SELECT r.rating, r.comment, r.created_at,
             u.username AS reviewer_name
      FROM ratings r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.seller_id = ?
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [sellerId]);

    const [[avg]] = await db.query(
      "SELECT AVG(rating) as average, COUNT(*) as total FROM ratings WHERE seller_id = ?",
      [sellerId]
    );

    res.json({
      ratings: rows,
      average: avg.average ? parseFloat(avg.average).toFixed(1) : null,
      total:   avg.total || 0,
    });
  } catch (error) { next(error); }
};
