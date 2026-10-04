const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
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

// Helper to generate unique License Key: TRSPAK-XXXX-YYYY-ZZZZ
function generateLicenseKey() {
  const segment = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `TRSPAK-${segment()}-${segment()}-${segment()}`;
}

async function initDatabase() {
  const db = getClient();

  // 1. Existing Tables
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

  // 2. NEW E-COMMERCE TABLES

  // Store Products
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL DEFAULT 0,
      sale_price REAL DEFAULT NULL,
      currency TEXT DEFAULT 'PKR',
      is_free INTEGER DEFAULT 0,
      image_url TEXT,
      file_url TEXT NOT NULL,
      file_size TEXT,
      version TEXT DEFAULT 'TRS19 / TRS22',
      description TEXT,
      kuid_info TEXT,
      badge TEXT,
      download_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Customer Orders
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_whatsapp TEXT NOT NULL,
      total_amount REAL NOT NULL,
      currency TEXT DEFAULT 'PKR',
      payment_method TEXT NOT NULL,
      transaction_id TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Order Items
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_title TEXT NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES pak_orders(id)
    );
  `);

  // Digital Licenses & DRM Tokens (Supports Web direct + Phase 3 Client App)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_title TEXT NOT NULL,
      download_count INTEGER DEFAULT 0,
      max_downloads INTEGER DEFAULT 10,
      hwid_lock TEXT,
      is_active INTEGER DEFAULT 1,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES pak_orders(id),
      FOREIGN KEY (product_id) REFERENCES pak_products(id)
    );
  `);

  // Payment & Store Settings Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
  `);

  // Seed default payment accounts if empty
  try {
    const setRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_settings");
    const setCount = Number(setRes.rows[0]?.cnt ?? setRes.rows[0]?.[0] ?? 0);
    if (setCount === 0) {
      const defaultSettings = [
        { key: "easypaisa_title", value: "Waqas Rasool / TRS DEP PAK" },
        { key: "easypaisa_number", value: "0300-1234567" },
        { key: "jazzcash_title", value: "Waqas Rasool / Pak Trainz" },
        { key: "jazzcash_number", value: "0300-1234567" },
        { key: "sadapay_title", value: "Waqas Rasool" },
        { key: "sadapay_number", value: "0300-1234567" },
        { key: "bank_name", value: "Meezan Bank" },
        { key: "bank_title", value: "Waqas Rasool" },
        { key: "bank_account", value: "0102-xxxxxxxxxxx" },
        { key: "bank_raast", value: "03001234567" },
        { key: "whatsapp_number", value: "03001234567" }
      ];
      for (const s of defaultSettings) {
        await db.execute({
          sql: "INSERT OR REPLACE INTO pak_settings (setting_key, setting_value) VALUES (?, ?)",
          args: [s.key, s.value]
        });
      }
      console.log("[db] Initialized default payment settings");
    }
  } catch (err) {
    console.error("[db] Error seeding settings:", err.message);
  }

  // Developer & Core Team Devices Table (Master Bypass for Waqas, Asif, Usman)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_dev_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      developer_name TEXT NOT NULL,
      device_name TEXT NOT NULL,
      location TEXT NOT NULL,
      hwid TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default developer devices if empty
  try {
    const devRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_dev_devices");
    const devCount = Number(devRes.rows[0]?.cnt ?? devRes.rows[0]?.[0] ?? 0);
    if (devCount === 0) {
      const initialDevs = [
        { developer_name: "Waqas Rasool", device_name: "Waqas Master PC & Laptop", location: "Rawalpindi", notes: "Super Admin & Project Lead" },
        { developer_name: "Asif Khan", device_name: "Asif Workstation", location: "Karachi", notes: "Core 3D Locomotive Designer" },
        { developer_name: "Usman Mani", device_name: "Usman Qatar Setup", location: "Qatar", notes: "Overseas Lead Developer" }
      ];
      for (const d of initialDevs) {
        await db.execute({
          sql: "INSERT INTO pak_dev_devices (developer_name, device_name, location, notes, is_active) VALUES (?, ?, ?, ?, 1)",
          args: [d.developer_name, d.device_name, d.location, d.notes]
        });
      }
      console.log("[db] Initialized 3 core developer master device profiles");
    }
  } catch (err) {
    console.error("[db] Error seeding developer devices:", err.message);
  }

  // Partners & Creators Table (Waqas, Asif, Usman + Dynamic External Partners)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pak_creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'Developer',
      type TEXT DEFAULT 'core',
      whatsapp TEXT,
      share_pct REAL DEFAULT 33.33,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default core team partners if empty
  try {
    const creatRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_creators");
    const creatCount = Number(creatRes.rows[0]?.cnt ?? creatRes.rows[0]?.[0] ?? 0);
    if (creatCount === 0) {
      const defaultCreators = [
        { name: "Waqas Rasool", role: "Super Admin & Developer", type: "core", whatsapp: "923001234567", share_pct: 33.33 },
        { name: "Asif Khan", role: "Core 3D Locomotive Designer", type: "core", whatsapp: "923001234567", share_pct: 33.33 },
        { name: "Usman Mani", role: "Overseas Lead Developer", type: "core", whatsapp: "923001234567", share_pct: 33.33 }
      ];
      for (const c of defaultCreators) {
        await db.execute({
          sql: "INSERT INTO pak_creators (name, role, type, whatsapp, share_pct, is_active) VALUES (?, ?, ?, ?, ?, 1)",
          args: [c.name, c.role, c.type, c.whatsapp, c.share_pct]
        });
      }
      console.log("[db] Initialized 3 core creators in pak_creators");
    }
  } catch (err) {
    console.error("[db] Error seeding creators:", err.message);
  }

  // Ensure new columns exist on pak_products for Creator Attribution & Revenue Split
  try {
    await db.execute("ALTER TABLE pak_products ADD COLUMN revenue_type TEXT DEFAULT 'shared'");
  } catch (e) {}
  try {
    await db.execute("ALTER TABLE pak_products ADD COLUMN creator_name TEXT DEFAULT 'Core Team (Shared)'");
  } catch (e) {}
  try {
    await db.execute("ALTER TABLE pak_products ADD COLUMN creator_whatsapp TEXT DEFAULT ''");
  } catch (e) {}
  try {
    await db.execute("ALTER TABLE pak_creators ADD COLUMN username TEXT DEFAULT ''");
  } catch (e) {}

  // Seed default core team admin accounts if missing (Waqas, Asif, Usman)
  try {
    const seedAdmins = [
      { username: "admin", pass: "trainz123", role: "superadmin" },
      { username: "waqas", pass: "waqas123", role: "superadmin" },
      { username: "asif", pass: "asif123", role: "admin" },
      { username: "usman", pass: "usman123", role: "admin" }
    ];
    for (const a of seedAdmins) {
      const exists = await db.execute({
        sql: "SELECT id FROM pak_admins WHERE LOWER(username) = LOWER(?)",
        args: [a.username]
      });
      if (!exists.rows.length) {
        const hash = bcrypt.hashSync(a.pass, 10);
        await db.execute({
          sql: "INSERT INTO pak_admins (username, password_hash, role) VALUES (?, ?, ?)",
          args: [a.username, hash, a.role]
        });
        console.log(`[db] Initialized team login: ${a.username} / ${a.pass}`);
      }
    }

    // Attach usernames to core creators in pak_creators
    await db.execute("UPDATE pak_creators SET username = 'admin' WHERE LOWER(name) LIKE '%waqas%' AND (username IS NULL OR username = '')");
    await db.execute("UPDATE pak_creators SET username = 'asif' WHERE LOWER(name) LIKE '%asif%' AND (username IS NULL OR username = '')");
    await db.execute("UPDATE pak_creators SET username = 'usman' WHERE LOWER(name) LIKE '%usman%' AND (username IS NULL OR username = '')");
  } catch (err) {
    console.error("[db] Error checking/seeding team admins:", err.message);
  }

  // Seed products if empty
  try {
    const prodRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_products");
    const prodCount = Number(prodRes.rows[0]?.cnt ?? prodRes.rows[0]?.[0] ?? 0);
    if (prodCount === 0) {
      const initialProducts = [
        {
          title: "HGMU 30 - R (Locomotive 8213) Master Pack",
          category: "Locomotives",
          price: 499,
          sale_price: 399,
          currency: "PKR",
          is_free: 0,
          image_url: "Pictures & Videos/1.png",
          file_url: "Pictures & Videos/HGMU 30 - R (8213).cdp",
          file_size: "200.5 MB",
          version: "TRS19 / TRS22",
          description: "High fidelity Pakistan Railways HGMU-30 Class (8213) Diesel Electric Locomotive. Features authentic PR liveries, custom cab interior view, realistic diesel engine physics, and custom horn.",
          kuid_info: "<kuid:8213:1001>",
          badge: "HOT"
        },
        {
          title: "ALU 24 Class Locomotive Pack",
          category: "Locomotives",
          price: 349,
          sale_price: 299,
          currency: "PKR",
          is_free: 0,
          image_url: "Pictures & Videos/3.png",
          file_url: "Pictures & Videos/ALU 24.cdp",
          file_size: "16.6 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways ALU-24 Class Locomotive with distinctive PR blue livery, accurate controls and high quality modeling.",
          kuid_info: "<kuid:8213:1002>",
          badge: "POPULAR"
        },
        {
          title: "AC-STANDARD 8032-5 Passenger Coach",
          category: "Rolling Stock",
          price: 249,
          sale_price: null,
          currency: "PKR",
          is_free: 0,
          image_url: "Pictures & Videos/5.png",
          file_url: "Pictures & Videos/AC-STANDARD 8032-5.cdp",
          file_size: "27.8 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways AC Standard passenger coach with complete 3D interior view, animated doors, night lighting, and passenger seating.",
          kuid_info: "<kuid:8213:1003>",
          badge: ""
        },
        {
          title: "Power Van / Generator Car",
          category: "Rolling Stock",
          price: 199,
          sale_price: null,
          currency: "PKR",
          is_free: 0,
          image_url: "Pictures & Videos/7.png",
          file_url: "Pictures & Videos/Power Van.cdp",
          file_size: "120.6 MB",
          version: "TRS19 / TRS22",
          description: "Pakistan Railways authentic Generator & Power Van rolling stock coach with custom diesel generator sound loop.",
          kuid_info: "<kuid:8213:1004>",
          badge: ""
        },
        {
          title: "Pakistan Railways Authentic Track & Scenery Pack",
          category: "Routes",
          price: 199,
          sale_price: 149,
          currency: "PKR",
          is_free: 0,
          image_url: "Pictures & Videos/4.png",
          file_url: "Pictures & Videos/Pakistan Railways.cdp",
          file_size: "2.2 MB",
          version: "TRS19 / TRS22",
          description: "Authentic Pakistan Railways 5ft 6in broad-gauge track, semaphore signals, level crossings and station scenery items.",
          kuid_info: "<kuid:8213:1005>",
          badge: "ESSENTIAL"
        },
        {
          title: "HGMU-30 & ALU-24 Sound Dependencies Pack",
          category: "Dependencies",
          price: 0,
          sale_price: null,
          currency: "PKR",
          is_free: 1,
          image_url: "Pictures & Videos/2.JPEG",
          file_url: "Pictures & Videos/HGMU-30 dependancies.cdp",
          file_size: "225.5 MB",
          version: "TRS19 / TRS22",
          description: "Essential community pack containing all required bogies, engine sounds, horns, and cab scripts for PR locomotives.",
          kuid_info: "<kuid:8213:1006>",
          badge: "FREE"
        }
      ];

      for (const p of initialProducts) {
        await db.execute({
          sql: `INSERT INTO pak_products (
            title, category, price, sale_price, currency, is_free, image_url, file_url, file_size, version, description, kuid_info, badge
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            p.title,
            p.category,
            p.price,
            p.sale_price,
            p.currency,
            p.is_free,
            p.image_url,
            p.file_url,
            p.file_size,
            p.version,
            p.description,
            p.kuid_info,
            p.badge
          ]
        });
      }
      console.log("[db] Seeded initial E-Commerce products");
    }
  } catch (err) {
    console.error("[db] Error checking/seeding products:", err.message);
  }

  // Seed downloads if empty (for backward compatibility)
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

  // Seed gallery if empty
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

  // Seed videos if empty
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

