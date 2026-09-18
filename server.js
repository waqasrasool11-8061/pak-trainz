const express = require("express");
const path = require("path");
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

// Serve static directory (HTML, CSS, Pictures & Videos, etc.)
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
// PUBLIC API ROUTES
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

    // Set signed cookie for 30 days
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

// ──────────────────────────────────────────
// ADMIN CRUD OPERATIONS
// ──────────────────────────────────────────

// Add Download Pack
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

// Delete Download Pack
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

// Add Gallery Image
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

// Delete Gallery Image
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

// Add Video
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

// Delete Video
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

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Start Server
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

start();
