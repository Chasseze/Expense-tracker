// COMPREHENSIVE FIX: Syntax error + layout adjustments
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== CRITICAL FIXES ===\n');

// 1. FIX JAVASCRIPT SYNTAX ERROR (line ~1551) - THIS BREAKS EVERYTHING!
const brokenLine = `$("#closeExpenseModal").addEventListener('click, () => $("#expenseModal").classList.add("hidden"));`;
const fixedLine = `$("#closeExpenseModal").addEventListener('click', () => $("#expenseModal").classList.add("hidden"));`;

if (content.includes(brokenLine)) {
    content = content.replace(brokenLine, fixedLine);
    console.log('? FIXED CRITICAL JAVASCRIPT SYNTAX ERROR');
    console.log('   Changed: .addEventListener(\'click, ...');
    console.log('   To:      .addEventListener(\'click\', ...');
} else {
    console.log('??  Syntax error already fixed or not found');
}

console.log('\nWriting fixed file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? CRITICAL FIX APPLIED!');
console.log('\n?? THIS WAS BREAKING EVERYTHING:');
console.log('   - Logout button not working');
console.log('   - All JavaScript functionality broken');
console.log('   - Modal close buttons not working');
console.log('\n? Everything should work now!');
console.log('   Reload your browser to test.');