// ──────────────────────────────────────────
// E-COMMERCE PRODUCTS METHODS
// ──────────────────────────────────────────

async function getProducts(filter = {}) {
  const db = getClient();
  let sql = "SELECT * FROM pak_products WHERE is_active = 1";
  const args = [];

  if (filter.category && filter.category !== "All") {
    sql += " AND category = ?";
    args.push(filter.category);
  }

  if (filter.is_free !== undefined) {
    sql += " AND is_free = ?";
    args.push(filter.is_free ? 1 : 0);
  }

  sql += " ORDER BY is_free ASC, price DESC, id ASC";

  const res = await db.execute({ sql, args });
  return res.rows.map(r => ({
    id: Number(r.id),
    title: String(r.title || ""),
    category: String(r.category || "General"),
    price: Number(r.price || 0),
    sale_price: r.sale_price !== null && r.sale_price !== undefined ? Number(r.sale_price) : null,
    currency: String(r.currency || "PKR"),
    is_free: Number(r.is_free || 0) === 1,
    image_url: String(r.image_url || "Pictures & Videos/1.png"),
    file_url: String(r.file_url || ""),
    file_size: String(r.file_size || ""),
    version: String(r.version || "TRS19 / TRS22"),
    description: String(r.description || ""),
    kuid_info: String(r.kuid_info || ""),
    badge: String(r.badge || ""),
    revenue_type: String(r.revenue_type || "shared"),
    creator_name: String(r.creator_name || "Core Team (Shared)"),
    creator_whatsapp: String(r.creator_whatsapp || ""),
    download_count: Number(r.download_count || 0),
    created_at: String(r.created_at || "")
  }));
}

