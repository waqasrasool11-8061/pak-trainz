const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "pak_trainz_secret_salt_2026";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

// Serve static directory (public folder for Vercel CDN + root)
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname)));

// Admin Auth Helper Middleware
function getSessionUser(req) {
  const cookie = req.signedCookies?.pak_trainz_auth;
  if (!cookie) return null;
  try {
    const data = JSON.parse(cookie);
    if (data && data.username) return data;
  } catch (e) {
    return null;
  }
  return null;
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user || user.role !== "admin") {
    return res.status(401).json({ error: "Unauthorized. Admin login required." });
  }
  req.adminUser = user;
  next();
}

// ──────────────────────────────────────────
// PUBLIC E-COMMERCE & STORE ROUTES
// ──────────────────────────────────────────

// 1. Get Store Products (with optional filter)
app.get("/api/products", async (req, res) => {
  try {
    const { category, is_free } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (is_free !== undefined) filter.is_free = is_free === "true" || is_free === "1";

    const products = await db.getProducts(filter);
    res.json({ success: true, products });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

// 2. Get Single Product
app.get("/api/products/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const product = await db.getProductById(id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({ success: true, product });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ error: "Failed to load product" });
  }
});

// 3. Checkout Order (Customer places order)
app.post("/api/orders/checkout", async (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_whatsapp,
      payment_method,
      transaction_id,
      items,
      total_amount
    } = req.body;

    if (!customer_name || !customer_email || !customer_whatsapp) {
      return res.status(400).json({ error: "Name, email, and WhatsApp number are required" });
    }

    if (!items || !items.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const result = await db.createOrder({
      customer_name,
      customer_email,
      customer_whatsapp,
      payment_method: payment_method || "EasyPaisa",
      transaction_id: transaction_id || "N/A",
      items,
      total_amount: Number(total_amount) || 0,
      currency: "PKR"
    });

    res.json({
      success: true,
      message: "Order placed successfully",
      orderNumber: result.orderNumber,
      orderId: result.orderId,
      isAutoApproved: Number(total_amount) === 0
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

// 4. Check Order Status & Retrieve License / Download
app.get("/api/orders/status/:orderNumber", async (req, res) => {
  try {
    const orderNumber = req.params.orderNumber.trim();
    const order = await db.getOrder(orderNumber);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, order });
  } catch (err) {
    console.error("Error fetching order status:", err);
    res.status(500).json({ error: "Failed to load order status" });
  }
});

// 5. Secure Tokenized File Download Delivery
app.get("/api/download/secure/:licenseKey", async (req, res) => {
  try {
    const licenseKey = req.params.licenseKey.trim();
    const result = await db.verifyAndConsumeDownload(licenseKey);

    if (!result.valid) {
      return res.status(403).send(`
        <div style="font-family:sans-serif; text-align:center; padding: 50px; background:#0d1520; color:#fff; min-height:100vh;">
          <h2 style="color:#f44336;">Download Error</h2>
          <p>${result.error}</p>
          <a href="/store.html" style="color:#64b5f6; font-weight:bold;">Return to Store</a>
        </div>
      `);
    }

    const fileUrl = result.file_url;

    // A. External Cloud Storage (e.g. Cloudflare R2, Google Drive, MediaFire)
    if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
      return res.redirect(fileUrl);
    }

    // B. Local File Delivery
    const localFilePath = path.join(__dirname, fileUrl);
    if (fs.existsSync(localFilePath)) {
      return res.download(localFilePath, path.basename(localFilePath));
    } else {
      return res.status(404).send(`
        <div style="font-family:sans-serif; text-align:center; padding: 50px; background:#0d1520; color:#fff; min-height:100vh;">
          <h2 style="color:#ff9800;">File Notice</h2>
          <p>This add-on pack is currently being uploaded to the high-speed cloud CDN. Please check back shortly or message our WhatsApp support.</p>
          <a href="/store.html" style="color:#64b5f6; font-weight:bold;">Return to Store</a>
        </div>
      `);
    }
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Internal download error");
  }
});

// ──────────────────────────────────────────
// PHASE 3: CLIENT APP / DRM AUTH ENDPOINTS
// ──────────────────────────────────────────

// Direct Download Windows Client App Package
app.get("/api/download/client-app", (req, res) => {
  const filePath = path.join(__dirname, "public", "downloads", "TRS-DEP-PAK-Launcher.zip");
  if (fs.existsSync(filePath)) {
    res.download(filePath, "TRS-DEP-PAK-Launcher.zip");
  } else {
    res.status(404).send("Client launcher package not found.");
  }
});

// Verify License Key for TRS DEP PAK Windows Launcher
app.post("/api/client/verify-license", async (req, res) => {
  try {
    const { email, license_key, hwid } = req.body;
    if (!email || !license_key) {
      return res.status(400).json({ success: false, error: "Email and License Key required" });
    }

    const check = await db.verifyClientAppLicense(email, license_key, hwid);
    res.json(check);
  } catch (err) {
    console.error("Client license verification error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Direct Developer Login from Desktop Client App (Waqas, Asif, Usman)
app.post("/api/client/developer-login", async (req, res) => {
  try {
    const { username, password, hwid } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Developer username and password required" });
    }
    const result = await db.developerClientLogin(username, password, hwid);
    res.json(result);
  } catch (err) {
    console.error("Client developer login error:", err);
    res.status(500).json({ success: false, error: "Internal server error during developer authentication" });
  }
});

// List Authorized Developer Devices (Waqas, Asif, Usman)
app.get("/api/admin/developer-devices", requireAdmin, async (req, res) => {
  try {
    const devices = await db.getDeveloperDevices();
    res.json({ success: true, devices });
  } catch (err) {
    console.error("Error fetching developer devices:", err);
    res.status(500).json({ error: "Failed to load developer devices" });
  }
});

// Add / Whitelist a New Device or Laptop
app.post("/api/admin/developer-devices", requireAdmin, async (req, res) => {
  try {
    const { developer_name, device_name, location, hwid, notes } = req.body;
    if (!developer_name || !device_name) {
      return res.status(400).json({ error: "Developer Name and Device Name are required" });
    }
    const newId = await db.addDeveloperDevice({ developer_name, device_name, location, hwid, notes });
    res.json({ success: true, id: newId, message: "Developer device whitelisted successfully" });
  } catch (err) {
    console.error("Error adding developer device:", err);
    res.status(500).json({ error: "Failed to whitelist developer device" });
  }
});

// Delete / Revoke a Developer Device
app.delete("/api/admin/developer-devices/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.deleteDeveloperDevice(id);
    res.json({ success: true, message: "Developer device removed successfully" });
  } catch (err) {
    console.error("Error deleting developer device:", err);
    res.status(500).json({ error: "Failed to delete developer device" });
  }
});

// ──────────────────────────────────────────
// ADMIN E-COMMERCE & STORE APIS
// ──────────────────────────────────────────

// Store Revenue & Stats Overview
app.get("/api/admin/store-stats", requireAdmin, async (req, res) => {
  try {
    const stats = await db.getStoreStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to load store stats" });
  }
});

// List all customer orders
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const orders = await db.getAllOrders();
    res.json({ success: true, orders });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// Approve Order (Auto-generates License Keys)
app.post("/api/admin/orders/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { admin_notes } = req.body;
    const result = await db.approveOrder(id, admin_notes);
    if (!result) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, message: "Order approved and license keys generated", order: result });
  } catch (err) {
    console.error("Approve order error:", err);
    res.status(500).json({ error: "Failed to approve order" });
  }
});

