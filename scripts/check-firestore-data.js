const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkData() {
    try {
        console.log('Checking Firestore data structure...\n');

        // Get all users
        const usersSnapshot = await db.collection('users').limit(5).get();

        if (usersSnapshot.empty) {
            console.log('No users found in database');
            return;
        }

        for (const userDoc of usersSnapshot.docs) {
            console.log(`\n=== User: ${userDoc.id} ===`);

            // Get expenses for this user
            const expensesSnapshot = await db.collection('users').doc(userDoc.id).collection('expenses').limit(5).get();

            if (expensesSnapshot.empty) {
                console.log('  No expenses found for this user');
                continue;
            }

            console.log(`  Found ${expensesSnapshot.size} expenses (showing first 5):\n`);

            expensesSnapshot.docs.forEach((doc, index) => {
                const data = doc.data();
                console.log(`  Expense ${index + 1} (ID: ${doc.id}):`);
                console.log(`    Fields present:`, Object.keys(data));
                console.log(`    session_term: "${data.session_term || 'NOT SET'}"`);
                console.log(`    category: "${data.category || 'NOT SET'}"`);
                console.log(`    status: "${data.status || 'NOT SET'}"`);
                console.log(`    date_time: "${data.date_time || 'NOT SET'}"`);
                console.log(`    recipient: "${data.recipient || 'NOT SET'}"`);
                console.log('');
            });
        }

        console.log('\n=== Summary ===');
        console.log('Check if the field names and values match what you expect.');
        console.log('Expected values:');
        console.log('  session_term: "First Term", "Second Term", "Third Term", "First Semester", "Second Semester"');
        console.log('  category: "Home Upkeep", "School Upkeep", "School Fees", "Projects"');
        console.log('  status: "Paid", "Partial"');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

checkData();