async function getProductById(id) {
  const db = getClient();
  const res = await db.execute({
    sql: "SELECT * FROM pak_products WHERE id = ?",
    args: [id]
  });
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    id: Number(r.id),
    title: String(r.title || ""),
    category: String(r.category || "General"),
    price: Number(r.price || 0),
    sale_price: r.sale_price !== null ? Number(r.sale_price) : null,
    currency: String(r.currency || "PKR"),
    is_free: Number(r.is_free || 0) === 1,
    image_url: String(r.image_url || ""),
    file_url: String(r.file_url || ""),
    file_size: String(r.file_size || ""),
    version: String(r.version || "TRS19 / TRS22"),
    description: String(r.description || ""),
    kuid_info: String(r.kuid_info || ""),
    badge: String(r.badge || ""),
    revenue_type: String(r.revenue_type || "shared"),
    creator_name: String(r.creator_name || "Core Team (Shared)"),
    creator_whatsapp: String(r.creator_whatsapp || ""),
    download_count: Number(r.download_count || 0)
  };
}

async function addProduct(data) {
  const db = getClient();
  const res = await db.execute({
    sql: `INSERT INTO pak_products (
      title, category, price, sale_price, currency, is_free, image_url, file_url,
      file_size, version, description, kuid_info, badge, revenue_type, creator_name, creator_whatsapp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.title,
      data.category || "Locomotives",
      Number(data.price) || 0,
      data.sale_price ? Number(data.sale_price) : null,
      data.currency || "PKR",
      data.is_free ? 1 : 0,
      data.image_url || "Pictures & Videos/1.png",
      data.file_url,
      data.file_size || "",
      data.version || "TRS19 / TRS22",
      data.description || "",
      data.kuid_info || "",
      data.badge || "",
      data.revenue_type || "shared",
      data.creator_name || "Core Team (Shared)",
      data.creator_whatsapp || ""
    ]
  });
  return res.lastInsertRowid;
}

async function updateProduct(id, data) {
  const db = getClient();
  await db.execute({
    sql: `UPDATE pak_products SET
      title = ?,
      category = ?,
      price = ?,
      sale_price = ?,
      badge = ?,
      version = ?,
      file_size = ?,
      file_url = ?,
      image_url = ?,
      kuid_info = ?,
      description = ?,
      revenue_type = ?,
      creator_name = ?,
      creator_whatsapp = ?
    WHERE id = ?`,
    args: [
      data.title,
      data.category || "Locomotives",
      Number(data.price) || 0,
      data.sale_price ? Number(data.sale_price) : null,
      data.badge || "",
      data.version || "TRS19 / TRS22",
      data.file_size || "",
      data.file_url,
      data.image_url || "Pictures & Videos/1.png",
      data.kuid_info || "",
      data.description || "",
      data.revenue_type || "shared",
      data.creator_name || "Core Team (Shared)",
      data.creator_whatsapp || "",
      id
    ]
  });
  return await getProductById(id);
}

async function deleteProduct(id) {
  const db = getClient();
  await db.execute({
    sql: "DELETE FROM pak_products WHERE id = ?",
    args: [id]
  });
}

// ──────────────────────────────────────────
// PAYMENT SETTINGS METHODS
// ──────────────────────────────────────────

async function getPaymentSettings() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_settings");
  const settings = {};
  for (const r of res.rows) {
    settings[String(r.setting_key)] = String(r.setting_value);
  }
  return settings;
}

async function updatePaymentSettings(data) {
  const db = getClient();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO pak_settings (setting_key, setting_value) VALUES (?, ?)",
        args: [key, String(value).trim()]
      });
    }
  }
  return await getPaymentSettings();
}

// ──────────────────────────────────────────
// ORDERS & LICENSES METHODS
// ──────────────────────────────────────────

async function createOrder(data) {
  const db = getClient();
  const orderNumber = "TRS-ORD-" + Date.now().toString().slice(-6) + "-" + Math.floor(100 + Math.random() * 900);

  const res = await db.execute({
    sql: `INSERT INTO pak_orders (
      order_number, customer_name, customer_email, customer_whatsapp, total_amount, currency, payment_method, transaction_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      orderNumber,
      data.customer_name,
      data.customer_email.trim().toLowerCase(),
      data.customer_whatsapp,
      Number(data.total_amount) || 0,
      data.currency || "PKR",
      data.payment_method,
      data.transaction_id || "N/A",
      Number(data.total_amount) === 0 ? "approved" : "pending" // Free orders auto-approved!
    ]
  });

  const orderId = Number(res.lastInsertRowid);

  // Insert Order Items
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      await db.execute({
        sql: "INSERT INTO pak_order_items (order_id, product_id, product_title, price) VALUES (?, ?, ?, ?)",
        args: [orderId, item.id, item.title, Number(item.price) || 0]
      });

      // If auto-approved (e.g. Free pack), generate license immediately
      if (Number(data.total_amount) === 0) {
        const key = generateLicenseKey();
        await db.execute({
          sql: `INSERT INTO pak_licenses (
            license_key, order_id, order_number, customer_email, product_id, product_title
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [key, orderId, orderNumber, data.customer_email.trim().toLowerCase(), item.id, item.title]
        });
      }
    }
  }

  return { orderId, orderNumber };
}

async function getOrder(orderNumber) {
  const db = getClient();
  const orderRes = await db.execute({
    sql: "SELECT * FROM pak_orders WHERE order_number = ?",
    args: [orderNumber]
  });
  if (!orderRes.rows.length) return null;
  const o = orderRes.rows[0];

  const itemsRes = await db.execute({
    sql: "SELECT * FROM pak_order_items WHERE order_id = ?",
    args: [o.id]
  });

  const licensesRes = await db.execute({
    sql: `SELECT l.*, p.file_url, p.file_size, p.version, p.kuid_info 
          FROM pak_licenses l
          LEFT JOIN pak_products p ON l.product_id = p.id
          WHERE l.order_id = ?`,
    args: [o.id]
  });

  return {
    id: Number(o.id),
    order_number: String(o.order_number),
    customer_name: String(o.customer_name),
    customer_email: String(o.customer_email),
    customer_whatsapp: String(o.customer_whatsapp),
    total_amount: Number(o.total_amount),
    currency: String(o.currency || "PKR"),
    payment_method: String(o.payment_method),
    transaction_id: String(o.transaction_id || ""),
    status: String(o.status),
    admin_notes: String(o.admin_notes || ""),
    created_at: String(o.created_at),
    items: itemsRes.rows.map(i => ({
      id: Number(i.id),
      product_id: Number(i.product_id),
      product_title: String(i.product_title),
      price: Number(i.price)
    })),
    licenses: licensesRes.rows.map(l => ({
      license_key: String(l.license_key),
      product_id: Number(l.product_id),
      product_title: String(l.product_title),
      download_count: Number(l.download_count),
      max_downloads: Number(l.max_downloads),
      file_url: String(l.file_url || ""),
      file_size: String(l.file_size || ""),
      version: String(l.version || "TRS19 / TRS22"),
      kuid_info: String(l.kuid_info || "")
    }))
  };
}

async function getAllOrders() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_orders ORDER BY id DESC");
  const orders = [];

  for (const o of res.rows) {
    const itemsRes = await db.execute({
      sql: "SELECT * FROM pak_order_items WHERE order_id = ?",
      args: [o.id]
    });
    const licRes = await db.execute({
      sql: "SELECT id, license_key, product_id, product_title, hwid_lock, is_active FROM pak_licenses WHERE order_id = ?",
      args: [o.id]
    });
    orders.push({
      id: Number(o.id),
      order_number: String(o.order_number),
      customer_name: String(o.customer_name),
      customer_email: String(o.customer_email),
      customer_whatsapp: String(o.customer_whatsapp),
      total_amount: Number(o.total_amount),
      currency: String(o.currency || "PKR"),
      payment_method: String(o.payment_method),
      transaction_id: String(o.transaction_id || ""),
      status: String(o.status),
      admin_notes: String(o.admin_notes || ""),
      created_at: String(o.created_at),
      items_count: itemsRes.rows.length,
      items: itemsRes.rows.map(i => String(i.product_title)),
      licenses: licRes.rows.map(l => ({
        id: Number(l.id),
        license_key: String(l.license_key),
        product_id: Number(l.product_id),
        product_title: String(l.product_title),
        hwid_lock: l.hwid_lock ? String(l.hwid_lock) : null,
        is_active: Number(l.is_active)
      }))
    });
  }

  return orders;
}

async function approveOrder(orderId, adminNotes = "") {
  const db = getClient();
  // 1. Mark status approved
  await db.execute({
    sql: "UPDATE pak_orders SET status = 'approved', admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [adminNotes || "Payment verified & approved", orderId]
  });

  // 2. Fetch order & items
  const orderRes = await db.execute({
    sql: "SELECT * FROM pak_orders WHERE id = ?",
    args: [orderId]
  });
  if (!orderRes.rows.length) return null;
  const order = orderRes.rows[0];

  const itemsRes = await db.execute({
    sql: "SELECT * FROM pak_order_items WHERE order_id = ?",
    args: [orderId]
  });

  // 3. Generate License Keys for each item if not already generated
  const existingLic = await db.execute({
    sql: "SELECT product_id FROM pak_licenses WHERE order_id = ?",
    args: [orderId]
  });
  const existingProductIds = new Set(existingLic.rows.map(l => Number(l.product_id)));

  for (const item of itemsRes.rows) {
    if (!existingProductIds.has(Number(item.product_id))) {
      const key = generateLicenseKey();
      await db.execute({
        sql: `INSERT INTO pak_licenses (
          license_key, order_id, order_number, customer_email, product_id, product_title
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [key, orderId, order.order_number, order.customer_email, item.product_id, item.product_title]
      });
    }
  }

  return { success: true, order_number: order.order_number };
}

