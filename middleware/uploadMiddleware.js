const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE_MB   = 5;

// ── CLOUDINARY (production) ──────────────────────────────────────────────────
// If CLOUDINARY_URL env var is set, use Cloudinary storage
// Otherwise fall back to local disk (development)
let storage;

if (process.env.CLOUDINARY_URL) {
  const cloudinary             = require("cloudinary").v2;
  const { CloudinaryStorage } = require("multer-storage-cloudinary");

  // cloudinary auto-configures from CLOUDINARY_URL env var
  storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder:         "saleit-uploads",
      allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
      transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
    },
  });

  console.log("✅ Using Cloudinary storage");
} else {
  // ── LOCAL DISK (development) ───────────────────────────────────────────────
  const uploadsDir = path.join(__dirname, "../uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, unique + path.extname(file.originalname).toLowerCase());
    },
  });

  console.log("✅ Using local disk storage");
}

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only jpg, png, webp and gif are allowed."), false);
  }
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});
