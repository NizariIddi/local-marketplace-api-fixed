const express = require("express");
const cors    = require("cors");
const path    = require("path");
const http    = require("http");
require("dotenv").config();

const { Server } = require("socket.io");
const db = require("./config/db");

const authRoutes    = require("./routes/authRoutes");
const itemRoutes    = require("./routes/itemRoutes");
const messageRoutes = require("./routes/messageRoutes");

const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : '*';

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] }
});

const onlineUsers = {};

app.set('trust proxy', 1); // Trust Railway/Render reverse proxy
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Inject io into every request
app.use((req, res, next) => { req.io = io; next(); });

// Health check — useful for debugging
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date() }));

app.use("/api/auth",     authRoutes);
app.use("/api/items",    itemRoutes);
app.use("/api/messages", messageRoutes);

// 404 handler — catches any unmatched route
app.use((req, res) => {
  console.log(`404 → ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler (required for Express 5 async errors)
app.use((err, req, res, next) => {
  console.error(`500 → ${req.method} ${req.originalUrl}`, err.message);

  // Multer-specific errors (file type, size, etc.)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: "File too large. Maximum size is 5MB." });
  }
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ message: err.message });
  }

  res.status(500).json({ message: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;

/* ═══════════════════════ SOCKET ═══════════════════════ */

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("userOnline", (userId) => {
    if (!userId) return;
    onlineUsers[String(userId)] = socket.id;
    io.emit("onlineUsers", Object.keys(onlineUsers));
  });

  socket.on("joinFeed", () => {
    socket.join("feed");
  });

  socket.on("joinConversation", (conversationId) => {
    if (!conversationId) return;
    socket.join(`conv_${conversationId}`);
  });

  socket.on("leaveConversation", (conversationId) => {
    socket.leave(`conv_${conversationId}`);
  });

  socket.on("createConversation", async ({ buyerId, sellerId, itemId }) => {
    try {
      const [existing] = await db.query(
        "SELECT * FROM conversations WHERE buyer_id = ? AND seller_id = ? AND item_id = ?",
        [buyerId, sellerId, itemId]
      );
      if (existing.length > 0) {
        socket.emit("conversationCreated", existing[0]);
        return;
      }
      const [result] = await db.query(
        "INSERT INTO conversations (buyer_id, seller_id, item_id) VALUES (?, ?, ?)",
        [buyerId, sellerId, itemId]
      );
      socket.emit("conversationCreated", {
        id: result.insertId, buyer_id: buyerId, seller_id: sellerId, item_id: itemId
      });
    } catch (e) { console.error("createConversation error:", e.message); }
  });

  socket.on("sendMessage", async ({ conversationId, senderId, message }) => {
    if (!conversationId || !senderId || !message) return;
    try {
      const [result] = await db.query(
        "INSERT INTO messages (conversation_id, sender_id, message) VALUES (?, ?, ?)",
        [conversationId, senderId, message]
      );
      const msgData = {
        id:              result.insertId,
        conversation_id: conversationId,
        sender_id:       senderId,
        conversationId,
        senderId,
        message,
        is_read:    false,
        created_at: new Date(),
      };
      io.to(`conv_${conversationId}`).emit("receiveMessage", msgData);
      io.to(`conv_${conversationId}`).emit("conversationUpdated", {
        conversationId,
        lastMessage: message,
        lastTime:    msgData.created_at,
      });
    } catch (e) { console.error("sendMessage error:", e.message); }
  });

  socket.on("typing", ({ conversationId, userId }) => {
    if (!conversationId) return;
    socket.to(`conv_${conversationId}`).emit("typing", { userId });
  });

  socket.on("stopTyping", (conversationId) => {
    if (!conversationId) return;
    socket.to(`conv_${conversationId}`).emit("stopTyping");
  });

  socket.on("messageSeen", async ({ conversationId }) => {
    try {
      await db.query(
        "UPDATE messages SET is_read = 1 WHERE conversation_id = ?",
        [conversationId]
      );
      socket.to(`conv_${conversationId}`).emit("messagesSeen", { conversationId });
    } catch (e) {}
  });

  socket.on("disconnect", () => {
    for (const uid in onlineUsers) {
      if (onlineUsers[uid] === socket.id) delete onlineUsers[uid];
    }
    io.emit("onlineUsers", Object.keys(onlineUsers));
    console.log("Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