async function rejectOrder(orderId, reason = "") {
  const db = getClient();
  await db.execute({
    sql: "UPDATE pak_orders SET status = 'rejected', admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [reason || "Payment could not be verified", orderId]
  });
  return { success: true };
}

// Secure download verification
async function verifyAndConsumeDownload(licenseKey) {
  const db = getClient();
  const res = await db.execute({
    sql: `SELECT l.*, p.file_url, p.file_size, p.title, p.id as prod_id 
          FROM pak_licenses l
          JOIN pak_products p ON l.product_id = p.id
          WHERE l.license_key = ?`,
    args: [licenseKey.trim()]
  });

  if (!res.rows.length) {
    return { valid: false, error: "Invalid License Key" };
  }

  const lic = res.rows[0];
  if (Number(lic.is_active) !== 1) {
    return { valid: false, error: "License key is deactivated or suspended." };
  }

  const count = Number(lic.download_count || 0);
  const max = Number(lic.max_downloads || 10);
  if (count >= max) {
    return { valid: false, error: `Download limit reached (${max}/${max} downloads used). Contact support for reset.` };
  }

  // Increment download count
  await db.execute({
    sql: "UPDATE pak_licenses SET download_count = download_count + 1 WHERE id = ?",
    args: [lic.id]
  });

  await db.execute({
    sql: "UPDATE pak_products SET download_count = download_count + 1 WHERE id = ?",
    args: [lic.prod_id]
  });

  return {
    valid: true,
    file_url: String(lic.file_url),
    title: String(lic.title),
    downloads_remaining: max - (count + 1)
  };
}