// Reject Order
app.post("/api/admin/orders/:id/reject", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    await db.rejectOrder(id, reason);
    res.json({ success: true, message: "Order rejected" });
  } catch (err) {
    console.error("Reject order error:", err);
    res.status(500).json({ error: "Failed to reject order" });
  }
});

// Add Store Product
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const {
      title,
      category,
      price,
      sale_price,
      currency,
      is_free,
      image_url,
      file_url,
      file_size,
      version,
      description,
      kuid_info,
      badge
    } = req.body;

    if (!title || !file_url) {
      return res.status(400).json({ error: "Title and File URL are required" });
    }

    const newId = await db.addProduct({
      title,
      category: category || "Locomotives",
      price: Number(price) || 0,
      sale_price: sale_price ? Number(sale_price) : null,
      currency: currency || "PKR",
      is_free: is_free === true || is_free === "true" || Number(price) === 0,
      image_url: image_url || "Pictures & Videos/1.png",
      file_url,
      file_size: file_size || "",
      version: version || "TRS19 / TRS22",
      description: description || "",
      kuid_info: kuid_info || "",
      badge: badge || ""
    });

    res.json({ success: true, id: newId, message: "Product created successfully" });
  } catch (err) {
    console.error("Add product error:", err);
    res.status(500).json({ error: "Failed to add product" });
  }
});

