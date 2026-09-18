const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
require("dotenv").config();

let clientInstance = null;

function getClient() {
  if (clientInstance) return clientInstance;
  const url = (process.env.TURSO_DATABASE_URL || "").trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim() || undefined;

  if (url) {
    clientInstance = createClient({ url, authToken });
  } else {
    // Fallback to local SQLite file if Turso env is not set
    clientInstance = createClient({ url: "file:pak_trainz_local.db" });
  }
  return clientInstance;
}

async function initDatabase() {
  const db = getClient();

  // Create isolated tables with pak_ prefix
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size TEXT,
      version TEXT DEFAULT 'TRS19 / TRS22',
      description TEXT,
      download_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      image_url TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT,
      duration TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 1. Seed default admin if empty
  try {
    const adminRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_admins");
    const adminCount = Number(adminRes.rows[0]?.cnt ?? adminRes.rows[0]?.[0] ?? 0);
    if (adminCount === 0) {
      const defaultHash = bcrypt.hashSync("trainz123", 10);
      await db.execute({
        sql: "INSERT INTO pak_admins (username, password_hash, role) VALUES (?, ?, ?)",
        args: ["admin", defaultHash, "admin"]
      });
      console.log("[db] Initialized default admin: admin / trainz123");
    }
  } catch (err) {
    console.error("[db] Error checking/seeding admin:", err.message);
  }

  // 2. Seed downloads if empty
  try {
    const dlRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_downloads");
    const dlCount = Number(dlRes.rows[0]?.cnt ?? dlRes.rows[0]?.[0] ?? 0);
    if (dlCount === 0) {
      const initialDownloads = [
        {
          title: "ALU 24.cdp",
          category: "Locomotives",
          file_url: "Pictures & Videos/ALU 24.cdp",
          file_size: "16.6 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways ALU-24 Class Locomotive standalone pack."
        },
        {
          title: "ALU 24 dependencies.cdp",
          category: "Locomotives",
          file_url: "Pictures & Videos/ALU 24 dependencies.cdp",
          file_size: "63.8 MB",
          version: "TRS19 / TRS22",
          description: "Essential bogies, horn, cab and engine sound dependencies for ALU-24."
        },
        {
          title: "HGMU 30 - R (8213).cdp",
          category: "Locomotives",
          file_url: "Pictures & Videos/HGMU 30 - R (8213).cdp",
          file_size: "200.5 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways HGMU-30 Class (Locomotive 8213) high fidelity model."
        },
        {
          title: "HGMU-30 dependancies.cdp",
          category: "Locomotives",
          file_url: "Pictures & Videos/HGMU-30 dependancies.cdp",
          file_size: "225.5 MB",
          version: "TRS19 / TRS22",
          description: "Full sound, cab interior, bogies, and script dependencies for HGMU-30."
        },
        {
          title: "Pakistan Railways.cdp",
          category: "Routes",
          file_url: "Pictures & Videos/Pakistan Railways.cdp",
          file_size: "2.2 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways authentic routes and track assets pack."
        },
        {
          title: "AC-STANDARD 8032-5.cdp",
          category: "Rolling Stock",
          file_url: "Pictures & Videos/AC-STANDARD 8032-5.cdp",
          file_size: "27.8 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways AC Standard air-conditioned passenger coach with interior view."
        },
        {
          title: "Power Van.cdp",
          category: "Rolling Stock",
          file_url: "Pictures & Videos/Power Van.cdp",
          file_size: "120.6 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways Generator & Power Van rolling stock coach."
        }
      ];

      for (const d of initialDownloads) {
        await db.execute({
          sql: "INSERT INTO pak_downloads (title, category, file_url, file_size, version, description) VALUES (?, ?, ?, ?, ?, ?)",
          args: [d.title, d.category, d.file_url, d.file_size, d.version, d.description]
        });
      }
      console.log("[db] Seeded initial download packs");
    }
  } catch (err) {
    console.error("[db] Error checking/seeding downloads:", err.message);
  }

  // 3. Seed gallery if empty
  try {
    const galRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_gallery");
    const galCount = Number(galRes.rows[0]?.cnt ?? galRes.rows[0]?.[0] ?? 0);
    if (galCount === 0) {
      const images = [
        "1.png", "2.JPEG", "3.png", "4.png", "5.png", "6.png",
        "7.png", "8.png", "9.png", "10.png", "11.png", "12.png",
        "13.png", "14.png", "15.png", "16.png", "17.png", "18.png"
      ];

      for (let i = 0; i < images.length; i++) {
        await db.execute({
          sql: "INSERT INTO pak_gallery (title, image_url, category, sort_order) VALUES (?, ?, ?, ?)",
          args: [
            "Pakistan Railways Showcase " + (i + 1),
            "Pictures & Videos/" + images[i],
            "Locomotives & Routes",
            i + 1
          ]
        });
      }
      console.log("[db] Seeded initial gallery images");
    }
  } catch (err) {
    console.error("[db] Error checking/seeding gallery:", err.message);
  }

  // 4. Seed videos if empty
  try {
    const vidRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_videos");
    const vidCount = Number(vidRes.rows[0]?.cnt ?? vidRes.rows[0]?.[0] ?? 0);
    if (vidCount === 0) {
      const videoThumbs = [
        "Pictures & Videos/1.png",
        "Pictures & Videos/2.JPEG",
        "Pictures & Videos/3.png",
        "Pictures & Videos/4.png",
        "Pictures & Videos/5.png",
        "Pictures & Videos/6.png",
        "Pictures & Videos/7.png"
      ];
      for (let i = 1; i <= 7; i++) {
        await db.execute({
          sql: "INSERT INTO pak_videos (title, video_url, thumbnail_url, sort_order) VALUES (?, ?, ?, ?)",
          args: [
            "Trainz Rail Simulator Video " + i,
            "Pictures & Videos/" + i + ".mp4",
            videoThumbs[i - 1],
            i
          ]
        });
      }
      console.log("[db] Seeded initial videos");
    }
  } catch (err) {
    console.error("[db] Error checking/seeding videos:", err.message);
  }

  console.log("[db] Pak Trainz database initialized successfully.");
}

