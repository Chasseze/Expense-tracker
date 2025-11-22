// Final polish: header padding, counter layout, and center category breakdown
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== FINAL POLISH ADJUSTMENTS ===\n');

// 1. Increase bottom padding of header (currently p-8, change to pb-10 or pb-12)
content = content.replace(
    /<header class="bg-gradient-to-r from-blue-500 via-purple-500 to-orange-400 rounded-2xl shadow-2xl p-8 mb-8/,
    '<header class="bg-gradient-to-r from-blue-500 via-purple-500 to-orange-400 rounded-2xl shadow-2xl p-8 pb-12 mb-8'
);
console.log('? Increased header bottom padding');

// 2. Make counters display in one line on all screens (remove md:grid-cols-3, make it always 3 columns)
content = content.replace(
    /<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">/,
    '<div class="grid grid-cols-3 gap-4 md:gap-6 mb-8">'
);
console.log('? Changed counters to always display in one line (3 columns)');

// 3. Center the Category Breakdown heading
content = content.replace(
    /<h2 class="text-2xl font-bold text-gray-800 mb-4">\s*<i class="fas fa-chart-pie mr-2 text-indigo-600"><\/i>Category Breakdown/,
    '<h2 class="text-2xl font-bold text-gray-800 mb-4 text-center"><i class="fas fa-chart-pie mr-2 text-indigo-600"></i>Category Breakdown'
);
console.log('? Centered Category Breakdown heading');

console.log('\nWriting changes...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? ALL POLISH ADJUSTMENTS COMPLETE!');
console.log('\nChanges made:');
console.log('1. ? Increased header bottom padding (pb-12)');
console.log('2. ? Counters now display in one line on all screen sizes');
console.log('3. ? Category Breakdown heading is centered');
console.log('\n?? Your layout is now polished and ready!');