// Edit / Update Product (Price, Sale Price, Title, etc.)
app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await db.updateProduct(id, req.body);
    res.json({ success: true, message: "Product updated successfully", product: updated });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.post("/api/admin/products/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await db.updateProduct(id, req.body);
    res.json({ success: true, message: "Product updated successfully", product: updated });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// Delete Store Product
app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.deleteProduct(id);
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// ──────────────────────────────────────────
// PAYMENT ACCOUNTS SETTINGS APIS
// ──────────────────────────────────────────

// Public: Get Active Payment Accounts for Checkout
app.get("/api/payment-methods", async (req, res) => {
  try {
    const settings = await db.getPaymentSettings();
    res.json({ success: true, settings });
  } catch (err) {
    console.error("Error fetching payment methods:", err);
    res.status(500).json({ error: "Failed to load payment methods" });
  }
});

// Admin: Update Payment Accounts (EasyPaisa, JazzCash, Bank, WhatsApp)
app.post("/api/admin/payment-settings", requireAdmin, async (req, res) => {
  try {
    const updated = await db.updatePaymentSettings(req.body);
    res.json({ success: true, message: "Payment accounts updated successfully", settings: updated });
  } catch (err) {
    console.error("Error updating payment settings:", err);
    res.status(500).json({ error: "Failed to update payment settings" });
  }
});

// ──────────────────────────────────────────
// EXISTING PUBLIC API ROUTES (Downloads, Gallery, Videos)
// ──────────────────────────────────────────

// 1. Get all downloads
app.get("/api/downloads", async (req, res) => {
  try {
    const items = await db.getDownloads();
    res.json({ success: true, downloads: items });
  } catch (err) {
    console.error("Error fetching downloads:", err);
    res.status(500).json({ error: "Failed to load downloads" });
  }
});

// 2. Increment download count
app.post("/api/download/:id/click", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid ID" });
    const count = await db.incrementDownloadCount(id);
    res.json({ success: true, count });
  } catch (err) {
    console.error("Error updating download count:", err);
    res.status(500).json({ error: "Failed to update count" });
  }
});

// 3. Get gallery
app.get("/api/gallery", async (req, res) => {
  try {
    const items = await db.getGallery();
    res.json({ success: true, gallery: items });
  } catch (err) {
    console.error("Error fetching gallery:", err);
    res.status(500).json({ error: "Failed to load gallery" });
  }
});

// 4. Get videos
app.get("/api/videos", async (req, res) => {
  try {
    const items = await db.getVideos();
    res.json({ success: true, videos: items });
  } catch (err) {
    console.error("Error fetching videos:", err);
    res.status(500).json({ error: "Failed to load videos" });
  }
});

// ──────────────────────────────────────────
// ADMIN AUTHENTICATION
// ──────────────────────────────────────────