// ── CRUD Methods ──

async function getDownloads() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_downloads WHERE is_active = 1 ORDER BY id ASC");
  return res.rows.map(r => ({
    id: Number(r.id),
    title: String(r.title || ""),
    category: String(r.category || "General"),
    file_url: String(r.file_url || ""),
    file_size: String(r.file_size || ""),
    version: String(r.version || "TRS19"),
    description: String(r.description || ""),
    download_count: Number(r.download_count || 0),
    created_at: String(r.created_at || "")
  }));
}

async function incrementDownloadCount(id) {
  const db = getClient();
  await db.execute({
    sql: "UPDATE pak_downloads SET download_count = download_count + 1 WHERE id = ?",
    args: [id]
  });
  const res = await db.execute({
    sql: "SELECT download_count FROM pak_downloads WHERE id = ?",
    args: [id]
  });
  return Number(res.rows[0]?.download_count || 0);
}

async function addDownload(data) {
  const db = getClient();
  const res = await db.execute({
    sql: "INSERT INTO pak_downloads (title, category, file_url, file_size, version, description) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      data.title,
      data.category || "Locomotives",
      data.file_url,
      data.file_size || "",
      data.version || "TRS19 / TRS22",
      data.description || ""
    ]
  });
  return res.lastInsertRowid;
}

async function deleteDownload(id) {
  const db = getClient();
  await db.execute({
    sql: "DELETE FROM pak_downloads WHERE id = ?",
    args: [id]
  });
}

async function getGallery() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_gallery ORDER BY sort_order ASC, id ASC");
  return res.rows.map(r => ({
    id: Number(r.id),
    title: String(r.title || ""),
    image_url: String(r.image_url || ""),
    category: String(r.category || "General"),
    sort_order: Number(r.sort_order || 0),
    created_at: String(r.created_at || "")
  }));
}

async function addGalleryItem(data) {
  const db = getClient();
  const res = await db.execute({
    sql: "INSERT INTO pak_gallery (title, image_url, category, sort_order) VALUES (?, ?, ?, ?)",
    args: [data.title, data.image_url, data.category || "General", data.sort_order || 0]
  });
  return res.lastInsertRowid;
}

async function deleteGalleryItem(id) {
  const db = getClient();
  await db.execute({
    sql: "DELETE FROM pak_gallery WHERE id = ?",
    args: [id]
  });
}

async function getVideos() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_videos ORDER BY sort_order ASC, id ASC");
  return res.rows.map(r => ({
    id: Number(r.id),
    title: String(r.title || ""),
    video_url: String(r.video_url || ""),
    thumbnail_url: String(r.thumbnail_url || "Pictures & Videos/video-thumbnail.svg"),
    duration: String(r.duration || ""),
    sort_order: Number(r.sort_order || 0),
    created_at: String(r.created_at || "")
  }));
}

async function addVideo(data) {
  const db = getClient();
  const res = await db.execute({
    sql: "INSERT INTO pak_videos (title, video_url, thumbnail_url, duration, sort_order) VALUES (?, ?, ?, ?, ?)",
    args: [
      data.title,
      data.video_url,
      data.thumbnail_url || "Pictures & Videos/video-thumbnail.svg",
      data.duration || "",
      data.sort_order || 0
    ]
  });
  return res.lastInsertRowid;
}

async function deleteVideo(id) {
  const db = getClient();
  await db.execute({
    sql: "DELETE FROM pak_videos WHERE id = ?",
    args: [id]
  });
}

async function authenticateAdmin(username, password) {
  const db = getClient();
  const res = await db.execute({
    sql: "SELECT * FROM pak_admins WHERE LOWER(username) = LOWER(?)",
    args: [username.trim()]
  });
  if (!res.rows.length) return null;
  const admin = res.rows[0];
  const isMatch = bcrypt.compareSync(password.trim(), String(admin.password_hash));
  if (!isMatch) return null;
  return { id: Number(admin.id), username: String(admin.username), role: String(admin.role) };
}

async function changeAdminPassword(username, newPassword) {
  const db = getClient();
  const newHash = bcrypt.hashSync(newPassword.trim(), 10);
  await db.execute({
    sql: "UPDATE pak_admins SET password_hash = ? WHERE LOWER(username) = LOWER(?)",
    args: [newHash, username.trim()]
  });
}

module.exports = {
  initDatabase,
  getDownloads,
  incrementDownloadCount,
  addDownload,
  deleteDownload,
  getGallery,
  addGalleryItem,
  deleteGalleryItem,
  getVideos,
  addVideo,
  deleteVideo,
  authenticateAdmin,
  changeAdminPassword
};
