// Quick test to verify Turso connection and schema
const { createClient } = require('@libsql/client');

const db = createClient({
    url: process.env.LIBSQL_URL,
    authToken: process.env.LIBSQL_AUTH_TOKEN
});

async function testConnection() {
    try {
        console.log('Testing Turso connection...');
        console.log('URL:', process.env.LIBSQL_URL);
        
        // Test basic query
        const result = await db.execute('SELECT 1 as test');
        console.log('✓ Connection successful!');
        
        // Check tables
        const tables = await db.execute(`
            SELECT name FROM sqlite_master 
            WHERE type='table' 
            ORDER BY name
        `);
        
        console.log('\nTables in database:');
        if (tables.rows.length === 0) {
            console.log('❌ NO TABLES FOUND - Database is empty!');
        } else {
            tables.rows.forEach(row => {
                console.log('  -', row.name);
            });
        }
        
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
    }
}

testConnection();