// Admin Login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const admin = await db.authenticateAdmin(username, password);
    if (!admin) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const sessionData = JSON.stringify({ id: admin.id, username: admin.username, role: admin.role });
    res.cookie("pak_trainz_auth", sessionData, {
      httpOnly: true,
      signed: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: "lax"
    });

    res.json({
      success: true,
      user: { id: admin.id, username: admin.username, role: admin.role }
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// Check Session Status
app.get("/api/admin/me", (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    return res.json({ loggedIn: true, user });
  }
  return res.json({ loggedIn: false });
});

// Admin Logout
app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("pak_trainz_auth");
  res.json({ success: true, message: "Logged out successfully" });
});

// Change Admin Password
app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }

    const admin = await db.authenticateAdmin(req.adminUser.username, currentPassword);
    if (!admin) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    await db.changeAdminPassword(req.adminUser.username, newPassword);
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// Existing Admin Legacy Routes
app.post("/api/admin/downloads", requireAdmin, async (req, res) => {
  try {
    const { title, category, file_url, file_size, version, description } = req.body;
    if (!title || !file_url) {
      return res.status(400).json({ error: "Title and File URL are required" });
    }
    const newId = await db.addDownload({
      title,
      category: category || "Locomotives",
      file_url,
      file_size: file_size || "",
      version: version || "TRS19 / TRS22",
      description: description || ""
    });
    res.json({ success: true, id: newId, message: "Download added successfully" });
  } catch (err) {
    console.error("Add download error:", err);
    res.status(500).json({ error: "Failed to add download pack" });
  }
});

app.delete("/api/admin/downloads/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.deleteDownload(id);
    res.json({ success: true, message: "Download deleted" });
  } catch (err) {
    console.error("Delete download error:", err);
    res.status(500).json({ error: "Failed to delete download" });
  }
});

app.post("/api/admin/gallery", requireAdmin, async (req, res) => {
  try {
    const { title, image_url, category, sort_order } = req.body;
    if (!title || !image_url) {
      return res.status(400).json({ error: "Title and Image URL are required" });
    }
    const newId = await db.addGalleryItem({
      title,
      image_url,
      category: category || "General",
      sort_order: parseInt(sort_order, 10) || 0
    });
    res.json({ success: true, id: newId, message: "Image added successfully" });
  } catch (err) {
    console.error("Add gallery item error:", err);
    res.status(500).json({ error: "Failed to add gallery item" });
  }
});

app.delete("/api/admin/gallery/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.deleteGalleryItem(id);
    res.json({ success: true, message: "Image deleted" });
  } catch (err) {
    console.error("Delete gallery error:", err);
    res.status(500).json({ error: "Failed to delete gallery item" });
  }
});

app.post("/api/admin/videos", requireAdmin, async (req, res) => {
  try {
    const { title, video_url, thumbnail_url, duration, sort_order } = req.body;
    if (!title || !video_url) {
      return res.status(400).json({ error: "Title and Video URL are required" });
    }
    const newId = await db.addVideo({
      title,
      video_url,
      thumbnail_url: thumbnail_url || "Pictures & Videos/video-thumbnail.svg",
      duration: duration || "",
      sort_order: parseInt(sort_order, 10) || 0
    });
    res.json({ success: true, id: newId, message: "Video added successfully" });
  } catch (err) {
    console.error("Add video error:", err);
    res.status(500).json({ error: "Failed to add video" });
  }
});

app.delete("/api/admin/videos/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.deleteVideo(id);
    res.json({ success: true, message: "Video deleted" });
  } catch (err) {
    console.error("Delete video error:", err);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

// ──────────────────────────────────────────
// PAGE ROUTES (FALLBACKS)
// ──────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/store", (req, res) => {
  res.sendFile(path.join(__dirname, "store.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Server Initialization
async function start() {
  try {
    await db.initDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 Pak Trainz Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
}

// In standard local development run start(). On Vercel, init asynchronously and export app.
if (!process.env.VERCEL) {
  start();
} else {
  db.initDatabase().catch(err => console.error("Vercel DB Init Error:", err));
}

module.exports = app;
