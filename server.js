const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

let sqlite3;
let createClient;

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-here-change-this-in-production";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Database setup (LibSQL/Turso first, fallback to local SQLite)
const useLibsql = Boolean(process.env.LIBSQL_URL);
const storageMode = useLibsql ? "libsql" : "sqlite";
const dbPath =
  process.env.NODE_ENV === "production"
    ? "/tmp/expense_tracker.db"
    : "./expense_tracker.db";
let db;
let ftsHasBm25 = false;

// Development auth toggle: set DISABLE_AUTH=1 to disable auth checks globally.
// Additionally, when not in production we expose small routes to enable/disable auth at runtime:
const devAuthFromEnv = process.env.DISABLE_AUTH === "1";
let devAuthDisabled =
  Boolean(devAuthFromEnv) || process.env.NODE_ENV !== "production";

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
      initializeDatabase().catch((initErr) => {
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
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    // Check if user exists
    const existingUser = await dbAll(
      "SELECT id FROM users WHERE username = ?",
      [username],
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await dbRun(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash],
    );

    // Generate token
    const token = jwt.sign({ userId: result.id, username }, JWT_SECRET, {
      expiresIn: "24h",
    });

    res.json({
      message: "User created successfully",
      token,
      user: { id: result.id, username },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
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
      pageSize,
      page,
      cursor,
    } = req.query;
    const conditions = ["user_id = ?"];
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
        const escapeForFts = (s) => s.replace(/"/g, "");
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
      const escapeForFts = (s) => s.replace(/"/g, "");
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
      const baseConds = ["e.user_id = ?"];
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

    // Fallback ordering when no bm25 available: preserve date ordering and previously applied simple heuristics
    let orderClause = "ORDER BY date_time DESC";
    if (req.query.q && !useLibsql) {
      // Prioritize rows where description matches, then recipient, then others (simple heuristic)
      orderClause = `ORDER BY (CASE WHEN id IN (SELECT rowid FROM expenses_fts WHERE description MATCH ?) THEN 0 WHEN id IN (SELECT rowid FROM expenses_fts WHERE recipient MATCH ?) THEN 1 ELSE 2 END), date_time DESC`;
      const rawQ2 = String(req.query.q || "").trim();
      const escapeForFts2 = (s) => s.replace(/"/g, "");
      const tokens2 = rawQ2
        .split(/\s+/)
        .map((t) => escapeForFts2(t))
        .filter(Boolean);
      const qMode2 = String(req.query.qMode || "any").toLowerCase();
      let descExpr = "";
      let recipExpr = "";
      if (qMode2 === "phrase") {
        descExpr = `description:"${escapeForFts2(rawQ2)}"`;
        recipExpr = `recipient:"${escapeForFts2(rawQ2)}"`;
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
    const { session_term, term, category, status, startDate, endDate } =
      req.query;
    const conditions = ["user_id = ?"];
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
    } = req.body;

    // Validation
    if (!date_time || !category || !recipient || !description) {
      return res.status(400).json({ error: "Missing required fields" });
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

    const result = await dbRun(
      `INSERT INTO expenses (user_id, date_time, category, session_term, recipient, description, amount_paid, balance_due, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    } = req.body;

    // Validation
    const amountPaid = parseFloat(amount_paid);
    const balanceDue = parseFloat(balance_due) || 0;

    if (isNaN(amountPaid) || amountPaid < 0 || balanceDue < 0) {
      return res.status(400).json({ error: "Invalid amount values" });
    }

    const status = balanceDue > 0 ? "Partial" : "Paid";

    await dbRun(
      `UPDATE expenses SET date_time = ?, category = ?, session_term = ?, recipient = ?,
             description = ?, amount_paid = ?, balance_due = ?, status = ? WHERE id = ? AND user_id = ?`,
      [
        date_time,
        category,
        session_term,
        recipient,
        description,
        amountPaid,
        balanceDue,
        status,
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
    await dbRun("DELETE FROM expenses WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.user.userId,
    ]);
    res.json({ message: "Expense deleted successfully" });
  } catch (error) {
    console.error("Delete expense error:", error);
    res
      .status(500)
      .json({ error: "Unable to delete expense. Please try again." });
  }
});

// Blog posts routes
app.get("/api/blog-posts", authenticateToken, async (req, res) => {
  try {
    const posts = await dbAll(
      "SELECT * FROM blog_posts WHERE user_id = ? ORDER BY date_time DESC",
      [req.user.userId],
    );
    res.json(posts);
  } catch (error) {
    console.error("Get blog posts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/blog-posts", authenticateToken, async (req, res) => {
  try {
    const { date_time, category, title, content } = req.body;

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
      "UPDATE blog_posts SET date_time = ?, category = ?, title = ?, content = ? WHERE id = ? AND user_id = ?",
      [date_time, category, title, content, req.params.id, req.user.userId],
    );

    res.json({ message: "Blog post updated successfully" });
  } catch (error) {
    console.error("Update blog post error:", error);
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
app.get("/api/dashboard", authenticateToken, async (req, res) => {
  try {
    const stats = await dbAll(
      `SELECT
                COUNT(*) as total_expenses,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance,
                SUM(amount_paid + balance_due) as total_cost
             FROM expenses WHERE user_id = ?`,
      [req.user.userId],
    );

    const categories = await dbAll(
      `SELECT
                category,
                COUNT(*) as count,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance
             FROM expenses WHERE user_id = ? GROUP BY category`,
      [req.user.userId],
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

    res.json({
      statistics: stats[0] || {
        total_expenses: 0,
        total_paid: 0,
        total_balance: 0,
        total_cost: 0,
      },
      categories,
      budgets,
      alerts,
      storageMode,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
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