// ──────────────────────────────────────────
// DEVELOPER & MASTER BYPASS METHODS (Phase 3 Core Team)
// ──────────────────────────────────────────

async function getDeveloperDevices() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_dev_devices ORDER BY id ASC");
  return res.rows.map(r => ({
    id: Number(r.id),
    developer_name: String(r.developer_name || ""),
    device_name: String(r.device_name || ""),
    location: String(r.location || ""),
    hwid: r.hwid ? String(r.hwid) : "",
    notes: r.notes ? String(r.notes) : "",
    is_active: Number(r.is_active ?? 1),
    created_at: String(r.created_at || "")
  }));
}

async function addDeveloperDevice(data) {
  const db = getClient();
  const res = await db.execute({
    sql: "INSERT INTO pak_dev_devices (developer_name, device_name, location, hwid, notes, is_active) VALUES (?, ?, ?, ?, ?, 1)",
    args: [data.developer_name, data.device_name, data.location || "Pakistan", data.hwid || "", data.notes || ""]
  });
  return res.lastInsertRowid;
}

async function deleteDeveloperDevice(id) {
  const db = getClient();
  await db.execute({
    sql: "DELETE FROM pak_dev_devices WHERE id = ?",
    args: [id]
  });
}

async function isDeveloperWhitelisted(email, hwid) {
  const db = getClient();
  if (hwid) {
    const hwRes = await db.execute({
      sql: "SELECT id FROM pak_dev_devices WHERE hwid = ? AND is_active = 1",
      args: [hwid.trim()]
    });
    if (hwRes.rows.length > 0) return true;
  }
  if (email) {
    const em = email.toLowerCase().trim();
    if (em.includes("waqas") || em.includes("asif") || em.includes("usman") || em.includes("admin")) {
      return true;
    }
  }
  return false;
}

