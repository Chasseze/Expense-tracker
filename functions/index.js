const functions = require('firebase-functions');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

admin.initializeApp({
  // Match the client firebase-config storageBucket so Admin SDK does not
  // silently target a missing *.appspot.com default bucket.
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    'expense-tracker-prod-df355.firebasestorage.app',
});

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '8mb' }));

const db = admin.firestore();
const auth = admin.auth();
const FieldPath = admin.firestore.FieldPath;

// Receipts: Cloud Functions have no persistent local filesystem across
// invocations, so receipts go to Firebase Storage instead of disk (contrast
// with server.js, the local-dev SQLite backend, which stores them on disk).
const RECEIPT_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!RECEIPT_MIME_EXT[file.mimetype]) {
      return cb(new Error('Only JPEG, PNG, WEBP, GIF images or PDF files are allowed'));
    }
    cb(null, true);
  },
});
function uploadReceiptMiddleware(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  // JSON base64 uploads skip multer; multipart still uses it.
  if (ct.includes('application/json')) return next();
  receiptUpload.single('receipt')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}

function parseReceiptUploadBody(req) {
  if (req.body && req.body.contentBase64) {
    const contentType = req.body.contentType;
    if (!RECEIPT_MIME_EXT[contentType]) {
      const err = new Error('Only JPEG, PNG, WEBP, GIF images or PDF files are allowed');
      err.status = 400;
      throw err;
    }
    const buffer = Buffer.from(String(req.body.contentBase64), 'base64');
    if (!buffer.length) {
      const err = new Error('No file uploaded');
      err.status = 400;
      throw err;
    }
    if (buffer.length > 5 * 1024 * 1024) {
      const err = new Error('File must be 5 MB or smaller');
      err.status = 400;
      throw err;
    }
    return {
      buffer,
      contentType,
      fileName: req.body.fileName || 'receipt',
    };
  }
  if (req.file && req.file.buffer) {
    return {
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      fileName: req.file.originalname || 'receipt',
    };
  }
  const err = new Error('No file uploaded');
  err.status = 400;
  throw err;
}

function getStorageBucket() {
  // Prefer the configured default; fall back to the legacy appspot name.
  try {
    return admin.storage().bucket();
  } catch (_err) {
    return admin.storage().bucket('expense-tracker-prod-df355.appspot.com');
  }
}

async function persistReceiptBinary(uid, keyPrefix, buffer, contentType) {
  const ext = RECEIPT_MIME_EXT[contentType] || '';
  const storagePath = `receipts/${uid}/${keyPrefix}-${Date.now()}${ext}`;
  try {
    const bucket = getStorageBucket();
    await bucket.file(storagePath).save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0' },
    });
    return {
      receipt_path: storagePath,
      receipt_inline: admin.firestore.FieldValue.delete(),
      receipt_mime: admin.firestore.FieldValue.delete(),
    };
  } catch (storageErr) {
    console.error('Firebase Storage save failed; using Firestore inline fallback:', storageErr.message || storageErr);
    // Firestore docs are capped near 1 MB — keep a safe ceiling for inline receipts.
    if (buffer.length > 700000) {
      const err = new Error(
        'Receipt upload failed (Storage unavailable) and file is too large for inline storage. Enable Firebase Storage or use a file under ~700 KB.',
      );
      err.status = 500;
      throw err;
    }
    return {
      receipt_path: 'inline',
      receipt_inline: buffer.toString('base64'),
      receipt_mime: contentType,
    };
  }
}

async function deleteStoredReceipt(receiptPath) {
  if (!receiptPath || receiptPath === 'inline') return;
  try {
    await getStorageBucket().file(receiptPath).delete();
  } catch (_err) {
    // ignore missing files
  }
}

async function streamStoredReceipt(res, data) {
  if (data.receipt_path === 'inline' && data.receipt_inline) {
    const buffer = Buffer.from(String(data.receipt_inline), 'base64');
    res.setHeader('Content-Type', data.receipt_mime || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }
  if (!data.receipt_path) {
    return res.status(404).json({ error: 'No receipt on file' });
  }
  const file = getStorageBucket().file(data.receipt_path);
  const [exists] = await file.exists();
  if (!exists) {
    return res.status(404).json({ error: 'Receipt file missing' });
  }
  const [metadata] = await file.getMetadata();
  res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
  file.createReadStream().on('error', () => res.status(500).end()).pipe(res);
}

// Middleware to verify Firebase ID token
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = { uid: decodedToken.uid, email: decodedToken.email };
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(403).json({ error: 'Invalid token' });
  }
}

