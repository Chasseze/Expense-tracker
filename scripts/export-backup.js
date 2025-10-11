#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { createClient } = require('@libsql/client');
const sqlite3 = require('sqlite3').verbose();

const useLibsql = Boolean(process.env.LIBSQL_URL);
const storageMode = useLibsql ? 'libsql' : 'sqlite';
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/expense_tracker.db' : path.join(__dirname, '..', 'expense_tracker.db');

function connectSqlite(filePath) {
    return new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(filePath, (err) => {
            if (err) reject(err);
            else resolve(connection);
        });
    });
}

async function queryAll(connection, sql, params = []) {
    if (useLibsql) {
        const result = await connection.execute({ sql, args: params });
        const columns = result.columns || [];
        const rows = result.rows || [];
        return rows.map((row) => {
            if (typeof row === 'object' && !Array.isArray(row)) {
                return row;
            }
            const obj = {};
            columns.forEach((col, idx) => {
                obj[col] = row[idx];
            });
            return obj;
        });
    }

    return new Promise((resolve, reject) => {
        connection.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function main() {
    const client = useLibsql
        ? createClient({ url: process.env.LIBSQL_URL, authToken: process.env.LIBSQL_AUTH_TOKEN })
        : await connectSqlite(dbPath);

    try {
        const data = {
            generatedAt: new Date().toISOString(),
            storageMode,
            expenses: await queryAll(client, 'SELECT * FROM expenses ORDER BY date_time DESC'),
            blogPosts: await queryAll(client, 'SELECT * FROM blog_posts ORDER BY date_time DESC'),
            budgets: await (async () => {
                try {
                    return await queryAll(client, 'SELECT * FROM budget_limits ORDER BY category');
                } catch (err) {
                    if (/no such table/i.test(err.message)) return [];
                    throw err;
                }
            })(),
            users: await queryAll(client, 'SELECT id, username, created_at FROM users ORDER BY id')
        };

        const outDir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
        await fs.mkdir(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:]/g, '-');
        const filePath = path.join(outDir, `expense-tracker-backup-${stamp}.json`);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Backup written to ${filePath}`);
    } finally {
        if (client && typeof client.close === 'function') {
            client.close();
        }
    }
}

main().catch((err) => {
    console.error('Backup script failed:', err);
    process.exitCode = 1;
});