// Client App Authentication & License Verification (Phase 3 Ready!)
async function verifyClientAppLicense(email, licenseKey, hwid) {
  const db = getClient();
  const isDev = await isDeveloperWhitelisted(email, hwid);

  // 1. Developer Master Bypass Key Check (Unlocks All Products!)
  const cleanKey = (licenseKey || "").trim().toUpperCase();
  if (cleanKey === "TRS-MASTER-BYPASS" || cleanKey === "TRS-DEV-ALL" || cleanKey.startsWith("TRS-MASTER-")) {
    const allProds = await getProducts();
    return {
      success: true,
      is_developer: true,
      master_bypass: true,
      developer_notice: "👑 Developer Master Mode: All Pakistan Railways Addons Unlocked (Zero HWID Lock)",
      products: allProds
    };
  }

  // 2. Standard License Verification
  const res = await db.execute({
    sql: `SELECT l.*, p.file_url, p.kuid_info, p.version, p.title 
          FROM pak_licenses l
          JOIN pak_products p ON l.product_id = p.id
          WHERE LOWER(l.customer_email) = LOWER(?) AND l.license_key = ?`,
    args: [email.trim(), licenseKey.trim()]
  });

  if (!res.rows.length) {
    return { success: false, error: "Invalid email or license key." };
  }

  const lic = res.rows[0];
  if (Number(lic.is_active) !== 1) {
    return { success: false, error: "This license has been suspended." };
  }

  // 3. HWID Lock: Bypassed for verified developer devices, strictly enforced for customers
  if (hwid && !isDev) {
    if (!lic.hwid_lock) {
      // First time activation on a PC -> lock HWID
      await db.execute({
        sql: "UPDATE pak_licenses SET hwid_lock = ? WHERE id = ?",
        args: [hwid, lic.id]
      });
    } else if (lic.hwid_lock !== hwid) {
      return { success: false, error: "License is locked to a different computer hardware ID." };
    }
  }

  return {
    success: true,
    is_developer: isDev,
    product: {
      id: Number(lic.product_id),
      title: String(lic.title),
      version: String(lic.version),
      kuid: String(lic.kuid_info || ""),
      download_url: String(lic.file_url)
    }
  };
}

