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

// User registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Create Firebase Auth user
    const userRecord = await auth.createUser({
      email,
      password
    });

    // Create Firestore user document
    await db.collection('users').doc(userRecord.uid).set({
      email,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Generate custom token for immediate login
    const customToken = await auth.createCustomToken(userRecord.uid);

    res.json({
      message: 'User created successfully',
      token: customToken,
      user: { uid: userRecord.uid, email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// User login (returns Firebase ID token for client to use)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // For Firebase Auth, the client should handle login via Firebase SDK
    // This endpoint is for reference; actual login happens on client with Firebase SDK
    // Return a message guiding client to use Firebase SDK
    res.json({
      message: 'Use Firebase SDK on client for login. Email/password provided.',
      email
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get expenses
app.get('/api/expenses', verifyToken, async (req, res) => {
  try {
    const { category, status, startDate, endDate } = req.query;
    let query = db.collection('users').doc(req.user.uid).collection('expenses');

    if (category) {
      query = query.where('category', '==', category);
    }
    if (status) {
      query = query.where('status', '==', status);
    }
    if (startDate) {
      query = query.where('date_time', '>=', startDate);
    }
    if (endDate) {
      query = query.where('date_time', '<=', endDate);
    }

    const snapshot = await query.orderBy('date_time', 'desc').get();
    const expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(expenses);
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expense
app.post('/api/expenses', verifyToken, async (req, res) => {
  try {
    const { date_time, category, session_term, recipient, description, amount_paid, balance_due } = req.body;
    const status = balance_due > 0 ? 'Partial' : 'Paid';

    const docRef = await db.collection('users').doc(req.user.uid).collection('expenses').add({
      date_time,
      category,
      session_term,
      recipient,
      description,
      amount_paid: Number(amount_paid),
      balance_due: Number(balance_due),
      status,
      created_at: admin.firestore.FieldValue.serverTimestamp()
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
    const status = balance_due > 0 ? 'Partial' : 'Paid';

    await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).update({
      date_time,
      category,
      session_term,
      recipient,
      description,
      amount_paid: Number(amount_paid),
      balance_due: Number(balance_due),
      status
    });

    res.json({ message: 'Expense updated successfully' });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete expense
app.delete('/api/expenses/:id', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).collection('expenses').doc(req.params.id).delete();
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get blog posts
app.get('/api/blog-posts', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.user.uid).collection('blog_posts')
      .orderBy('date_time', 'desc').get();
    const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(posts);
  } catch (error) {
    console.error('Get blog posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create blog post
app.post('/api/blog-posts', verifyToken, async (req, res) => {
  try {
    const { date_time, category, title, content } = req.body;

    const docRef = await db.collection('users').doc(req.user.uid).collection('blog_posts').add({
      date_time,
      category,
      title,
      content,
      created_at: admin.firestore.FieldValue.serverTimestamp()
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

    await db.collection('users').doc(req.user.uid).collection('blog_posts').doc(req.params.id).update({
      date_time,
      category,
      title,
      content
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

// Dashboard statistics
app.get('/api/dashboard', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.user.uid).collection('expenses').get();
    const expenses = snapshot.docs.map(doc => doc.data());

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

// Export the Express app as a Cloud Function
exports.api = functions.https.onRequest(app);
