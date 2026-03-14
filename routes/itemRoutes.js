const express = require("express");
const router  = express.Router();
const upload  = require("../middleware/uploadMiddleware");
const auth    = require("../middleware/authMiddleware");
const opt     = require("../middleware/optionalAuth");
const {
  createItem, getItems, getItem, deleteItem,
  getUserItems, saveItem, unsaveItem, checkSaved,
  getSavedItems, getRecentlyViewed, getRecommendedItems,
  updateItem, markAsSold, getItemStats,
  getUserProfile, checkPriceDrops,
} = require("../controllers/itemController");

router.post("/create",          auth, upload.array("images", 5), createItem);
router.get("/",                       getItems);
router.post("/save",            auth, saveItem);
router.delete("/save",          auth, unsaveItem);
router.get("/saved",            auth, getSavedItems);
router.get("/recent",           auth, getRecentlyViewed);
router.get("/price-drops",      auth, checkPriceDrops);
router.get("/recommend/:itemId",      getRecommendedItems);
router.get("/user/:userId",           getUserItems);
router.get("/profile/:userId",        getUserProfile);
router.get("/:id/stats",        opt,  getItemStats);
router.get("/:id/saved-check",  auth, checkSaved);
router.get("/:id",              opt,  getItem);
router.put("/:id",              auth, updateItem);
router.patch("/:id/sold",       auth, markAsSold);
router.delete("/:id",           auth, deleteItem);

module.exports = router;
