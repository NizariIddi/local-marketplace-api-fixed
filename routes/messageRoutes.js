const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const path    = require("path");

const { getMessages, getUserConversations, sendImageMessage } = require("../controllers/messageController");
const authMiddleware = require("../middleware/authMiddleware");

// Image upload for chat
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.${file.originalname.split('.').pop()}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Conversations must come BEFORE /:conversationId
router.get("/conversations",       authMiddleware, getUserConversations);
router.post("/image",              authMiddleware, upload.single("image"), sendImageMessage);
router.get("/:conversationId",     getMessages);

module.exports = router;
