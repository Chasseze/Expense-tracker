const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-here-change-this-in-production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// SQLite Database setup
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/expense_tracker.db' : './expense_tracker.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

function initializeDatabase() {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Expenses table
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
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
    )`);

    // Blog posts table
    db.run(`CREATE TABLE IF NOT EXISTS blog_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date_time TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
}

// Helper function for database queries with promises
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// Routes

// User registration
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Check if user exists
        const existingUser = await dbAll('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password and create user
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await dbRun('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);

        // Generate token
        const token = jwt.sign({ userId: result.id, username }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            message: 'User created successfully',
            token,
            user: { id: result.id, username }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Find user
        const users = await dbAll('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, username: user.username }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Expenses routes
app.get('/api/expenses', authenticateToken, async (req, res) => {
    try {
        const expenses = await dbAll('SELECT * FROM expenses WHERE user_id = ? ORDER BY date_time DESC', [req.user.userId]);
        res.json(expenses);
    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/expenses', authenticateToken, async (req, res) => {
    try {
        const { date_time, category, session_term, recipient, description, amount_paid, balance_due } = req.body;
        const status = balance_due > 0 ? 'Partial' : 'Paid';
        
        const result = await dbRun(
            `INSERT INTO expenses (user_id, date_time, category, session_term, recipient, description, amount_paid, balance_due, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.userId, date_time, category, session_term, recipient, description, amount_paid, balance_due, status]
        );

        const newExpense = await dbAll('SELECT * FROM expenses WHERE id = ?', [result.id]);
        res.json({ message: 'Expense added successfully', expense: newExpense[0] });
    } catch (error) {
        console.error('Add expense error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/expenses/:id', authenticateToken, async (req, res) => {
    try {
        const { date_time, category, session_term, recipient, description, amount_paid, balance_due } = req.body;
        const status = balance_due > 0 ? 'Partial' : 'Paid';
        
        await dbRun(
            `UPDATE expenses SET date_time = ?, category = ?, session_term = ?, recipient = ?, 
             description = ?, amount_paid = ?, balance_due = ?, status = ? WHERE id = ? AND user_id = ?`,
            [date_time, category, session_term, recipient, description, amount_paid, balance_due, status, req.params.id, req.user.userId]
        );

        res.json({ message: 'Expense updated successfully' });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/expenses/:id', authenticateToken, async (req, res) => {
    try {
        await dbRun('DELETE FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
        res.json({ message: 'Expense deleted successfully' });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Blog posts routes
app.get('/api/blog-posts', authenticateToken, async (req, res) => {
    try {
        const posts = await dbAll('SELECT * FROM blog_posts WHERE user_id = ? ORDER BY date_time DESC', [req.user.userId]);
        res.json(posts);
    } catch (error) {
        console.error('Get blog posts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/blog-posts', authenticateToken, async (req, res) => {
    try {
        const { date_time, category, title, content } = req.body;
        
        const result = await dbRun(
            'INSERT INTO blog_posts (user_id, date_time, category, title, content) VALUES (?, ?, ?, ?, ?)',
            [req.user.userId, date_time, category, title, content]
        );

        const newPost = await dbAll('SELECT * FROM blog_posts WHERE id = ?', [result.id]);
        res.json({ message: 'Blog post created successfully', post: newPost[0] });
    } catch (error) {
        console.error('Add blog post error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/blog-posts/:id', authenticateToken, async (req, res) => {
    try {
        const { date_time, category, title, content } = req.body;
        
        await dbRun(
            'UPDATE blog_posts SET date_time = ?, category = ?, title = ?, content = ? WHERE id = ? AND user_id = ?',
            [date_time, category, title, content, req.params.id, req.user.userId]
        );

        res.json({ message: 'Blog post updated successfully' });
    } catch (error) {
        console.error('Update blog post error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/blog-posts/:id', authenticateToken, async (req, res) => {
    try {
        await dbRun('DELETE FROM blog_posts WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
        res.json({ message: 'Blog post deleted successfully' });
    } catch (error) {
        console.error('Delete blog post error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Dashboard statistics
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const stats = await dbAll(
            `SELECT 
                COUNT(*) as total_expenses,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance,
                SUM(amount_paid + balance_due) as total_cost
             FROM expenses WHERE user_id = ?`,
            [req.user.userId]
        );

        const categories = await dbAll(
            `SELECT 
                category,
                COUNT(*) as count,
                SUM(amount_paid) as total_paid,
                SUM(balance_due) as total_balance
             FROM expenses WHERE user_id = ? GROUP BY category`,
            [req.user.userId]
        );

        res.json({
            statistics: stats[0] || { total_expenses: 0, total_paid: 0, total_balance: 0, total_cost: 0 },
            categories: categories
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Using SQLite database: expense_tracker.db');
});