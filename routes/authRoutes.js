const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");
const {
  register, login, profile,
  updateProfile, changePassword,
  submitRating, getSellerRatings,
} = require("../controllers/authController");

router.post("/register",              register);
router.post("/login",                 login);
router.get("/profile",          auth, profile);
router.put("/profile",          auth, updateProfile);
router.put("/change-password",  auth, changePassword);
router.post("/ratings",         auth, submitRating);
router.get("/ratings/:sellerId",      getSellerRatings);

module.exports = router;
