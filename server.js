const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const compression = require("compression");
const multer = require("multer");

let sqlite3;
let createClient;

const app = express();
const PORT = process.env.PORT || 3040;

const DEFAULT_JWT_SECRET = "your-secret-key-here-change-this-in-production";
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn(
    "[SECURITY WARNING] JWT_SECRET is using the insecure default. Set JWT_SECRET in your environment variables before deploying to production.",
  );
}

// CORS: allow same-origin and any configured ALLOWED_ORIGINS (comma-separated)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, mobile apps, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("CORS: origin not allowed"));
  },
  optionsSuccessStatus: 200,
};

// Rate limiters for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled so CDN scripts in index.html still load
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: "8mb" }));
app.use(express.static("public", { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

// Database setup (LibSQL/Turso first, fallback to local SQLite)
const useLibsql = Boolean(process.env.LIBSQL_URL);
const storageMode = useLibsql ? "libsql" : "sqlite";
const dbPath =
  process.env.NODE_ENV === "production"
    ? "/tmp/expense_tracker.db"
    : "./expense_tracker.db";
let db;
let ftsHasBm25 = false;

// Receipt storage: local disk next to the database. This server (SQLite/local
// dev) is not the production backend — see functions/index.js, which stores
// receipts in Firebase Storage instead since Cloud Functions have no
// persistent local filesystem across invocations.
const uploadsDir =
  process.env.NODE_ENV === "production"
    ? "/tmp/uploads/receipts"
    : path.join(__dirname, "uploads", "receipts");
fs.mkdirSync(uploadsDir, { recursive: true });

const RECEIPT_MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

function makeReceiptUpload(prefix) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const ext = RECEIPT_MIME_EXT[file.mimetype] || "";
        cb(null, `${prefix}${req.user.userId}-${req.params.id}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!RECEIPT_MIME_EXT[file.mimetype]) {
        return cb(new Error("Only JPEG, PNG, WEBP, GIF images or PDF files are allowed"));
      }
      cb(null, true);
    },
  });
}

const receiptUpload = makeReceiptUpload("");
const purchaseReceiptUpload = makeReceiptUpload("purchase-");

function makeReceiptMiddleware(uploader) {
  return function (req, res, next) {
    uploader.single("receipt")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "Upload failed" });
      next();
    });
  };
}

const uploadReceiptMiddleware = makeReceiptMiddleware(receiptUpload);
const uploadPurchaseReceiptMiddleware = makeReceiptMiddleware(purchaseReceiptUpload);

// Development auth toggle: set DISABLE_AUTH=1 to explicitly disable auth checks.
// Auth is ENABLED by default in all environments; opt-out is explicit.
const devAuthFromEnv = process.env.DISABLE_AUTH === "1";
let devAuthDisabled = Boolean(devAuthFromEnv);
if (devAuthDisabled) {
  console.warn(
    "[SECURITY WARNING] Authentication is DISABLED via DISABLE_AUTH=1. Do NOT use this in production.",
  );
}

if (!useLibsql) {
  try {
    sqlite3 = require("sqlite3").verbose();
    console.log("SQLite3 module loaded successfully");
  } catch (err) {
    console.error("Failed to load sqlite3 driver:", err.message);
    console.error(
      "Either set LIBSQL_URL for remote DB or ensure sqlite3 is installed",
    );
    process.exit(1);
  }
}

if (useLibsql) {
  try {
    ({ createClient } = require("@libsql/client"));
  } catch (err) {
    console.error("Failed to load @libsql/client:", err);
    process.exit(1);
  }
  console.log("Attempting LibSQL connection...");
  console.log("URL:", process.env.LIBSQL_URL);
  console.log("Auth token present:", !!process.env.LIBSQL_AUTH_TOKEN);

  db = createClient({
    url: process.env.LIBSQL_URL,
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  });

  console.log("LibSQL client created.");
  console.log(
    "Note: Migration API errors can be ignored - actual queries may still work.",
  );
} else {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error("Error opening database:", err);
    } else {
      console.log("Connected to SQLite database");
      initializeDatabase()
        .then(() => {
          generateDueRecurringExpenses();
          setInterval(generateDueRecurringExpenses, 24 * 60 * 60 * 1000);
        })
        .catch((initErr) => {
          console.error("Error initializing SQLite database:", initErr);
        });
    }
  });
}

async function initializeDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date_time TEXT NOT NULL,
            category TEXT NOT NULL,
            session_term TEXT,
            recipient TEXT NOT NULL,
            description TEXT NOT NULL,
            amount_paid REAL NOT NULL,
            balance_due REAL DEFAULT 0,
            status TEXT DEFAULT 'Paid',
            deleted_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
    `CREATE TABLE IF NOT EXISTS blog_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date_time TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
    `CREATE TABLE IF NOT EXISTS budget_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            threshold REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, category),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
    `CREATE TABLE IF NOT EXISTS recurring_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            session_term TEXT,
            recipient TEXT NOT NULL,
            description TEXT NOT NULL,
            amount_paid REAL NOT NULL,
            balance_due REAL DEFAULT 0,
            frequency TEXT NOT NULL,
            next_run_date TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            last_generated_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
    `CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item TEXT NOT NULL,
            category TEXT,
            estimated_cost REAL NOT NULL,
            priority TEXT DEFAULT 'Medium',
            target_date TEXT,
            status TEXT DEFAULT 'Planned',
            notes TEXT,
            linked_expense_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (linked_expense_id) REFERENCES expenses (id)
        )`,
    // Performance indexes
    `CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date_time DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(user_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_session_term ON expenses(user_id, session_term)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(user_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_blog_user_date ON blog_posts(user_id, date_time DESC)`,
  ];

  for (const statement of statements) {
    await dbRun(statement);
  }

  // Schema migrations: add columns that may not exist in older databases
  const migrations = [
    `ALTER TABLE blog_posts ADD COLUMN modified_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE expenses ADD COLUMN deleted_at DATETIME DEFAULT NULL`,
    `ALTER TABLE expenses ADD COLUMN due_date TEXT DEFAULT NULL`,
    `ALTER TABLE expenses ADD COLUMN recurring_template_id INTEGER DEFAULT NULL`,
    `ALTER TABLE expenses ADD COLUMN receipt_path TEXT DEFAULT NULL`,
    `ALTER TABLE purchases ADD COLUMN receipt_path TEXT DEFAULT NULL`,
  ];
  for (const migration of migrations) {
    try {
      await dbRun(migration);
    } catch (_err) {
      // Column already exists — safe to ignore duplicate column errors
    }
  }

  // If using local SQLite, create an FTS5 virtual table and triggers for fast text search
  if (!useLibsql) {
    try {
      // Create FTS5 virtual table that indexes description and recipient and links to expenses
      await dbRun(
        `CREATE VIRTUAL TABLE IF NOT EXISTS expenses_fts USING fts5(description, recipient, content='expenses', content_rowid='id')`,
      );

      // Triggers to keep the FTS table in sync with the expenses table
      await dbRun(`CREATE TRIGGER IF NOT EXISTS expenses_ai AFTER INSERT ON expenses BEGIN
                INSERT INTO expenses_fts(rowid, description, recipient) VALUES (new.id, new.description, new.recipient);
            END;`);

      await dbRun(`CREATE TRIGGER IF NOT EXISTS expenses_ad AFTER DELETE ON expenses BEGIN
                DELETE FROM expenses_fts WHERE rowid = old.id;
            END;`);

      await dbRun(`CREATE TRIGGER IF NOT EXISTS expenses_au AFTER UPDATE ON expenses BEGIN
                DELETE FROM expenses_fts WHERE rowid = old.id;
                INSERT INTO expenses_fts(rowid, description, recipient) VALUES (new.id, new.description, new.recipient);
            END;`);
      // Test for bm25 support (FTS5 ranking) — set flag for optimized queries
      try {
        await dbAll(`SELECT bm25(expenses_fts) as r FROM expenses_fts LIMIT 0`);
        ftsHasBm25 = true;
        console.log("FTS bm25 ranking is available.");
      } catch (err) {
        ftsHasBm25 = false;
        console.log("FTS bm25 not available; falling back to simpler ranking.");
      }
    } catch (err) {
      console.warn(
        "FTS setup failed or not available:",
        err && err.message ? err.message : err,
      );
    }
  }
}

// Helper function for database queries with promises
function dbAll(sql, params = []) {
  if (useLibsql) {
    return db.execute({ sql, args: params }).then((result) => {
      const columns = result.columns || [];
      const rows = result.rows || [];

      return rows.map((row) => {
        if (typeof row === "object" && !Array.isArray(row)) {
          return row;
        }

        const obj = {};
        columns.forEach((colName, index) => {
          obj[colName] = row[index];
        });
        return obj;
      });
    });
  }

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  if (useLibsql) {
    return db.execute({ sql, args: params }).then((result) => ({
      id:
        result.lastInsertRowid !== undefined && result.lastInsertRowid !== null
          ? Number(result.lastInsertRowid)
          : null,
      changes:
        typeof result.rowsAffected === "number" ? result.rowsAffected : 0,
    }));
  }

  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID ?? null, changes: this.changes ?? 0 });
    });
  });
}