// Direct Developer Login from Desktop Client App (Waqas, Asif, Usman)
async function developerClientLogin(username, password, hwid) {
  let admin = await authenticateAdmin(username, password);
  if (!admin) {
    // Master developer key fallback for core team members (Waqas, Asif, Usman)
    if (password === "TRS-MASTER-BYPASS" || password === "trainz123" || password === "TRS-DEV-ALL") {
      admin = { username: username || "Core Developer", role: "admin" };
    } else {
      return { success: false, error: "Invalid developer/admin username or password." };
    }
  }

  // Auto-register device HWID in pak_dev_devices if not present
  if (hwid) {
    try {
      const db = getClient();
      const existing = await db.execute({
        sql: "SELECT id FROM pak_dev_devices WHERE hwid = ?",
        args: [hwid.trim()]
      });
      if (!existing.rows.length) {
        await db.execute({
          sql: "INSERT INTO pak_dev_devices (developer_name, device_name, location, hwid, notes, is_active) VALUES (?, ?, ?, ?, ?, 1)",
          args: [admin.username, `${admin.username} PC/Workstation`, "Auto-Registered Machine", hwid.trim(), "Auto-registered via Desktop Client Login"]
        });
      }
    } catch (e) {
      console.warn("Dev device auto-register:", e.message);
    }
  }

  const allProds = await getProducts();
  return {
    success: true,
    is_developer: true,
    master_bypass: true,
    developer_name: admin.username,
    developer_notice: `👑 Welcome ${admin.username}! Master Developer Mode Active (Unrestricted access across all machines).`,
    products: allProds
  };
}

// E-commerce Stats
async function getStoreStats() {
  const db = getClient();
  const revRes = await db.execute("SELECT SUM(total_amount) as total_rev FROM pak_orders WHERE status = 'approved'");
  const totalRev = Number(revRes.rows[0]?.total_rev || 0);

  const ordRes = await db.execute("SELECT status, COUNT(*) as cnt FROM pak_orders GROUP BY status");
  let pending = 0, approved = 0, rejected = 0;
  for (const r of ordRes.rows) {
    if (r.status === "pending") pending = Number(r.cnt);
    if (r.status === "approved") approved = Number(r.cnt);
    if (r.status === "rejected") rejected = Number(r.cnt);
  }

  const prodRes = await db.execute("SELECT COUNT(*) as cnt FROM pak_products WHERE is_active = 1");
  const prodCount = Number(prodRes.rows[0]?.cnt || 0);

  return {
    totalRevenue: totalRev,
    pendingOrders: pending,
    approvedOrders: approved,
    rejectedOrders: rejected,
    totalProducts: prodCount
  };
}

// ──────────────────────────────────────────
// LICENSE PC RESET & DEVICE TRANSFER
// ──────────────────────────────────────────

async function resetLicenseHWID(licenseId) {
  const db = getClient();
  await db.execute({
    sql: "UPDATE pak_licenses SET hwid_lock = NULL WHERE id = ?",
    args: [licenseId]
  });
  return { success: true, message: "PC license lock reset. Customer can now bind to their new PC." };
}

// ──────────────────────────────────────────
// TEAM EARNINGS & CREATOR ATTRIBUTION METHODS
// ──────────────────────────────────────────

async function getCreators() {
  const db = getClient();
  const res = await db.execute("SELECT * FROM pak_creators ORDER BY id ASC");
  return res.rows.map(c => ({
    id: Number(c.id),
    name: String(c.name),
    role: String(c.role || "Developer"),
    type: String(c.type || "core"),
    username: String(c.username || ""),
    whatsapp: String(c.whatsapp || ""),
    share_pct: Number(c.share_pct || (c.type === 'core' ? 33.33 : 70)),
    is_active: Number(c.is_active ?? 1),
    created_at: String(c.created_at || "")
  }));
}

async function addCreator(data) {
  const db = getClient();
  const rawUsername = (data.username || data.name.trim().toLowerCase().split(' ')[0] || "creator").replace(/[^a-zA-Z0-9_]/g, '');
  const username = rawUsername || `creator_${Date.now()}`;
  const password = data.password ? data.password.trim() : `${username}123`;
  const sharePct = Number(data.share_pct) || (data.type === 'core' ? 33.33 : 70);

  // 1. Insert into pak_creators
  const res = await db.execute({
    sql: "INSERT INTO pak_creators (name, role, type, whatsapp, share_pct, username, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
    args: [data.name, data.role || "External Partner", data.type || "external", data.whatsapp || "", sharePct, username]
  });

  // 2. Automatically create login account in pak_admins
  try {
    const existingAdmin = await db.execute({
      sql: "SELECT id FROM pak_admins WHERE LOWER(username) = LOWER(?)",
      args: [username]
    });
    if (!existingAdmin.rows.length) {
      const hash = bcrypt.hashSync(password, 10);
      await db.execute({
        sql: "INSERT INTO pak_admins (username, password_hash, role) VALUES (?, ?, ?)",
        args: [username, hash, data.type === 'core' ? 'admin' : 'creator']
      });
      console.log(`[db] Auto-created login account for partner: ${username} / ${password}`);
    }
  } catch (err) {
    console.error("[db] Error creating admin login for partner:", err.message);
  }

  return { id: res.lastInsertRowid, username, password, share_pct: sharePct };
}

async function deleteCreator(id) {
  const db = getClient();
  try {
    const cRes = await db.execute({ sql: "SELECT username, type FROM pak_creators WHERE id = ?", args: [id] });
    if (cRes.rows.length && cRes.rows[0].username && cRes.rows[0].type !== 'core') {
      const u = String(cRes.rows[0].username);
      await db.execute({ sql: "DELETE FROM pak_admins WHERE LOWER(username) = LOWER(?) AND role = 'creator'", args: [u] });
    }
  } catch (e) {}

  await db.execute({
    sql: "DELETE FROM pak_creators WHERE id = ?",
    args: [id]
  });
}

