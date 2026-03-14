const db = require("../config/db");

exports.getMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const [messages] = await db.query(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
      [conversationId]
    );
    res.json(messages);
  } catch (error) {
    next(error);
  }
};

exports.getUserConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page   = parseInt(req.query.page  || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT
         c.id,
         c.buyer_id,
         c.seller_id,
         i.title                         AS item_title,
         i.id                            AS item_id,
         (SELECT ii.image_url
          FROM item_images ii
          WHERE ii.item_id = i.id
          LIMIT 1)                        AS item_image,
         -- other person in this conversation
         CASE WHEN c.buyer_id = ? THEN s.username ELSE b.username END AS other_username,
         CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END AS other_user_id,
         -- last message info
         MAX(m.created_at)               AS last_time,
         (SELECT m2.message
          FROM messages m2
          WHERE m2.conversation_id = c.id
          ORDER BY m2.created_at DESC
          LIMIT 1)                        AS last_message,
         (SELECT m2.sender_id
          FROM messages m2
          WHERE m2.conversation_id = c.id
          ORDER BY m2.created_at DESC
          LIMIT 1)                        AS last_sender_id,
         (SELECT m2.image_url IS NOT NULL AND m2.image_url != ''
          FROM messages m2
          WHERE m2.conversation_id = c.id
          ORDER BY m2.created_at DESC
          LIMIT 1)                        AS last_was_image,
         -- unread count (messages from the other person that are unread)
         (SELECT COUNT(*)
          FROM messages m3
          WHERE m3.conversation_id = c.id
            AND m3.is_read = 0
            AND m3.sender_id != ?)        AS unread_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       LEFT JOIN items    i ON i.id = c.item_id
       LEFT JOIN users    b ON b.id = c.buyer_id
       LEFT JOIN users    s ON s.id = c.seller_id
       WHERE c.buyer_id = ? OR c.seller_id = ?
       GROUP BY c.id, i.title, i.id, s.username, b.username, c.buyer_id, c.seller_id
       ORDER BY last_time DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, userId, userId, userId, limit, offset]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

/* ─── SEND IMAGE MESSAGE ─── */
exports.sendImageMessage = async (req, res, next) => {
  try {
    const { conversationId, senderId } = req.body;
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    const [result] = await db.query(
      "INSERT INTO messages (conversation_id, sender_id, message, image_url) VALUES (?, ?, ?, ?)",
      [conversationId, senderId, '', req.file.filename]
    );

    const msgData = {
      id:              result.insertId,
      conversation_id: Number(conversationId),
      sender_id:       Number(senderId),
      conversationId:  Number(conversationId),
      senderId:        Number(senderId),
      message:         '',
      image_url:       req.file.filename,
      is_read:         false,
      created_at:      new Date(),
    };

    // Broadcast to room
    if (req.io) {
      req.io.to(`conv_${conversationId}`).emit("receiveMessage", msgData);
      req.io.to(`conv_${conversationId}`).emit("conversationUpdated", {
        conversationId: Number(conversationId),
        lastMessage:    '📷 Photo',
        lastTime:       msgData.created_at,
      });
    }

    res.json(msgData);
  } catch (error) {
    next(error);
  }
};
