const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

admin.initializeApp();

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

const db = admin.firestore();
const auth = admin.auth();
const FieldPath = admin.firestore.FieldPath;

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
    const hasClientFilters = searchTerm || filterSessionTerm || filterCategory || filterStatus || minAmt !== null || maxAmt !== null;

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
      const snapshot = await query.offset(offset).limit(pageSize).get();
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Compute next cursor hint for possible mixed navigation
      const last = snapshot.docs[snapshot.docs.length - 1];
      const nextCursor = last ? last.get('date_time') : null;
      return res.json({ items, nextCursor, hasMore: items.length === pageSize });
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
    const { date_time, category, session_term, recipient, description, amount_paid, balance_due } = req.body;
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
    const { date_time, category, session_term, recipient, description, amount_paid, balance_due } = req.body;
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

// Get blog posts (with optional pagination: ?limit=20&offset=0)
app.get('/api/blog-posts', verifyToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 0, 0), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const snapshot = await db.collection('users').doc(req.user.uid).collection('blog_posts')
      .orderBy('date_time', 'desc').get();
    const allPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const total = allPosts.length;

    if (limit > 0) {
      const posts = allPosts.slice(offset, offset + limit);
      res.json({ posts, total, hasMore: offset + posts.length < total });
    } else {
      res.json(allPosts); // backward-compatible: no limit → plain array
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

    res.json({
      statistics: stats,
      categories,
      budgets,
      alerts,
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