async function getTeamEarnings() {
  const db = getClient();
  
  // 1. Fetch active creators
  const creatorsRes = await db.execute("SELECT * FROM pak_creators WHERE is_active = 1 ORDER BY id ASC");
  const creators = creatorsRes.rows.map(c => ({
    id: Number(c.id),
    name: String(c.name),
    role: String(c.role || "Developer"),
    type: String(c.type || 'core'),
    username: String(c.username || ''),
    whatsapp: String(c.whatsapp || ''),
    share_pct: Number(c.share_pct || (c.type === 'core' ? 33.33 : 70)),
    shared_earnings: 0,
    solo_earnings: 0,
    admin_commission: 0,
    total_earnings: 0,
    sales_count: 0
  }));

  // 2. Fetch approved order items
  const itemsRes = await db.execute(`
    SELECT oi.*, o.order_number, o.created_at, p.revenue_type, p.creator_name, p.creator_whatsapp
    FROM pak_order_items oi
    JOIN pak_orders o ON oi.order_id = o.id
    LEFT JOIN pak_products p ON oi.product_id = p.id
    WHERE o.status = 'approved'
  `);

  let totalStoreRevenue = 0;
  let sharedPool = 0;
  let totalAdminCommission = 0;
  let totalExternalEarnings = 0;
  const productStats = {};

  for (const item of itemsRes.rows) {
    const price = Number(item.price || 0);
    const prodTitle = String(item.product_title || 'Locomotive Model');
    const revType = String(item.revenue_type || 'shared');
    const creatorName = String(item.creator_name || 'Core Team (Shared)');

    totalStoreRevenue += price;

    if (!productStats[prodTitle]) {
      productStats[prodTitle] = { 
        title: prodTitle, 
        sales: 0, 
        revenue: 0, 
        creator: creatorName, 
        type: revType,
        creator_cut: 0,
        admin_cut: 0 
      };
    }
    productStats[prodTitle].sales += 1;
    productStats[prodTitle].revenue += price;

    if (revType === 'solo') {
      const found = creators.find(c => c.name.toLowerCase() === creatorName.toLowerCase());
      // External creator gets their share_pct (default 70%), Main Admin gets remainder (default 30%)
      const creatorPct = found ? (Number(found.share_pct) || 70) : 70;
      const creatorCut = Math.round(price * (creatorPct / 100));
      const adminCut = price - creatorCut;

      totalAdminCommission += adminCut;
      totalExternalEarnings += creatorCut;

      productStats[prodTitle].creator_cut += creatorCut;
      productStats[prodTitle].admin_cut += adminCut;

      if (found) {
        found.solo_earnings += creatorCut;
        found.sales_count += 1;
      }
    } else {
      sharedPool += price;
    }
  }

  // Split shared pool equally among core members (Waqas, Asif, Usman)
  const coreCreators = creators.filter(c => c.type === 'core');
  const coreCount = coreCreators.length || 3;
  const perCoreShare = Math.round(sharedPool / coreCount);

  for (const c of creators) {
    if (c.type === 'core') {
      c.shared_earnings = perCoreShare;
      // Main Admin (Waqas) gets the 30% platform fee from all external creator sales!
      if (c.name.toLowerCase().includes('waqas') || c.role.toLowerCase().includes('super admin')) {
        c.admin_commission = totalAdminCommission;
      }
    }
    c.total_earnings = c.shared_earnings + c.solo_earnings + (c.admin_commission || 0);
  }

  return {
    totalRevenue: totalStoreRevenue,
    sharedPool: Math.round(sharedPool),
    perCoreShare: perCoreShare,
    adminCommission: totalAdminCommission,
    externalEarnings: totalExternalEarnings,
    creators,
    productSales: Object.values(productStats)
  };
}

// ──────────────────────────────────────────
// EXISTING CRUD METHODS (Downloads, Gallery, Videos, Admin)
// ──────────────────────────────────────────

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
  // Products
  getProducts,
  getProductById,
  addProduct,
  updateProduct,
  deleteProduct,
  // Payment Accounts & Settings
  getPaymentSettings,
  updatePaymentSettings,
  // Developer & Core Team Devices (Phase 3 Master Bypass)
  getDeveloperDevices,
  addDeveloperDevice,
  deleteDeveloperDevice,
  isDeveloperWhitelisted,
  developerClientLogin,
  // Orders & Licenses
  createOrder,
  getOrder,
  getAllOrders,
  approveOrder,
  rejectOrder,
  verifyAndConsumeDownload,
  verifyClientAppLicense,
  resetLicenseHWID,
  getStoreStats,
  getTeamEarnings,
  // Creators & Partners
  getCreators,
  addCreator,
  deleteCreator,
  // Legacy downloads, gallery, videos & auth
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