// Status endpoint (unauthenticated)
app.get('/api/status', async (req, res) => {
  try {
    res.json({
      storageMode: 'firestore',
      projectId: admin.app().options.projectId,
      status: 'ok'
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// User registration is handled CLIENT-SIDE via Firebase Auth SDK
// Backend only handles authenticated data operations

// User creation trigger: When user registers via Firebase Auth,
// create a Firestore user document via Cloud Function trigger
// (This would be in a separate callable function or Auth trigger)

// Get expenses
app.get('/api/expenses', verifyToken, async (req, res) => {
  try {
    const { session_term, category, status, startDate, endDate } = req.query;
    // Accept both 'q' (new client) and 'search' (legacy) as the text search param
    const search = req.query.q || req.query.search || null;
    // Pagination params
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 0, 0), 100); // 0 (no paging) to 100 max
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0); // 0 means not provided
    const cursor = req.query.cursor || null; // expected to be date_time string

    let query = db.collection('users').doc(req.user.uid).collection('expenses');

    // Date range filters can stay as Firestore queries
    if (startDate) {
      query = query.where('date_time', '>=', startDate);
    }
    if (endDate) {
      query = query.where('date_time', '<=', endDate);
    }

    // Push exact-match filters to Firestore when possible (requires composite indexes for combos)
    const rawCategory = category ? decodeURIComponent(String(category).replace(/\+/g, ' ')).trim() : '';
    const rawStatus = status ? decodeURIComponent(String(status).replace(/\+/g, ' ')).trim() : '';
    const rawSession = session_term ? decodeURIComponent(String(session_term).replace(/\+/g, ' ')).trim() : '';
    const searchPreview = (req.query.q || req.query.search || null);
    const amountPreview = req.query.minAmount || req.query.maxAmount;
    const canPushEquality = !searchPreview && !amountPreview;
    if (canPushEquality && rawCategory) {
      query = query.where('category', '==', rawCategory);
    }
    if (canPushEquality && rawStatus) {
      query = query.where('status', '==', rawStatus);
    }
    if (canPushEquality && rawSession) {
      query = query.where('session_term', '==', rawSession);
    }

  query = query.orderBy('date_time', 'desc');

    // Text search and other filters: fetch all then filter client-side for flexibility
    // Note: URLSearchParams encodes spaces as '+', but Express doesn't always decode them
    // So we manually replace '+' with spaces before processing
    const decodeParam = (val) => val ? decodeURIComponent(val.replace(/\+/g, ' ')).toLowerCase().trim() : null;
    
    const searchTerm = decodeParam(search);
    const filterSessionTerm = decodeParam(session_term);
    const filterCategory = decodeParam(category);
    const filterStatus = decodeParam(status);

    // Soft-delete: exclude deleted items
    const filterDeleted = req.query.includeDeleted !== '1';
    // Amount range
    const minAmt = req.query.minAmount ? parseFloat(req.query.minAmount) : null;
    const maxAmt = req.query.maxAmount ? parseFloat(req.query.maxAmount) : null;
    const sortBy = req.query.sortBy || 'date_desc';

    // Helper function to apply client-side filters
    const applyFilters = (items) => {
      let filtered = items.filter(item => {
        // Exclude soft-deleted items
        if (filterDeleted && item.deleted_at) return false;
        // Search filter
        if (searchTerm) {
          const matchesSearch =
            (item.description && item.description.toLowerCase().includes(searchTerm)) ||
            (item.recipient && item.recipient.toLowerCase().includes(searchTerm)) ||
            (item.category && item.category.toLowerCase().includes(searchTerm)) ||
            (item.session_term && item.session_term.toLowerCase().includes(searchTerm));
          if (!matchesSearch) return false;
        }
        // Session/Term filter (case-insensitive)
        if (filterSessionTerm) {
          const itemSessionTerm = item.session_term ? item.session_term.toLowerCase().trim() : '';
          if (!itemSessionTerm || !itemSessionTerm.includes(filterSessionTerm)) return false;
        }
        // Category filter (case-insensitive)
        if (filterCategory) {
          const itemCategory = item.category ? item.category.toLowerCase().trim() : '';
          if (!itemCategory || !itemCategory.includes(filterCategory)) return false;
        }
        // Status filter (case-insensitive)
        if (filterStatus && (!item.status || !item.status.toLowerCase().trim().includes(filterStatus))) {
          return false;
        }
        // Amount range
        if (minAmt !== null || maxAmt !== null) {
          const total = (Number(item.amount_paid) || 0) + (Number(item.balance_due) || 0);
          if (minAmt !== null && total < minAmt) return false;
          if (maxAmt !== null && total > maxAmt) return false;
        }
        return true;
      });
      // Sort
      const SORT_MAP = {
        date_desc: (a, b) => (b.date_time || '').localeCompare(a.date_time || ''),
        date_asc: (a, b) => (a.date_time || '').localeCompare(b.date_time || ''),
        amount_desc: (a, b) => ((Number(b.amount_paid) + Number(b.balance_due)) - (Number(a.amount_paid) + Number(a.balance_due))),
        amount_asc: (a, b) => ((Number(a.amount_paid) + Number(a.balance_due)) - (Number(b.amount_paid) + Number(b.balance_due))),
        category: (a, b) => (a.category || '').localeCompare(b.category || ''),
      };
      if (SORT_MAP[sortBy]) filtered.sort(SORT_MAP[sortBy]);
      return filtered;
    };

    // Check if any client-side filters are active (includes amount range)
    // Equality filters pushed to Firestore do not require a full collection scan
    const hasClientFilters = Boolean(
      searchTerm ||
      minAmt !== null ||
      maxAmt !== null ||
      (!canPushEquality && (filterSessionTerm || filterCategory || filterStatus))
    );

    // If explicit page number provided, prefer offset-based pagination for direct jumps
    if (pageSize > 0 && page > 0) {
      const pageNum = page; // 1-based expected from client
      // For filters, we need to fetch all and filter, then paginate manually
      if (hasClientFilters) {
        const snapshot = await query.get();
        let allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allItems = applyFilters(allItems);
        const offset = Math.max((pageNum - 1) * pageSize, 0);
        const items = allItems.slice(offset, offset + pageSize);
        return res.json({ items, nextCursor: null, hasMore: offset + pageSize < allItems.length, total: allItems.length });
      }
      const offset = Math.max((pageNum - 1) * pageSize, 0);
      // Prefer cursor when provided to avoid expensive offset scans
      let pageQuery = query;
      if (cursor && pageNum === 1) {
        const cursorVal = typeof cursor === 'string' && cursor.includes('|') ? cursor.split('|')[0] : cursor;
        pageQuery = pageQuery.startAfter(cursorVal);
      } else if (offset > 0) {
        pageQuery = pageQuery.offset(offset);
      }
      const snapshot = await pageQuery.limit(pageSize + 1).get();
      const docs = snapshot.docs;
      const hasMore = docs.length > pageSize;
      const slice = hasMore ? docs.slice(0, pageSize) : docs;
      const items = slice.map(doc => ({ id: doc.id, ...doc.data() })).filter(e => !e.deleted_at);
      const last = slice[slice.length - 1];
      const nextCursor = hasMore && last ? last.get('date_time') : null;
      // Cheap-ish total: only when first page (avoid double full scan on every page)
      let total;
      if (pageNum === 1) {
        try {
          const agg = await query.count().get();
          total = agg.data().count;
        } catch (e) {
          total = undefined;
        }
      }
      return res.json({ items, nextCursor, hasMore, ...(total != null ? { total } : {}) });
    }

    // If pageSize is provided (>0), use cursor-based pagination
    if (pageSize > 0) {
      // For filters, fetch all and filter
      if (hasClientFilters) {
        const snapshot = await query.get();
        let allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allItems = applyFilters(allItems);
        const items = allItems.slice(0, pageSize);
        return res.json({ items, nextCursor: null, hasMore: allItems.length > pageSize, total: allItems.length });
      }
      let pagedQuery = query;
      if (cursor) {
        // Single-field cursor on date_time (strip composite format if present)
        const cursorVal = typeof cursor === 'string' && cursor.includes('|') ? cursor.split('|')[0] : cursor;
        pagedQuery = pagedQuery.startAfter(cursorVal);
      }
      // fetch one extra to determine if there is another page
      const snapshot = await pagedQuery.limit(pageSize + 1).get();
      const docs = snapshot.docs;
      const hasMore = docs.length > pageSize;
      const slice = hasMore ? docs.slice(0, pageSize) : docs;
      const items = slice.map(doc => ({ id: doc.id, ...doc.data() }));
      const last = slice[slice.length - 1];
      const nextCursor = hasMore && last ? last.get('date_time') : null;
      return res.json({ items, nextCursor, hasMore });
    }

    // No pagination requested: return full list (legacy behavior)
    const snapshot = await query.get();
    let expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Always apply filters (includes deleted_at filtering)
    expenses = applyFilters(expenses);
    res.json(expenses);
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Count expenses (for pagination UI)
app.get('/api/expenses/count', verifyToken, async (req, res) => {
  try {
    const { session_term, category, status, startDate, endDate } = req.query;
    // Accept both 'q' (new client) and 'search' (legacy)
    const search = req.query.q || req.query.search || null;
    const minAmt = req.query.minAmount ? parseFloat(req.query.minAmount) : null;
    const maxAmt = req.query.maxAmount ? parseFloat(req.query.maxAmount) : null;

    let query = db.collection('users').doc(req.user.uid).collection('expenses');

    // Date range filters can stay as Firestore queries
    if (startDate) {
      query = query.where('date_time', '>=', startDate);
    }
    if (endDate) {
      query = query.where('date_time', '<=', endDate);
    }

    // Client-side filters for flexibility
    const searchTerm = search ? search.toLowerCase().trim() : null;
    const filterSessionTerm = session_term ? session_term.toLowerCase().trim() : null;
    const filterCategory = category ? category.toLowerCase().trim() : null;
    const filterStatus = status ? status.toLowerCase().trim() : null;

    const hasClientFilters = searchTerm || filterSessionTerm || filterCategory || filterStatus || minAmt !== null || maxAmt !== null;

    if (hasClientFilters) {
      const snapshot = await query.get();
      let allItems = snapshot.docs.map(doc => doc.data());
      allItems = allItems.filter(item => {
        if (item.deleted_at) return false; // exclude soft-deleted
        if (searchTerm) {
          const matchesSearch = 
            (item.description && item.description.toLowerCase().includes(searchTerm)) ||
            (item.recipient && item.recipient.toLowerCase().includes(searchTerm)) ||
            (item.category && item.category.toLowerCase().includes(searchTerm)) ||
            (item.session_term && item.session_term.toLowerCase().includes(searchTerm));
          if (!matchesSearch) return false;
        }
        if (filterSessionTerm && (!item.session_term || !item.session_term.toLowerCase().includes(filterSessionTerm))) {
          return false;
        }
        if (filterCategory && (!item.category || !item.category.toLowerCase().includes(filterCategory))) {
          return false;
        }
        if (filterStatus && (!item.status || !item.status.toLowerCase().includes(filterStatus))) {
          return false;
        }
        if (minAmt !== null || maxAmt !== null) {
          const total = (Number(item.amount_paid) || 0) + (Number(item.balance_due) || 0);
          if (minAmt !== null && total < minAmt) return false;
          if (maxAmt !== null && total > maxAmt) return false;
        }
        return true;
      });
      return res.json({ total: allItems.length });
    }

    // Fetch all docs and count non-deleted in memory (avoids index requirements for deleted_at==null)
    const snapshot = await query.get();
    const total = snapshot.docs.filter(doc => !doc.data().deleted_at).length;
    res.json({ total });
  } catch (error) {
    console.error('Count expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expense
app.post('/api/expenses', verifyToken, async (req, res) => {
  try {
    const { date_time, category, session_term, recipient, description, amount_paid, balance_due, due_date } = req.body;
    if (!date_time || !category || amount_paid == null || balance_due == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const status = Number(balance_due) > 0 ? 'Partial' : 'Paid';

    const docRef = await db.collection('users').doc(req.user.uid).collection('expenses').add({
      date_time,
      category,
      session_term: session_term || '',
      recipient: recipient || '',
      description: description || '',
      amount_paid: Number(amount_paid),
      balance_due: Number(balance_due),
      status,
      due_date: due_date || null,
      deleted_at: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const doc = await docRef.get();
    res.json({ message: 'Expense added successfully', expense: { id: docRef.id, ...doc.data() } });
  } catch (error) {
    console.error('Add expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update expense
app.put('/api/expenses/:id', verifyToken, async (req, res) => {
  try {
    const { date_time, category, session_term, recipient, description, amount_paid, balance_due, due_date } = req.body;
    if (!date_time || !category || amount_paid == null || balance_due == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const status = Number(balance_due) > 0 ? 'Partial' : 'Paid';

    await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).update({
      date_time,
      category,
      session_term: session_term || '',
      recipient: recipient || '',
      description: description || '',
      amount_paid: Number(amount_paid),
      balance_due: Number(balance_due),
      status,
      due_date: due_date || null,
    });

    res.json({ message: 'Expense updated successfully' });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft-delete expense
app.delete('/api/expenses/:id', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).update({
      deleted_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trash: list soft-deleted expenses
app.get('/api/expenses/trash', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.user.uid).collection('expenses').get();
    const rows = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(e => e.deleted_at)
      .sort((a, b) => {
        const ta = a.deleted_at && a.deleted_at.toDate ? a.deleted_at.toDate().getTime() : 0;
        const tb = b.deleted_at && b.deleted_at.toDate ? b.deleted_at.toDate().getTime() : 0;
        return tb - ta;
      });
    res.json(rows);
  } catch (error) {
    console.error('Get trash error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Restore soft-deleted expense
app.post('/api/expenses/:id/restore', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).update({
      deleted_at: null,
    });
    res.json({ message: 'Expense restored successfully' });
  } catch (error) {
    console.error('Restore expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Permanently delete a soft-deleted expense
app.delete('/api/expenses/:id/permanent', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).delete();
    res.json({ message: 'Expense permanently deleted' });
  } catch (error) {
    console.error('Permanent delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload/replace a receipt for an expense
app.post('/api/expenses/:id/receipt', verifyToken, uploadReceiptMiddleware, async (req, res) => {
  try {
    let parsed;
    try {
      parsed = parseReceiptUploadBody(req);
    } catch (parseErr) {
      return res.status(parseErr.status || 400).json({ error: parseErr.message || 'Upload failed' });
    }
    const expenseRef = db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id);
    const doc = await expenseRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await deleteStoredReceipt(doc.data().receipt_path);
    const stored = await persistReceiptBinary(
      req.user.uid,
      req.params.id,
      parsed.buffer,
      parsed.contentType,
    );
    await expenseRef.update(stored);
    res.json({ message: 'Receipt uploaded successfully', receipt_path: stored.receipt_path });
  } catch (error) {
    console.error('Upload receipt error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Unable to upload receipt. If this persists, confirm Firebase Storage is enabled for this project.',
    });
  }
});

// Stream a receipt back to its owner
app.get('/api/expenses/:id/receipt', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'No receipt on file' });
    }
    return streamStoredReceipt(res, doc.data() || {});
  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({ error: 'Unable to retrieve receipt' });
  }
});

// Remove a receipt from an expense
app.delete('/api/expenses/:id/receipt', verifyToken, async (req, res) => {
  try {
    const expenseRef = db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id);
    const doc = await expenseRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    await deleteStoredReceipt(doc.data().receipt_path);
    await expenseRef.update({
      receipt_path: admin.firestore.FieldValue.delete(),
      receipt_inline: admin.firestore.FieldValue.delete(),
      receipt_mime: admin.firestore.FieldValue.delete(),
    });
    res.json({ message: 'Receipt removed' });
  } catch (error) {
    console.error('Delete receipt error:', error);
    res.status(500).json({ error: 'Unable to remove receipt' });
  }
});

// Get blog posts (with optional pagination: ?limit=20&offset=0)
app.get('/api/blog-posts', verifyToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 0, 0), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const summaryOnly = String(req.query.fields || '').toLowerCase() === 'summary';
    let blogQuery = db.collection('users').doc(req.user.uid).collection('blog_posts').orderBy('date_time', 'desc');
    let posts = [];
    let total = null;
    let hasMore = false;

    if (limit > 0) {
      const snap = await blogQuery.offset(offset).limit(limit + 1).get();
      const docs = snap.docs;
      hasMore = docs.length > limit;
      const slice = hasMore ? docs.slice(0, limit) : docs;
      posts = slice.map(doc => ({ id: doc.id, ...doc.data() }));
      try {
        const agg = await db.collection('users').doc(req.user.uid).collection('blog_posts').count().get();
        total = agg.data().count;
      } catch (e) {
        total = offset + posts.length + (hasMore ? 1 : 0);
      }
    } else {
      const snapshot = await blogQuery.get();
      posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      total = posts.length;
    }

    if (summaryOnly) {
      posts = posts.map(p => ({
        id: p.id,
        date_time: p.date_time,
        category: p.category,
        title: p.title,
        excerpt: typeof p.content === 'string' ? p.content.slice(0, 180) : '',
        content_length: typeof p.content === 'string' ? p.content.length : 0,
      }));
    }

    if (limit > 0) {
      res.json({ posts, total, hasMore });
    } else {
      res.json(posts);
    }
  } catch (error) {
    console.error('Get blog posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create blog post
app.post('/api/blog-posts', verifyToken, async (req, res) => {
  try {
    const { date_time, category, title, content } = req.body;
    if (!date_time || !category || !title || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof title !== 'string' || title.trim().length > 200) {
      return res.status(400).json({ error: 'Title must be 1-200 characters' });
    }
    if (typeof content !== 'string' || content.length > 50000) {
      return res.status(400).json({ error: 'Content too long (max 50,000 characters)' });
    }

    const docRef = await db.collection('users').doc(req.user.uid).collection('blog_posts').add({
      date_time,
      category,
      title,
      content,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      modified_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const doc = await docRef.get();
    res.json({ message: 'Blog post created successfully', post: { id: docRef.id, ...doc.data() } });
  } catch (error) {
    console.error('Add blog post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update blog post
app.put('/api/blog-posts/:id', verifyToken, async (req, res) => {
  try {
    const { date_time, category, title, content } = req.body;
    if (!date_time || !category || !title || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof title !== 'string' || title.trim().length > 200) {
      return res.status(400).json({ error: 'Title must be 1-200 characters' });
    }
    if (typeof content !== 'string' || content.length > 50000) {
      return res.status(400).json({ error: 'Content too long (max 50,000 characters)' });
    }

    await db.collection('users').doc(req.user.uid).collection('blog_posts').doc(req.params.id).update({
      date_time,
      category,
      title,
      content,
      modified_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ message: 'Blog post updated successfully' });
  } catch (error) {
    console.error('Update blog post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single blog post
app.get('/api/blog-posts/:id', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).collection('blog_posts').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Get blog post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete blog post
app.delete('/api/blog-posts/:id', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('blog_posts').doc(req.params.id).delete();
    res.json({ message: 'Blog post deleted successfully' });
  } catch (error) {
    console.error('Delete blog post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get budgets
app.get('/api/budgets', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).collection('settings').doc('budgets').get();
    const budgets = doc.exists ? doc.data().categories || [] : [];
    res.json(budgets);
  } catch (error) {
    console.error('Get budgets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set budget
app.put('/api/budgets', verifyToken, async (req, res) => {
  try {
    const { category, threshold } = req.body;

    if (!category || typeof threshold !== 'number' || threshold < 0) {
      return res.status(400).json({ error: 'Category and non-negative threshold required' });
    }

    const settingsRef = db.collection('users').doc(req.user.uid).collection('settings').doc('budgets');
    const doc = await settingsRef.get();
    const existing = doc.exists ? (doc.data().categories || []) : [];
    const updated = existing.filter(b => b.category !== category);
    updated.push({ category, threshold });

    await settingsRef.set({ categories: updated });
    res.json({ message: 'Budget updated successfully' });
  } catch (error) {
    console.error('Upsert budget error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete budget
app.delete('/api/budgets/:category', verifyToken, async (req, res) => {
  try {
    const category = req.params.category;
    const settingsRef = db.collection('users').doc(req.user.uid).collection('settings').doc('budgets');
    const doc = await settingsRef.get();
    const existing = doc.exists ? (doc.data().categories || []) : [];
    const updated = existing.filter(b => b.category !== category);

    await settingsRef.set({ categories: updated });
    res.json({ message: 'Budget removed successfully' });
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00Z');
  switch (frequency) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

// List recurring templates
app.get('/api/recurring', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.user.uid).collection('recurring_templates')
      .orderBy('next_run_date', 'asc').get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    console.error('Get recurring templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create recurring template
app.post('/api/recurring', verifyToken, async (req, res) => {
  try {
    const { category, session_term, recipient, description, amount_paid, balance_due, frequency, start_date } = req.body;
    if (!category || !recipient || !description || !start_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!RECURRING_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency' });
    }
    const amountPaid = Number(amount_paid);
    const balanceDue = Number(balance_due) || 0;
    if (isNaN(amountPaid) || amountPaid < 0 || balanceDue < 0) {
      return res.status(400).json({ error: 'Invalid amount values' });
    }

    const docRef = await db.collection('users').doc(req.user.uid).collection('recurring_templates').add({
      category,
      session_term: session_term || '',
      recipient,
      description,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      frequency,
      next_run_date: start_date,
      active: true,
      last_generated_at: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const doc = await docRef.get();
    res.json({ message: 'Recurring expense created', template: { id: docRef.id, ...doc.data() } });
  } catch (error) {
    console.error('Create recurring template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update / pause / resume recurring template
app.put('/api/recurring/:id', verifyToken, async (req, res) => {
  try {
    const { category, session_term, recipient, description, amount_paid, balance_due, frequency, active } = req.body;
    const updates = {};
    if (category != null) updates.category = category;
    if (session_term != null) updates.session_term = session_term;
    if (recipient != null) updates.recipient = recipient;
    if (description != null) updates.description = description;
    if (amount_paid != null) updates.amount_paid = Number(amount_paid) || 0;
    if (balance_due != null) updates.balance_due = Number(balance_due) || 0;
    if (frequency != null) {
      if (!RECURRING_FREQUENCIES.includes(frequency)) {
        return res.status(400).json({ error: 'Invalid frequency' });
      }
      updates.frequency = frequency;
    }
    if (active != null) updates.active = Boolean(active);

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await db.collection('users').doc(req.user.uid).collection('recurring_templates').doc(req.params.id).update(updates);
    res.json({ message: 'Recurring expense updated' });
  } catch (error) {
    console.error('Update recurring template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete recurring template
app.delete('/api/recurring/:id', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('recurring_templates').doc(req.params.id).delete();
    res.json({ message: 'Recurring expense deleted' });
  } catch (error) {
    console.error('Delete recurring template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PURCHASE_PRIORITIES = ['Low', 'Medium', 'High'];

app.get('/api/purchases', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.user.uid).collection('purchases').get();
    const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    rows.sort((a, b) => {
      const statusRank = (s) => (s === 'Planned' ? 0 : 1);
      if (statusRank(a.status) !== statusRank(b.status)) return statusRank(a.status) - statusRank(b.status);
      if (!a.target_date) return 1;
      if (!b.target_date) return -1;
      return a.target_date.localeCompare(b.target_date);
    });
    res.json(rows);
  } catch (error) {
    console.error('Get purchases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Purchase reports — separate from expense /api/reports
app.get('/api/purchases/reports', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, category, status } = req.query;
    const snapshot = await db.collection('users').doc(req.user.uid).collection('purchases').get();
    let purchases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (startDate) {
      purchases = purchases.filter(p => !p.target_date || String(p.target_date) >= startDate);
    }
    if (endDate) {
      purchases = purchases.filter(p => !p.target_date || String(p.target_date) <= endDate);
    }
    if (category) purchases = purchases.filter(p => p.category === category);
    if (status) purchases = purchases.filter(p => p.status === status);

    const statistics = {
      total_purchases: purchases.length,
      total_estimated: purchases.reduce((sum, p) => sum + (Number(p.estimated_cost) || 0), 0),
      planned_count: purchases.filter(p => p.status === 'Planned').length,
      purchased_count: purchases.filter(p => p.status === 'Purchased').length,
    };

    const groupBy = (keyFn) => {
      const map = {};
      purchases.forEach(p => {
        const key = keyFn(p);
        if (!key) return;
        if (!map[key]) map[key] = { key, count: 0, total_estimated: 0 };
        map[key].count++;
        map[key].total_estimated += Number(p.estimated_cost) || 0;
      });
      return Object.values(map);
    };

    const byCategory = groupBy(p => p.category || 'Uncategorized')
      .map(r => ({ category: r.key, count: r.count, total_estimated: r.total_estimated }))
      .sort((a, b) => a.category.localeCompare(b.category));
    const byStatus = groupBy(p => p.status)
      .map(r => ({ status: r.key, count: r.count, total_estimated: r.total_estimated }))
      .sort((a, b) => a.status.localeCompare(b.status));

    const items = purchases
      .slice()
      .sort((a, b) => {
        const statusRank = (s) => (s === 'Planned' ? 0 : 1);
        if (statusRank(a.status) !== statusRank(b.status)) return statusRank(a.status) - statusRank(b.status);
        if (!a.target_date) return 1;
        if (!b.target_date) return -1;
        return String(a.target_date).localeCompare(String(b.target_date));
      })
      .slice(0, 1000)
      .map(p => ({
        id: p.id,
        item: p.item,
        category: p.category,
        estimated_cost: p.estimated_cost,
        priority: p.priority,
        target_date: p.target_date,
        status: p.status,
        notes: p.notes,
        receipt_path: p.receipt_path || null,
      }));

    res.json({ statistics, byCategory, byStatus, items });
  } catch (error) {
    console.error('Purchase reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/purchases', verifyToken, async (req, res) => {
  try {
    const { item, category, estimated_cost, priority, target_date, notes } = req.body;
    if (!item || estimated_cost == null) {
      return res.status(400).json({ error: 'Item and estimated cost are required' });
    }
    const cost = Number(estimated_cost);
    if (isNaN(cost) || cost < 0) {
      return res.status(400).json({ error: 'Estimated cost must be a positive number' });
    }
    const finalPriority = PURCHASE_PRIORITIES.includes(priority) ? priority : 'Medium';

    const docRef = await db.collection('users').doc(req.user.uid).collection('purchases').add({
      item,
      category: category || null,
      estimated_cost: cost,
      priority: finalPriority,
      target_date: target_date || null,
      status: 'Planned',
      notes: notes || null,
      linked_expense_id: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const doc = await docRef.get();
    res.json({ message: 'Purchase added', purchase: { id: docRef.id, ...doc.data() } });
  } catch (error) {
    console.error('Create purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/purchases/:id', verifyToken, async (req, res) => {
  try {
    const { item, category, estimated_cost, priority, target_date, notes, status } = req.body;
    const updates = {};
    if (item != null) updates.item = item;
    if (Object.prototype.hasOwnProperty.call(req.body, 'category')) {
      updates.category = category || null;
    }
    if (estimated_cost != null) {
      const cost = Number(estimated_cost);
      if (isNaN(cost) || cost < 0) {
        return res.status(400).json({ error: 'Estimated cost must be a positive number' });
      }
      updates.estimated_cost = cost;
    }
    if (priority != null) {
      if (!PURCHASE_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: 'Invalid priority' });
      }
      updates.priority = priority;
    }
    if (target_date != null) updates.target_date = target_date;
    if (notes != null) updates.notes = notes;
    if (status != null) updates.status = status;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await db.collection('users').doc(req.user.uid).collection('purchases').doc(req.params.id).update(updates);
    res.json({ message: 'Purchase updated' });
  } catch (error) {
    console.error('Update purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/purchases/:id', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('purchases').doc(req.params.id).delete();
    res.json({ message: 'Purchase deleted' });
  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload/replace a receipt for a purchase
// Accepts JSON { contentBase64, contentType, fileName } (preferred through
// Firebase Hosting) or multipart/form-data field "receipt".
app.post('/api/purchases/:id/receipt', verifyToken, uploadReceiptMiddleware, async (req, res) => {
  try {
    let parsed;
    try {
      parsed = parseReceiptUploadBody(req);
    } catch (parseErr) {
      return res.status(parseErr.status || 400).json({ error: parseErr.message || 'Upload failed' });
    }
    const purchaseRef = db.collection('users').doc(req.user.uid).collection('purchases').doc(req.params.id);
    const doc = await purchaseRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    await deleteStoredReceipt(doc.data().receipt_path);
    const stored = await persistReceiptBinary(
      req.user.uid,
      `purchase-${req.params.id}`,
      parsed.buffer,
      parsed.contentType,
    );
    await purchaseRef.update(stored);
    res.json({ message: 'Receipt uploaded successfully', receipt_path: stored.receipt_path });
  } catch (error) {
    console.error('Upload purchase receipt error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Unable to upload receipt. If this persists, confirm Firebase Storage is enabled for this project.',
    });
  }
});

// Stream a purchase receipt back to its owner
app.get('/api/purchases/:id/receipt', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).collection('purchases').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'No receipt on file' });
    }
    return streamStoredReceipt(res, doc.data() || {});
  } catch (error) {
    console.error('Get purchase receipt error:', error);
    res.status(500).json({ error: 'Unable to retrieve receipt' });
  }
});

// Remove a receipt from a purchase
app.delete('/api/purchases/:id/receipt', verifyToken, async (req, res) => {
  try {
    const purchaseRef = db.collection('users').doc(req.user.uid).collection('purchases').doc(req.params.id);
    const doc = await purchaseRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    await deleteStoredReceipt(doc.data().receipt_path);
    await purchaseRef.update({
      receipt_path: admin.firestore.FieldValue.delete(),
      receipt_inline: admin.firestore.FieldValue.delete(),
      receipt_mime: admin.firestore.FieldValue.delete(),
    });
    res.json({ message: 'Receipt removed' });
  } catch (error) {
    console.error('Delete purchase receipt error:', error);
    res.status(500).json({ error: 'Unable to remove receipt' });
  }
});

app.post('/api/purchases/:id/convert', verifyToken, async (req, res) => {
  try {
    const purchaseRef = db.collection('users').doc(req.user.uid).collection('purchases').doc(req.params.id);
    const doc = await purchaseRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    const purchase = doc.data();
    if (purchase.status === 'Purchased') {
      return res.status(400).json({ error: 'Purchase has already been converted' });
    }

    const amountPaid = Number(req.body.amount_paid);
    const balanceDue = Number(req.body.balance_due) || 0;
    if (isNaN(amountPaid) || amountPaid < 0 || balanceDue < 0) {
      return res.status(400).json({ error: 'Invalid amount values' });
    }
    const status = balanceDue > 0 ? 'Partial' : 'Paid';
    const dateTime = req.body.date_time || new Date().toISOString().slice(0, 16).replace('T', ' ');

    // Receipts stay on the purchase record only — expenses no longer carry receipts.
    const expenseRef = await db.collection('users').doc(req.user.uid).collection('expenses').add({
      date_time: dateTime,
      category: purchase.category || 'Uncategorized',
      session_term: '',
      recipient: purchase.item,
      description: `Purchased: ${purchase.item}`,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status,
      due_date: null,
      deleted_at: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await purchaseRef.update({ status: 'Purchased', linked_expense_id: expenseRef.id });
    res.json({ message: 'Purchase converted to expense', expense_id: expenseRef.id });
  } catch (error) {
    console.error('Convert purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get custom categories
app.get('/api/categories', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).collection('settings').doc('categories').get();
    const categories = doc.exists ? doc.data().list || [] : [];
    res.json(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add custom category
app.post('/api/categories', verifyToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const categoryName = name.trim();
    
    const settingsRef = db.collection('users').doc(req.user.uid).collection('settings').doc('categories');
    const doc = await settingsRef.get();
    const existing = doc.exists ? (doc.data().list || []) : [];
    
    if (existing.includes(categoryName)) {
      return res.status(400).json({ error: 'Category already exists' });
    }
    
    existing.push(categoryName);
    existing.sort();
    await settingsRef.set({ list: existing });
    
    res.json({ message: 'Category added successfully', categories: existing });
  } catch (error) {
    console.error('Add category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete custom category
app.delete('/api/categories/:name', verifyToken, async (req, res) => {
  try {
    const categoryName = decodeURIComponent(req.params.name);
    const settingsRef = db.collection('users').doc(req.user.uid).collection('settings').doc('categories');
    const doc = await settingsRef.get();
    const existing = doc.exists ? (doc.data().list || []) : [];
    const updated = existing.filter(c => c !== categoryName);
    
    await settingsRef.set({ list: updated });
    res.json({ message: 'Category removed successfully', categories: updated });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard statistics
// Reports: filtered totals + breakdowns over a date range
app.get('/api/reports', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, category, status } = req.query;
    let query = db.collection('users').doc(req.user.uid).collection('expenses');
    if (startDate) query = query.where('date_time', '>=', startDate);
    if (endDate) query = query.where('date_time', '<=', endDate + ' 23:59');

    const snapshot = await query.get();
    let expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(e => !e.deleted_at);
    if (category) expenses = expenses.filter(e => e.category === category);
    if (status) expenses = expenses.filter(e => e.status === status);

    const statistics = {
      total_expenses: expenses.length,
      total_paid: expenses.reduce((sum, e) => sum + (Number(e.amount_paid) || 0), 0),
      total_balance: expenses.reduce((sum, e) => sum + (Number(e.balance_due) || 0), 0),
      total_cost: expenses.reduce((sum, e) => sum + (Number(e.amount_paid) || 0) + (Number(e.balance_due) || 0), 0),
    };

    const groupBy = (keyFn) => {
      const map = {};
      expenses.forEach(e => {
        const key = keyFn(e);
        if (!key) return;
        if (!map[key]) map[key] = { key, count: 0, total_paid: 0, total_balance: 0 };
        map[key].count++;
        map[key].total_paid += Number(e.amount_paid) || 0;
        map[key].total_balance += Number(e.balance_due) || 0;
      });
      return Object.values(map);
    };

    const byCategory = groupBy(e => e.category).map(r => ({ category: r.key, count: r.count, total_paid: r.total_paid, total_balance: r.total_balance }))
      .sort((a, b) => a.category.localeCompare(b.category));
    const byStatus = groupBy(e => e.status).map(r => ({ status: r.key, count: r.count, total_paid: r.total_paid, total_balance: r.total_balance }))
      .sort((a, b) => a.status.localeCompare(b.status));
    const byMonth = groupBy(e => (e.date_time ? String(e.date_time).slice(0, 7) : null))
      .map(r => ({ month: r.key, count: r.count, total_paid: r.total_paid, total_balance: r.total_balance }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const transactions = expenses
      .slice()
      .sort((a, b) => String(b.date_time || '').localeCompare(String(a.date_time || '')))
      .slice(0, 1000)
      .map(e => ({
        id: e.id,
        date_time: e.date_time,
        category: e.category,
        recipient: e.recipient,
        description: e.description,
        amount_paid: e.amount_paid,
        balance_due: e.balance_due,
        status: e.status,
      }));

    res.json({ statistics, byCategory, byStatus, byMonth, transactions });
  } catch (error) {
    console.error('Reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dashboard', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = db.collection('users').doc(req.user.uid).collection('expenses');
    if (startDate) query = query.where('date_time', '>=', startDate);
    if (endDate) query = query.where('date_time', '<=', endDate + ' 23:59');
    const snapshot = await query.get();
    const expenses = snapshot.docs.map(doc => doc.data()).filter(e => !e.deleted_at);

    const stats = {
      total_expenses: expenses.length,
      total_paid: expenses.reduce((sum, e) => sum + (Number(e.amount_paid) || 0), 0),
      total_balance: expenses.reduce((sum, e) => sum + (Number(e.balance_due) || 0), 0),
      total_cost: expenses.reduce((sum, e) => sum + (Number(e.amount_paid) || 0) + (Number(e.balance_due) || 0), 0)
    };

    const categoryMap = {};
    expenses.forEach(e => {
      if (!categoryMap[e.category]) {
        categoryMap[e.category] = { category: e.category, count: 0, total_paid: 0, total_balance: 0 };
      }
      categoryMap[e.category].count++;
      categoryMap[e.category].total_paid += Number(e.amount_paid) || 0;
      categoryMap[e.category].total_balance += Number(e.balance_due) || 0;
    });
    const categories = Object.values(categoryMap);

    const budgetsDoc = await db.collection('users').doc(req.user.uid).collection('settings').doc('budgets').get();
    const budgets = budgetsDoc.exists ? (budgetsDoc.data().categories || []) : [];

    const budgetMap = budgets.reduce((acc, item) => {
      acc[item.category] = item.threshold;
      return acc;
    }, {});

    const alerts = categories
      .map((cat) => {
        const threshold = budgetMap[cat.category];
        if (threshold == null) return null;
        const total = (Number(cat.total_paid) || 0) + (Number(cat.total_balance) || 0);
        if (total <= threshold) return null;
        return {
          category: cat.category,
          threshold,
          total
        };
      })
      .filter(Boolean);

    const monthlyMap = {};
    expenses.forEach(e => {
      const dt = e.date_time ? String(e.date_time) : '';
      const key = dt.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, paid: 0, balance: 0 };
      monthlyMap[key].paid += Number(e.amount_paid) || 0;
      monthlyMap[key].balance += Number(e.balance_due) || 0;
    });
    const monthlySeries = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

    // Payment-due reminders: global across all (non-deleted) expenses with a
    // balance owing, not scoped to the dashboard's date range.
    const allExpensesSnap = await db.collection('users').doc(req.user.uid).collection('expenses').get();
    const allExpenses = allExpensesSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(e => !e.deleted_at && Number(e.balance_due) > 0 && e.due_date);

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const toAlertShape = (e) => ({
      id: e.id,
      category: e.category,
      recipient: e.recipient,
      description: e.description,
      balance_due: e.balance_due,
      due_date: e.due_date,
    });

    const overdue = allExpenses
      .filter(e => e.due_date < today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map(toAlertShape);
    const dueSoon = allExpenses
      .filter(e => e.due_date >= today && e.due_date <= sevenDaysOut)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map(toAlertShape);

    res.json({
      statistics: stats,
      categories,
      monthlySeries,
      budgets,
      alerts,
      overdue,
      dueSoon,
      storageMode: 'firestore'
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Change password (Firebase Admin SDK – re-auth is handled client-side)
app.put('/api/users/password', verifyToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'New password must be 8-128 characters' });
    }
    await admin.auth().updateUser(req.user.uid, { password: newPassword });
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    // Firebase might throw if re-auth is required – surface a clear message
    const msg = error.code === 'auth/requires-recent-login'
      ? 'Please re-authenticate before changing your password'
      : 'Internal server error';
    res.status(500).json({ error: msg });
  }
});

// Token refresh – Firebase tokens are auto-refreshed by the client SDK;
// this endpoint exists for compatibility with the local server.
app.post('/api/auth/refresh', verifyToken, (req, res) => {
  // The caller already holds a valid Firebase token; tell them to use it.
  res.json({ message: 'Use Firebase SDK to refresh tokens', uid: req.user.uid });
});

// Export the Express app as a Cloud Function
exports.api = functions.https.onRequest(app);

// Scheduled job: generate due expenses from active recurring templates across all users.
exports.generateRecurringExpenses = onSchedule('every 24 hours', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const dueSnapshot = await db.collectionGroup('recurring_templates')
    .where('active', '==', true)
    .where('next_run_date', '<=', today)
    .get();

  for (const doc of dueSnapshot.docs) {
    const tpl = doc.data();
    const expensesRef = doc.ref.parent.parent.collection('expenses');
    let nextRun = tpl.next_run_date;
    let iterations = 0;
    // Catch up if a scheduled run was missed across one or more occurrences, capped to avoid runaway loops.
    while (nextRun <= today && iterations < 12) {
      const status = Number(tpl.balance_due) > 0 ? 'Partial' : 'Paid';
      await expensesRef.add({
        date_time: `${nextRun} 09:00`,
        category: tpl.category,
        session_term: tpl.session_term || '',
        recipient: tpl.recipient,
        description: tpl.description,
        amount_paid: tpl.amount_paid,
        balance_due: tpl.balance_due,
        status,
        due_date: null,
        recurring_template_id: doc.id,
        deleted_at: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      nextRun = advanceDate(nextRun, tpl.frequency);
      iterations += 1;
    }
    await doc.ref.update({
      next_run_date: nextRun,
      last_generated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  if (dueSnapshot.size) {
    console.log(`Recurring: generated occurrences for ${dueSnapshot.size} template(s).`);
  }
});