function formatDateTimeBoundary(value, edge) {
  if (!value) return value;
  if (value.includes("T")) {
    return value.replace("T", " ").slice(0, 16);
  }
  return edge === "start" ? `${value} 00:00` : `${value} 23:59`;
}

/**
 * Safely escape a string for use in an FTS5 MATCH expression.
 * Strips all FTS5 operator characters and quotes to prevent injection.
 * Only alphanumeric, spaces, underscores, and hyphens are kept.
 */
function escapeForFts(s) {
  // Remove FTS5 special characters: " * ^ ( ) ~ + - . , : ; ! ?
  // Keep alphanumeric, underscore, hyphen, and spaces only
  return String(s).replace(/[^a-zA-Z0-9_ \-]/g, " ").trim();
}

// Authentication middleware
function authenticateToken(req, res, next) {
  // Bypass auth in development when explicitly disabled
  if (devAuthDisabled) {
    // Inject a lightweight dev user
    req.user = { userId: 1, username: "dev" };
    return next();
  }

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  // Check if this is a Firebase token (JWT with specific structure)
  if (token.startsWith("ey")) {
    // This looks like a JWT token - could be Firebase or our own
    // For now, let's try to verify it as a Firebase token by checking the issuer
    try {
      // Decode the token to check the issuer without verification
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString(),
      );

      // If it's a Firebase token (has 'firebase' in the issuer or specific claims)
      if (payload.iss && payload.iss.includes("firebase")) {
        // For Firebase tokens, we'll trust them for now and extract user info
        // In production, you'd want to verify with Firebase Admin SDK
        req.user = {
          userId: payload.user_id || payload.sub,
          username: payload.email || payload.name || "firebase_user",
        };
        return next();
      }
    } catch (decodeError) {
      // If decoding fails, fall through to JWT verification
      console.log("Could not decode token, falling back to JWT verification");
    }
  }

  // Standard JWT verification for our own tokens
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

// Routes

// Dev-only: runtime toggle endpoints to enable/disable auth checks without restarting the server
if (process.env.NODE_ENV !== "production") {
  app.post("/dev/disable-auth", (req, res) => {
    devAuthDisabled = true;
    res.json({ message: "Auth disabled for development" });
  });

  app.post("/dev/enable-auth", (req, res) => {
    devAuthDisabled = false;
    res.json({ message: "Auth enabled" });
  });

  app.get("/dev/auth-status", (req, res) => {
    res.json({ devAuthDisabled });
  });
}

// Status endpoint (unauthenticated)
app.get("/api/status", async (req, res) => {
  try {
    // Test database connection
    if (useLibsql) {
      await db.execute("SELECT 1 as test");
    }

    res.json({
      storageMode,
      libsqlUrl: useLibsql ? process.env.LIBSQL_URL : null,
      status: "ok",
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      storageMode,
      libsqlUrl: useLibsql ? process.env.LIBSQL_URL : null,
      status: "error",
      error: error.message,
    });
  }
});

// User registration
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    if (typeof username !== "string" || username.trim().length < 3 || username.trim().length > 50) {
      return res.status(400).json({ error: "Username must be 3-50 characters" });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 8-128 characters" });
    }
    const sanitizedUsername = username.trim();

    // Check if user exists
    const existingUser = await dbAll(
      "SELECT id FROM users WHERE username = ?",
      [sanitizedUsername],
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await dbRun(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [sanitizedUsername, passwordHash],
    );

    // Generate token
    const token = jwt.sign({ userId: result.id, username: sanitizedUsername }, JWT_SECRET, {
      expiresIn: "24h",
    });

    res.json({
      message: "User created successfully",
      token,
      user: { id: result.id, username: sanitizedUsername },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User login
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Find user
    const users = await dbAll("SELECT * FROM users WHERE username = ?", [
      username,
    ]);
    if (users.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Expenses routes
app.get("/api/expenses", authenticateToken, async (req, res) => {
  try {
    const {
      session_term,
      term,
      category,
      status,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      sortBy,
      pageSize,
      page,
      cursor,
    } = req.query;
    const conditions = ["user_id = ?", "deleted_at IS NULL"];
    const params = [req.user.userId];

    // Accept both session_term and term for compatibility
    const sessionTermValue = session_term || term;
    if (sessionTermValue) {
      conditions.push("session_term = ?");
      params.push(sessionTermValue);
    }

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    // Amount range filters
    if (minAmount) {
      const min = parseFloat(minAmount);
      if (!isNaN(min)) {
        conditions.push("(amount_paid + balance_due) >= ?");
        params.push(min);
      }
    }
    if (maxAmount) {
      const max = parseFloat(maxAmount);
      if (!isNaN(max)) {
        conditions.push("(amount_paid + balance_due) <= ?");
        params.push(max);
      }
    }

    if (startDate) {
      conditions.push("date_time >= ?");
      params.push(formatDateTimeBoundary(startDate, "start"));
    }

    if (endDate) {
      conditions.push("date_time <= ?");
      params.push(formatDateTimeBoundary(endDate, "end"));
    }

    // Optional advanced text search: support qMode (phrase|all|any|prefix) and qFields (csv)
    if (req.query.q) {
      const rawQ = String(req.query.q || "").trim();
      const qMode = String(req.query.qMode || "any").toLowerCase();
      const qFields = String(req.query.qFields || "description,recipient")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (!useLibsql) {
        // Build an FTS5 MATCH expression safely from tokens and fields
        const tokens = rawQ
          .split(/\s+/)
          .map((t) => escapeForFts(t))
          .filter(Boolean);
        let perFieldExpr = qFields
          .map((f) => {
            if (qMode === "phrase") {
              return `${f}:"${escapeForFts(rawQ)}"`;
            }
            if (qMode === "prefix") {
              return tokens.map((t) => `${f}:${t}*`).join(" OR ");
            }
            if (qMode === "all") {
              return tokens.map((t) => `${f}:${t}`).join(" AND ");
            }
            // default 'any'
            return tokens.map((t) => `${f}:${t}`).join(" OR ");
          })
          .filter(Boolean);

        const matchExpr = perFieldExpr.join(" OR ");
        if (matchExpr) {
          conditions.push(
            "id IN (SELECT rowid FROM expenses_fts WHERE expenses_fts MATCH ?)",
          );
          params.push(matchExpr);
        }
      } else {
        // Fallback for non-SQLite backends: use LIKE clauses
        const tokens = rawQ
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => t.toLowerCase());
        if (tokens.length) {
          const clauses = [];
          const fieldList = qFields.length
            ? qFields
            : ["description", "recipient"];
          if (qMode === "phrase") {
            const p = `%${rawQ.toLowerCase()}%`;
            clauses.push(
              `(${fieldList.map(() => "LOWER(" + "??" + ") LIKE ?").join(" OR ")})`,
            );
            // We'll push fields and params below in a safe order
            // But since parameterized column names aren't supported, fall back to simple OR across known columns
            conditions.push(
              "(" +
                fieldList.map((f) => `LOWER(${f}) LIKE ?`).join(" OR ") +
                ")",
            );
            for (const f of fieldList) params.push(`%${rawQ.toLowerCase()}%`);
          } else {
            // For 'all' and 'any' and 'prefix', build combined conditions
            if (qMode === "all") {
              // Every token must be present in at least one of the fields
              tokens.forEach((tok) => {
                const sub =
                  "(" +
                  fieldList.map((f) => `LOWER(${f}) LIKE ?`).join(" OR ") +
                  ")";
                clauses.push(sub);
                for (let i = 0; i < fieldList.length; i++)
                  params.push(`%${tok}%`);
              });
              conditions.push(clauses.join(" AND "));
            } else if (qMode === "prefix") {
              // Any token prefix in any field
              const sub =
                "(" +
                fieldList
                  .map((f) =>
                    tokens.map(() => `LOWER(${f}) LIKE ?`).join(" OR "),
                  )
                  .join(" OR ") +
                ")";
              conditions.push(sub);
              for (const f of fieldList)
                tokens.forEach((tok) => params.push(`${tok}%`));
            } else {
              // 'any' - any token in any field
              const parts = [];
              tokens.forEach((tok) => {
                parts.push(
                  "(" +
                    fieldList.map((f) => `LOWER(${f}) LIKE ?`).join(" OR ") +
                    ")",
                );
                for (let i = 0; i < fieldList.length; i++)
                  params.push(`%${tok}%`);
              });
              conditions.push("(" + parts.join(" OR ") + ")");
            }
          }
        }
      }
    }

    // Optional text search: prefer SQLite FTS when available, otherwise fallback to case-insensitive LIKE
    if (req.query.q) {
      if (!useLibsql) {
        if (!ftsHasBm25) {
          // Use FTS index when running on local SQLite (simple path)
          conditions.push(
            "id IN (SELECT rowid FROM expenses_fts WHERE expenses_fts MATCH ?)",
          );
          params.push(String(req.query.q));
        }
        // If bm25 is available we'll route to a different query path below that joins against the FTS table
      } else {
        const q = String(req.query.q).toLowerCase();
        conditions.push(
          "(LOWER(description) LIKE ? OR LOWER(recipient) LIKE ?)",
        );
        params.push(`%${q}%`, `%${q}%`);
      }
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Handle pagination
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize) || 0, 0), 100);
    const pageNum = Math.max(parseInt(page) || 0, 0);

    // If bm25 is available and a search term was provided, use an optimized JOIN query
    if (req.query.q && !useLibsql && ftsHasBm25) {
      const rawQ = String(req.query.q || "").trim();
      const tokens = rawQ
        .split(/\s+/)
        .map((t) => escapeForFts(t))
        .filter(Boolean);
      const qMode = String(req.query.qMode || "any").toLowerCase();

      // Build per-field FTS match expression (search across description and recipient by default)
      const fields = ["description", "recipient"];
      const perFieldExpr = fields
        .map((f) => {
          if (qMode === "phrase") return `${f}:"${escapeForFts(rawQ)}"`;
          if (qMode === "prefix")
            return tokens.map((t) => `${f}:${t}*`).join(" OR ");
          if (qMode === "all")
            return tokens.map((t) => `${f}:${t}`).join(" AND ");
          return tokens.map((t) => `${f}:${t}`).join(" OR ");
        })
        .filter(Boolean);

      const matchExpr = perFieldExpr.join(" OR ");

      // Rebuild base WHERE conditions excluding the FTS id-IN subquery
      const baseConds = ["e.user_id = ?", "e.deleted_at IS NULL"];
      const baseParams = [req.user.userId];
      if (sessionTermValue) {
        baseConds.push("e.session_term = ?");
        baseParams.push(sessionTermValue);
      }
      if (category) {
        baseConds.push("e.category = ?");
        baseParams.push(category);
      }
      if (status) {
        baseConds.push("e.status = ?");
        baseParams.push(status);
      }
      if (startDate) {
        baseConds.push("e.date_time >= ?");
        baseParams.push(formatDateTimeBoundary(startDate, "start"));
      }
      if (endDate) {
        baseConds.push("e.date_time <= ?");
        baseParams.push(formatDateTimeBoundary(endDate, "end"));
      }

      const baseWhere = baseConds.length
        ? `WHERE ${baseConds.join(" AND ")}`
        : "";

      // Use bm25 for relevance and order by relevance (ascending is typically more relevant in some builds)
      let sql = `SELECT e.*, bm25(f) AS relevance FROM expenses e JOIN expenses_fts f ON f.rowid = e.id ${baseWhere} AND f MATCH ? ORDER BY relevance ASC, e.date_time DESC`;

      if (pageSizeNum > 0 && pageNum > 0) {
        const offset = Math.max((pageNum - 1) * pageSizeNum, 0);
        sql += ` LIMIT ${pageSizeNum} OFFSET ${offset}`;
        const expenses = await dbAll(sql, [...baseParams, matchExpr]);
        return res.json({
          items: expenses,
          hasMore: expenses.length === pageSizeNum,
        });
      }

      const expenses = await dbAll(sql, [...baseParams, matchExpr]);
      return res.json(expenses);
    }

    // Determine sort order (sortBy overrides default)
    const SAFE_SORT_MAP = {
      date_desc: "date_time DESC",
      date_asc: "date_time ASC",
      amount_desc: "(amount_paid + balance_due) DESC",
      amount_asc: "(amount_paid + balance_due) ASC",
      category: "category ASC, date_time DESC",
    };
    const defaultSort = SAFE_SORT_MAP[sortBy] || "date_time DESC";

    // Fallback ordering when no bm25 available: preserve date ordering and previously applied simple heuristics
    let orderClause = `ORDER BY ${defaultSort}`;
    if (req.query.q && !useLibsql) {
      // Prioritize rows where description matches, then recipient, then others (simple heuristic)
      orderClause = `ORDER BY (CASE WHEN id IN (SELECT rowid FROM expenses_fts WHERE description MATCH ?) THEN 0 WHEN id IN (SELECT rowid FROM expenses_fts WHERE recipient MATCH ?) THEN 1 ELSE 2 END), date_time DESC`;
      const rawQ2 = String(req.query.q || "").trim();
      const tokens2 = rawQ2
        .split(/\s+/)
        .map((t) => escapeForFts(t))
        .filter(Boolean);
      const qMode2 = String(req.query.qMode || "any").toLowerCase();
      let descExpr = "";
      let recipExpr = "";
      if (qMode2 === "phrase") {
        descExpr = `description:"${escapeForFts(rawQ2)}"`;
        recipExpr = `recipient:"${escapeForFts(rawQ2)}"`;
      } else if (qMode2 === "prefix") {
        descExpr = tokens2.map((t) => `description:${t}*`).join(" OR ");
        recipExpr = tokens2.map((t) => `recipient:${t}*`).join(" OR ");
      } else if (qMode2 === "all") {
        descExpr = tokens2.map((t) => `description:${t}`).join(" AND ");
        recipExpr = tokens2.map((t) => `recipient:${t}`).join(" AND ");
      } else {
        descExpr = tokens2.map((t) => `description:${t}`).join(" OR ");
        recipExpr = tokens2.map((t) => `recipient:${t}`).join(" OR ");
      }
      params.push(descExpr);
      params.push(recipExpr);
    }

    let sql = `SELECT * FROM expenses ${whereClause} ${orderClause}`;

    if (pageSizeNum > 0 && pageNum > 0) {
      const offset = Math.max((pageNum - 1) * pageSizeNum, 0);
      sql += ` LIMIT ${pageSizeNum} OFFSET ${offset}`;
      const expenses = await dbAll(sql, params);
      return res.json({
        items: expenses,
        hasMore: expenses.length === pageSizeNum,
      });
    }

    const expenses = await dbAll(sql, params);
    res.json(expenses);
  } catch (error) {
    console.error("Get expenses error:", error);
    res
      .status(500)
      .json({ error: "Unable to fetch expenses. Please try again." });
  }
});

// Count expenses (for pagination)
app.get("/api/expenses/count", authenticateToken, async (req, res) => {
  try {
    const { session_term, term, category, status, startDate, endDate, minAmount, maxAmount } =
      req.query;
    const conditions = ["user_id = ?", "deleted_at IS NULL"];
    const params = [req.user.userId];

    const sessionTermValue = session_term || term;
    if (sessionTermValue) {
      conditions.push("session_term = ?");
      params.push(sessionTermValue);
    }

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    if (startDate) {
      conditions.push("date_time >= ?");
      params.push(formatDateTimeBoundary(startDate, "start"));
    }

    if (endDate) {
      conditions.push("date_time <= ?");
      params.push(formatDateTimeBoundary(endDate, "end"));
    }

    if (minAmount) {
      const min = parseFloat(minAmount);
      if (!isNaN(min)) {
        conditions.push("(amount_paid + balance_due) >= ?");
        params.push(min);
      }
    }

    if (maxAmount) {
      const max = parseFloat(maxAmount);
      if (!isNaN(max)) {
        conditions.push("(amount_paid + balance_due) <= ?");
        params.push(max);
      }
    }

    // Text search — mirror the same logic used in GET /api/expenses
    if (req.query.q) {
      if (!useLibsql) {
        const rawQ = String(req.query.q || "").trim();
        const qMode = String(req.query.qMode || "any").toLowerCase();
        const tokens = rawQ.split(/\s+/).map((t) => escapeForFts(t)).filter(Boolean);
        const fields = ["description", "recipient"];
        const perFieldExpr = fields.map((f) => {
          if (qMode === "phrase") return `${f}:"${escapeForFts(rawQ)}"`;
          if (qMode === "prefix") return tokens.map((t) => `${f}:${t}*`).join(" OR ");
          if (qMode === "all") return tokens.map((t) => `${f}:${t}`).join(" AND ");
          return tokens.map((t) => `${f}:${t}`).join(" OR ");
        }).filter(Boolean);
        const matchExpr = perFieldExpr.join(" OR ");
        if (matchExpr) {
          conditions.push("id IN (SELECT rowid FROM expenses_fts WHERE expenses_fts MATCH ?)");
          params.push(matchExpr);
        }
      } else {
        const q = String(req.query.q).toLowerCase();
        conditions.push("(LOWER(description) LIKE ? OR LOWER(recipient) LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const sql = `SELECT COUNT(*) as total FROM expenses ${whereClause}`;
    const result = await dbAll(sql, params);
    res.json({ total: result[0].total });
  } catch (error) {
    console.error("Count expenses error:", error);
    res.status(500).json({ error: "Unable to count expenses." });
  }
});

app.post("/api/expenses", authenticateToken, async (req, res) => {
  try {
    const {
      date_time,
      category,
      session_term,
      recipient,
      description,
      amount_paid,
      balance_due,
      due_date,
    } = req.body;

    // Validation
    if (!date_time || !category || !recipient || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (typeof category !== "string" || category.trim().length > 100) {
      return res.status(400).json({ error: "Category must be 1-100 characters" });
    }
    if (typeof recipient !== "string" || recipient.trim().length > 200) {
      return res.status(400).json({ error: "Recipient must be 1-200 characters" });
    }
    if (typeof description !== "string" || description.trim().length > 500) {
      return res.status(400).json({ error: "Description must be 1-500 characters" });
    }

    const amountPaid = parseFloat(amount_paid);
    const balanceDue = parseFloat(balance_due) || 0;

    if (isNaN(amountPaid) || amountPaid < 0) {
      return res
        .status(400)
        .json({ error: "Amount paid must be a positive number" });
    }

    if (balanceDue < 0) {
      return res.status(400).json({ error: "Balance due cannot be negative" });
    }

    const status = balanceDue > 0 ? "Partial" : "Paid";
    const dueDate = due_date && String(due_date).trim() ? String(due_date).trim() : null;

    const result = await dbRun(
      `INSERT INTO expenses (user_id, date_time, category, session_term, recipient, description, amount_paid, balance_due, status, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.userId,
        date_time,
        category,
        session_term,
        recipient,
        description,
        amountPaid,
        balanceDue,
        status,
        dueDate,
      ],
    );

    const newExpense = await dbAll("SELECT * FROM expenses WHERE id = ?", [
      result.id,
    ]);
    res.json({ message: "Expense added successfully", expense: newExpense[0] });
  } catch (error) {
    console.error("Add expense error:", error);
    const message =
      error.code === "SQLITE_CONSTRAINT"
        ? "Invalid data provided"
        : "Unable to save expense. Please try again.";
    res.status(500).json({ error: message });
  }
});

app.put("/api/expenses/:id", authenticateToken, async (req, res) => {
  try {
    const {
      date_time,
      category,
      session_term,
      recipient,
      description,
      amount_paid,
      balance_due,
      due_date,
    } = req.body;

    // Validation
    const amountPaid = parseFloat(amount_paid);
    const balanceDue = parseFloat(balance_due) || 0;

    if (!date_time || !category || !recipient || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (isNaN(amountPaid) || amountPaid < 0 || balanceDue < 0) {
      return res.status(400).json({ error: "Invalid amount values" });
    }

    const status = balanceDue > 0 ? "Partial" : "Paid";
    const dueDate = due_date && String(due_date).trim() ? String(due_date).trim() : null;

    await dbRun(
      `UPDATE expenses SET date_time = ?, category = ?, session_term = ?, recipient = ?,
             description = ?, amount_paid = ?, balance_due = ?, status = ?, due_date = ? WHERE id = ? AND user_id = ?`,
      [
        date_time,
        category,
        session_term,
        recipient,
        description,
        amountPaid,
        balanceDue,
        status,
        dueDate,
        req.params.id,
        req.user.userId,
      ],
    );

    res.json({ message: "Expense updated successfully" });
  } catch (error) {
    console.error("Update expense error:", error);
    res
      .status(500)
      .json({ error: "Unable to update expense. Please try again." });
  }
});

app.delete("/api/expenses/:id", authenticateToken, async (req, res) => {
  try {
    await dbRun(
      "UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Expense deleted successfully" });
  } catch (error) {
    console.error("Delete expense error:", error);
    res
      .status(500)
      .json({ error: "Unable to delete expense. Please try again." });
  }
});

// Trash: list soft-deleted expenses
app.get("/api/expenses/trash", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM expenses WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
      [req.user.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error("Get trash error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Restore a soft-deleted expense
app.post("/api/expenses/:id/restore", authenticateToken, async (req, res) => {
  try {
    await dbRun(
      "UPDATE expenses SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Expense restored successfully" });
  } catch (error) {
    console.error("Restore expense error:", error);
    res.status(500).json({ error: "Unable to restore expense. Please try again." });
  }
});

// Permanently delete a soft-deleted expense
app.delete("/api/expenses/:id/permanent", authenticateToken, async (req, res) => {
  try {
    await dbRun(
      "DELETE FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Expense permanently deleted" });
  } catch (error) {
    console.error("Permanent delete error:", error);
    res.status(500).json({ error: "Unable to permanently delete expense. Please try again." });
  }
});

app.post(
  "/api/expenses/:id/receipt",
  authenticateToken,
  uploadReceiptMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const rows = await dbAll(
        "SELECT id, receipt_path FROM expenses WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.userId],
      );
      if (!rows.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: "Expense not found" });
      }
      if (rows[0].receipt_path) {
        fs.unlink(path.join(uploadsDir, rows[0].receipt_path), () => {});
      }
      await dbRun(
        "UPDATE expenses SET receipt_path = ? WHERE id = ? AND user_id = ?",
        [req.file.filename, req.params.id, req.user.userId],
      );
      res.json({ message: "Receipt uploaded successfully", receipt_path: req.file.filename });
    } catch (error) {
      console.error("Upload receipt error:", error);
      res.status(500).json({ error: "Unable to upload receipt" });
    }
  },
);

app.get("/api/expenses/:id/receipt", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT receipt_path FROM expenses WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    if (!rows.length || !rows[0].receipt_path) {
      return res.status(404).json({ error: "No receipt on file" });
    }
    const filePath = path.join(uploadsDir, rows[0].receipt_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Receipt file missing" });
    }
    res.sendFile(filePath);
  } catch (error) {
    console.error("Get receipt error:", error);
    res.status(500).json({ error: "Unable to retrieve receipt" });
  }
});

app.delete("/api/expenses/:id/receipt", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT receipt_path FROM expenses WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Expense not found" });
    }
    if (rows[0].receipt_path) {
      fs.unlink(path.join(uploadsDir, rows[0].receipt_path), () => {});
    }
    await dbRun(
      "UPDATE expenses SET receipt_path = NULL WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Receipt removed" });
  } catch (error) {
    console.error("Delete receipt error:", error);
    res.status(500).json({ error: "Unable to remove receipt" });
  }
});

// Blog posts routes
app.get("/api/blog-posts", authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 0, 0), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const totalRows = await dbAll(
      "SELECT COUNT(*) as count FROM blog_posts WHERE user_id = ?",
      [req.user.userId],
    );
    const total = Number(totalRows[0]?.count) || 0;

    const summaryOnly = String(req.query.fields || "").toLowerCase() === "summary";
    const params = [req.user.userId];
    let sql = summaryOnly
      ? `SELECT id, date_time, category, title,
                substr(content, 1, 180) as excerpt,
                length(content) as content_length
         FROM blog_posts WHERE user_id = ? ORDER BY date_time DESC`
      : "SELECT * FROM blog_posts WHERE user_id = ? ORDER BY date_time DESC";
    if (limit > 0) {
      sql += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    }

    const posts = await dbAll(sql, params);

    if (limit > 0) {
      res.json({ posts, total, hasMore: offset + posts.length < total });
    } else {
      res.json(posts); // backward-compatible: no limit → return plain array
    }
  } catch (error) {
    console.error("Get blog posts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/blog-posts", authenticateToken, async (req, res) => {
  try {
    const { date_time, category, title, content } = req.body;

    if (!date_time || !category || !title || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (typeof title !== "string" || title.trim().length > 200) {
      return res.status(400).json({ error: "Title must be 1-200 characters" });
    }
    if (typeof content !== "string" || content.length > 50000) {
      return res.status(400).json({ error: "Content too long (max 50,000 characters)" });
    }

    const result = await dbRun(
      "INSERT INTO blog_posts (user_id, date_time, category, title, content) VALUES (?, ?, ?, ?, ?)",
      [req.user.userId, date_time, category, title, content],
    );

    const newPost = await dbAll("SELECT * FROM blog_posts WHERE id = ?", [
      result.id,
    ]);
    res.json({ message: "Blog post created successfully", post: newPost[0] });
  } catch (error) {
    console.error("Add blog post error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/blog-posts/:id", authenticateToken, async (req, res) => {
  try {
    const { date_time, category, title, content } = req.body;

    await dbRun(
      "UPDATE blog_posts SET date_time = ?, category = ?, title = ?, content = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      [date_time, category, title, content, req.params.id, req.user.userId],
    );

    res.json({ message: "Blog post updated successfully" });
  } catch (error) {
    console.error("Update blog post error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/blog-posts/:id", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM blog_posts WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Blog post not found" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Get blog post error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/blog-posts/:id", authenticateToken, async (req, res) => {
  try {
    await dbRun("DELETE FROM blog_posts WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.user.userId,
    ]);
    res.json({ message: "Blog post deleted successfully" });
  } catch (error) {
    console.error("Delete blog post error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Dashboard statistics
app.get("/api/reports", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, category, status } = req.query;
    const conditions = ["user_id = ?", "deleted_at IS NULL"];
    const params = [req.user.userId];

    if (startDate) {
      conditions.push("date_time >= ?");
      params.push(formatDateTimeBoundary(startDate, "start"));
    }
    if (endDate) {
      conditions.push("date_time <= ?");
      params.push(formatDateTimeBoundary(endDate, "end"));
    }
    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;

    const stats = await dbAll(
      `SELECT
                COUNT(*) as total_expenses,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance,
                SUM(amount_paid + balance_due) as total_cost
             FROM expenses ${where}`,
      params,
    );

    const byCategory = await dbAll(
      `SELECT category, COUNT(*) as count, SUM(amount_paid) as total_paid, SUM(balance_due) as total_balance
             FROM expenses ${where} GROUP BY category ORDER BY category`,
      params,
    );

    const byStatus = await dbAll(
      `SELECT status, COUNT(*) as count, SUM(amount_paid) as total_paid, SUM(balance_due) as total_balance
             FROM expenses ${where} GROUP BY status ORDER BY status`,
      params,
    );

    const byMonth = await dbAll(
      `SELECT strftime('%Y-%m', date_time) as month, COUNT(*) as count, SUM(amount_paid) as total_paid, SUM(balance_due) as total_balance
             FROM expenses ${where} GROUP BY strftime('%Y-%m', date_time) ORDER BY month ASC`,
      params,
    );

    const transactions = await dbAll(
      `SELECT id, date_time, category, recipient, description, amount_paid, balance_due, status
             FROM expenses ${where} ORDER BY date_time DESC LIMIT 1000`,
      params,
    );

    res.json({
      statistics: stats[0] || { total_expenses: 0, total_paid: 0, total_balance: 0, total_cost: 0 },
      byCategory,
      byStatus,
      byMonth,
      transactions,
    });
  } catch (error) {
    console.error("Reports error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/dashboard", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateConditions = ["user_id = ?", "deleted_at IS NULL"];
    const dateParams = [req.user.userId];

    if (startDate) {
      dateConditions.push("date_time >= ?");
      dateParams.push(formatDateTimeBoundary(startDate, "start"));
    }
    if (endDate) {
      dateConditions.push("date_time <= ?");
      dateParams.push(formatDateTimeBoundary(endDate, "end"));
    }
    const dateWhere = `WHERE ${dateConditions.join(" AND ")}`;

    const stats = await dbAll(
      `SELECT
                COUNT(*) as total_expenses,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance,
                SUM(amount_paid + balance_due) as total_cost
             FROM expenses ${dateWhere}`,
      dateParams,
    );

    const categories = await dbAll(
      `SELECT
                category,
                COUNT(*) as count,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance
             FROM expenses ${dateWhere} GROUP BY category`,
      dateParams,
    );

    const monthlySeries = await dbAll(
      `SELECT
                strftime('%Y-%m', date_time) as month,
                SUM(amount_paid) as paid,
                SUM(balance_due) as balance
             FROM expenses ${dateWhere}
             GROUP BY strftime('%Y-%m', date_time)
             ORDER BY month ASC`,
      dateParams,
    );

    const budgets = await dbAll(
      `SELECT category, threshold FROM budget_limits WHERE user_id = ?`,
      [req.user.userId],
    );

    const budgetMap = budgets.reduce((acc, item) => {
      acc[item.category] = item.threshold;
      return acc;
    }, {});

    const alerts = categories
      .map((cat) => {
        const threshold = budgetMap[cat.category];
        if (threshold == null) return null;
        const total =
          (Number(cat.total_paid) || 0) + (Number(cat.total_balance) || 0);
        if (total <= threshold) return null;
        return {
          category: cat.category,
          threshold,
          total,
        };
      })
      .filter(Boolean);

    // Payment-due reminders: global (not scoped to the dashboard's date range),
    // since "what do I still owe and when" isn't tied to the currently viewed period.
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const overdue = await dbAll(
      `SELECT id, category, recipient, description, balance_due, due_date
             FROM expenses
            WHERE user_id = ? AND deleted_at IS NULL AND balance_due > 0
              AND due_date IS NOT NULL AND due_date < ?
            ORDER BY due_date ASC`,
      [req.user.userId, today],
    );

    const dueSoon = await dbAll(
      `SELECT id, category, recipient, description, balance_due, due_date
             FROM expenses
            WHERE user_id = ? AND deleted_at IS NULL AND balance_due > 0
              AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?
            ORDER BY due_date ASC`,
      [req.user.userId, today, sevenDaysOut],
    );

    res.json({
      statistics: stats[0] || {
        total_expenses: 0,
        total_paid: 0,
        total_balance: 0,
        total_cost: 0,
      },
      categories,
      monthlySeries: monthlySeries || [],
      budgets,
      alerts,
      overdue,
      dueSoon,
      storageMode,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + "T00:00:00Z");
  switch (frequency) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

// Generates due expenses from active recurring templates. Runs at startup and every 24h.
async function generateDueRecurringExpenses() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const dueTemplates = await dbAll(
      `SELECT * FROM recurring_templates WHERE active = 1 AND next_run_date <= ?`,
      [today],
    );

    for (const tpl of dueTemplates) {
      let nextRun = tpl.next_run_date;
      let iterations = 0;
      // Catch up if the server was down across one or more occurrences, capped to avoid runaway loops.
      while (nextRun <= today && iterations < 12) {
        const status = Number(tpl.balance_due) > 0 ? "Partial" : "Paid";
        await dbRun(
          `INSERT INTO expenses (user_id, date_time, category, session_term, recipient, description, amount_paid, balance_due, status, recurring_template_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tpl.user_id,
            `${nextRun} 09:00`,
            tpl.category,
            tpl.session_term,
            tpl.recipient,
            tpl.description,
            tpl.amount_paid,
            tpl.balance_due,
            status,
            tpl.id,
          ],
        );
        nextRun = advanceDate(nextRun, tpl.frequency);
        iterations += 1;
      }
      await dbRun(
        `UPDATE recurring_templates SET next_run_date = ?, last_generated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextRun, tpl.id],
      );
    }
    if (dueTemplates.length) {
      console.log(`Recurring: generated occurrences for ${dueTemplates.length} template(s).`);
    }
  } catch (error) {
    console.error("Recurring generation error:", error);
  }
}

app.get("/api/recurring", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM recurring_templates WHERE user_id = ? ORDER BY next_run_date ASC",
      [req.user.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error("Get recurring templates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/recurring", authenticateToken, async (req, res) => {
  try {
    const {
      category,
      session_term,
      recipient,
      description,
      amount_paid,
      balance_due,
      frequency,
      start_date,
    } = req.body;

    if (!category || !recipient || !description || !start_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!RECURRING_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: "Invalid frequency" });
    }
    const amountPaid = parseFloat(amount_paid);
    const balanceDue = parseFloat(balance_due) || 0;
    if (isNaN(amountPaid) || amountPaid < 0 || balanceDue < 0) {
      return res.status(400).json({ error: "Invalid amount values" });
    }

    const result = await dbRun(
      `INSERT INTO recurring_templates (user_id, category, session_term, recipient, description, amount_paid, balance_due, frequency, next_run_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.userId,
        category,
        session_term,
        recipient,
        description,
        amountPaid,
        balanceDue,
        frequency,
        start_date,
      ],
    );

    const newTpl = await dbAll("SELECT * FROM recurring_templates WHERE id = ?", [result.id]);
    res.json({ message: "Recurring expense created", template: newTpl[0] });
  } catch (error) {
    console.error("Create recurring template error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/recurring/:id", authenticateToken, async (req, res) => {
  try {
    const { category, session_term, recipient, description, amount_paid, balance_due, frequency, active } = req.body;

    const updates = [];
    const params = [];
    if (category != null) { updates.push("category = ?"); params.push(category); }
    if (session_term != null) { updates.push("session_term = ?"); params.push(session_term); }
    if (recipient != null) { updates.push("recipient = ?"); params.push(recipient); }
    if (description != null) { updates.push("description = ?"); params.push(description); }
    if (amount_paid != null) { updates.push("amount_paid = ?"); params.push(parseFloat(amount_paid) || 0); }
    if (balance_due != null) { updates.push("balance_due = ?"); params.push(parseFloat(balance_due) || 0); }
    if (frequency != null) {
      if (!RECURRING_FREQUENCIES.includes(frequency)) {
        return res.status(400).json({ error: "Invalid frequency" });
      }
      updates.push("frequency = ?");
      params.push(frequency);
    }
    if (active != null) { updates.push("active = ?"); params.push(active ? 1 : 0); }

    if (!updates.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(req.params.id, req.user.userId);
    await dbRun(
      `UPDATE recurring_templates SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      params,
    );

    res.json({ message: "Recurring expense updated" });
  } catch (error) {
    console.error("Update recurring template error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/recurring/:id", authenticateToken, async (req, res) => {
  try {
    await dbRun(
      "DELETE FROM recurring_templates WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Recurring expense deleted" });
  } catch (error) {
    console.error("Delete recurring template error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PURCHASE_PRIORITIES = ["Low", "Medium", "High"];

app.get("/api/purchases", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM purchases WHERE user_id = ? ORDER BY CASE status WHEN 'Planned' THEN 0 ELSE 1 END, target_date IS NULL, target_date ASC",
      [req.user.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error("Get purchases error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Purchase reports — separate from expense /api/reports
app.get("/api/purchases/reports", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, category, status } = req.query;
    const conditions = ["user_id = ?"];
    const params = [req.user.userId];

    if (startDate) {
      conditions.push("(target_date IS NULL OR target_date >= ?)");
      params.push(startDate);
    }
    if (endDate) {
      conditions.push("(target_date IS NULL OR target_date <= ?)");
      params.push(endDate);
    }
    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;

    const stats = await dbAll(
      `SELECT
                COUNT(*) as total_purchases,
                COALESCE(SUM(estimated_cost), 0) as total_estimated,
                COALESCE(SUM(CASE WHEN status = 'Planned' THEN 1 ELSE 0 END), 0) as planned_count,
                COALESCE(SUM(CASE WHEN status = 'Purchased' THEN 1 ELSE 0 END), 0) as purchased_count
             FROM purchases ${where}`,
      params,
    );

    const byCategory = await dbAll(
      `SELECT category, COUNT(*) as count, SUM(estimated_cost) as total_estimated
             FROM purchases ${where} GROUP BY category ORDER BY category`,
      params,
    );

    const byStatus = await dbAll(
      `SELECT status, COUNT(*) as count, SUM(estimated_cost) as total_estimated
             FROM purchases ${where} GROUP BY status ORDER BY status`,
      params,
    );

    const items = await dbAll(
      `SELECT id, item, category, estimated_cost, priority, target_date, status, notes, receipt_path
             FROM purchases ${where}
             ORDER BY CASE status WHEN 'Planned' THEN 0 ELSE 1 END, target_date IS NULL, target_date ASC
             LIMIT 1000`,
      params,
    );

    res.json({
      statistics: stats[0] || {
        total_purchases: 0,
        total_estimated: 0,
        planned_count: 0,
        purchased_count: 0,
      },
      byCategory,
      byStatus,
      items,
    });
  } catch (error) {
    console.error("Purchase reports error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/purchases", authenticateToken, async (req, res) => {
  try {
    const { item, category, estimated_cost, priority, target_date, notes } = req.body;
    if (!item || estimated_cost == null) {
      return res.status(400).json({ error: "Item and estimated cost are required" });
    }
    const cost = parseFloat(estimated_cost);
    if (isNaN(cost) || cost < 0) {
      return res.status(400).json({ error: "Estimated cost must be a positive number" });
    }
    const finalPriority = PURCHASE_PRIORITIES.includes(priority) ? priority : "Medium";

    const result = await dbRun(
      `INSERT INTO purchases (user_id, item, category, estimated_cost, priority, target_date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.userId, item, category || null, cost, finalPriority, target_date || null, notes || null],
    );

    const newRow = await dbAll("SELECT * FROM purchases WHERE id = ?", [result.id]);
    res.json({ message: "Purchase added", purchase: newRow[0] });
  } catch (error) {
    console.error("Create purchase error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/purchases/:id", authenticateToken, async (req, res) => {
  try {
    const { item, category, estimated_cost, priority, target_date, notes, status } = req.body;
    const updates = [];
    const params = [];
    if (item != null) { updates.push("item = ?"); params.push(item); }
    if (Object.prototype.hasOwnProperty.call(req.body, "category")) {
      updates.push("category = ?");
      params.push(category || null);
    }
    if (estimated_cost != null) {
      const cost = parseFloat(estimated_cost);
      if (isNaN(cost) || cost < 0) {
        return res.status(400).json({ error: "Estimated cost must be a positive number" });
      }
      updates.push("estimated_cost = ?"); params.push(cost);
    }
    if (priority != null) {
      if (!PURCHASE_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: "Invalid priority" });
      }
      updates.push("priority = ?"); params.push(priority);
    }
    if (target_date != null) { updates.push("target_date = ?"); params.push(target_date); }
    if (notes != null) { updates.push("notes = ?"); params.push(notes); }
    if (status != null) { updates.push("status = ?"); params.push(status); }

    if (!updates.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(req.params.id, req.user.userId);
    await dbRun(
      `UPDATE purchases SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      params,
    );
    res.json({ message: "Purchase updated" });
  } catch (error) {
    console.error("Update purchase error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/purchases/:id", authenticateToken, async (req, res) => {
  try {
    await dbRun(
      "DELETE FROM purchases WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Purchase deleted" });
  } catch (error) {
    console.error("Delete purchase error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/purchases/:id/receipt", authenticateToken, async (req, res) => {
  // Prefer JSON base64 (same path used in production through Hosting rewrites).
  // Fall back to multipart via multer when Content-Type is multipart/form-data.
  try {
    const ct = String(req.headers["content-type"] || "");
    if (ct.includes("application/json") && req.body && req.body.contentBase64) {
      const contentType = req.body.contentType;
      if (!RECEIPT_MIME_EXT[contentType]) {
        return res.status(400).json({
          error: "Only JPEG, PNG, WEBP, GIF images or PDF files are allowed",
        });
      }
      const buffer = Buffer.from(String(req.body.contentBase64), "base64");
      if (!buffer.length) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "File must be 5 MB or smaller" });
      }
      const rows = await dbAll(
        "SELECT id, receipt_path FROM purchases WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.userId],
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Purchase not found" });
      }
      if (rows[0].receipt_path) {
        fs.unlink(path.join(uploadsDir, rows[0].receipt_path), () => {});
      }
      const ext = RECEIPT_MIME_EXT[contentType] || "";
      const filename = `purchase-${req.user.userId}-${req.params.id}-${Date.now()}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), buffer);
      await dbRun(
        "UPDATE purchases SET receipt_path = ? WHERE id = ? AND user_id = ?",
        [filename, req.params.id, req.user.userId],
      );
      return res.json({
        message: "Receipt uploaded successfully",
        receipt_path: filename,
      });
    }

    // Multipart fallback for local tooling / older clients
    return uploadPurchaseReceiptMiddleware(req, res, async () => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }
        const rows = await dbAll(
          "SELECT id, receipt_path FROM purchases WHERE id = ? AND user_id = ?",
          [req.params.id, req.user.userId],
        );
        if (!rows.length) {
          fs.unlink(req.file.path, () => {});
          return res.status(404).json({ error: "Purchase not found" });
        }
        if (rows[0].receipt_path) {
          fs.unlink(path.join(uploadsDir, rows[0].receipt_path), () => {});
        }
        await dbRun(
          "UPDATE purchases SET receipt_path = ? WHERE id = ? AND user_id = ?",
          [req.file.filename, req.params.id, req.user.userId],
        );
        return res.json({
          message: "Receipt uploaded successfully",
          receipt_path: req.file.filename,
        });
      } catch (error) {
        console.error("Upload purchase receipt error:", error);
        res.status(500).json({ error: "Unable to upload receipt" });
      }
    });
  } catch (error) {
    console.error("Upload purchase receipt error:", error);
    res.status(500).json({ error: "Unable to upload receipt" });
  }
});

app.get("/api/purchases/:id/receipt", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT receipt_path FROM purchases WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    if (!rows.length || !rows[0].receipt_path) {
      return res.status(404).json({ error: "No receipt on file" });
    }
    const filePath = path.join(uploadsDir, rows[0].receipt_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Receipt file missing" });
    }
    res.sendFile(filePath);
  } catch (error) {
    console.error("Get purchase receipt error:", error);
    res.status(500).json({ error: "Unable to retrieve receipt" });
  }
});

app.delete("/api/purchases/:id/receipt", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT receipt_path FROM purchases WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Purchase not found" });
    }
    if (rows[0].receipt_path) {
      fs.unlink(path.join(uploadsDir, rows[0].receipt_path), () => {});
    }
    await dbRun(
      "UPDATE purchases SET receipt_path = NULL WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    res.json({ message: "Receipt removed" });
  } catch (error) {
    console.error("Delete purchase receipt error:", error);
    res.status(500).json({ error: "Unable to remove receipt" });
  }
});

// Convert a planned purchase into a real expense record.
app.post("/api/purchases/:id/convert", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM purchases WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Purchase not found" });
    }
    const purchase = rows[0];
    if (purchase.status === "Purchased") {
      return res.status(400).json({ error: "Purchase has already been converted" });
    }

    const amountPaid = parseFloat(req.body.amount_paid);
    const balanceDue = parseFloat(req.body.balance_due) || 0;
    if (isNaN(amountPaid) || amountPaid < 0 || balanceDue < 0) {
      return res.status(400).json({ error: "Invalid amount values" });
    }
    const status = balanceDue > 0 ? "Partial" : "Paid";
    const dateTime = req.body.date_time || new Date().toISOString().slice(0, 16).replace("T", " ");

    // Receipts stay on the purchase record only — expenses no longer carry receipts.
    const expenseResult = await dbRun(
      `INSERT INTO expenses (user_id, date_time, category, recipient, description, amount_paid, balance_due, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.userId,
        dateTime,
        purchase.category || "Uncategorized",
        purchase.item,
        `Purchased: ${purchase.item}`,
        amountPaid,
        balanceDue,
        status,
      ],
    );

    await dbRun(
      "UPDATE purchases SET status = 'Purchased', linked_expense_id = ? WHERE id = ? AND user_id = ?",
      [expenseResult.id, req.params.id, req.user.userId],
    );

    res.json({ message: "Purchase converted to expense", expense_id: expenseResult.id });
  } catch (error) {
    console.error("Convert purchase error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/budgets", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT category, threshold FROM budget_limits WHERE user_id = ? ORDER BY category",
      [req.user.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error("Get budgets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/budgets", authenticateToken, async (req, res) => {
  try {
    const { category, threshold } = req.body;

    if (!category || typeof threshold !== "number" || threshold < 0) {
      return res
        .status(400)
        .json({ error: "Category and non-negative threshold required" });
    }

    await dbRun(
      `INSERT INTO budget_limits (user_id, category, threshold)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id, category) DO UPDATE SET
                threshold = excluded.threshold,
                updated_at = CURRENT_TIMESTAMP`,
      [req.user.userId, category, threshold],
    );

    res.json({ message: "Budget updated successfully" });
  } catch (error) {
    console.error("Upsert budget error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/budgets/:category", authenticateToken, async (req, res) => {
  try {
    const category = req.params.category;
    await dbRun(
      "DELETE FROM budget_limits WHERE user_id = ? AND category = ?",
      [req.user.userId, category],
    );
    res.json({ message: "Budget removed successfully" });
  } catch (error) {
    console.error("Delete budget error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Change password (native JWT users only)
app.put("/api/users/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both current and new password are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: "New password must be 8-128 characters" });
    }

    const users = await dbAll("SELECT * FROM users WHERE id = ?", [req.user.userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = users[0];
    if (!user.password_hash) {
      return res.status(400).json({ error: "Password change not supported for this account type" });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, req.user.userId]);
    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Refresh JWT token (native JWT users only)
app.post("/api/auth/refresh", authenticateToken, async (req, res) => {
  try {
    const users = await dbAll("SELECT id, username FROM users WHERE id = ?", [req.user.userId]);
    if (users.length === 0) {
      return res.status(403).json({ error: "User no longer exists" });
    }
    const user = users[0];
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" },
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint for debugging
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server running on http://localhost:${PORT} (bound to 0.0.0.0 for network access)`,
  );
  if (useLibsql) {
    console.log(`Using LibSQL database: ${process.env.LIBSQL_URL}`);
  } else {
    console.log(`Using SQLite database: ${dbPath}`);
  }
});
