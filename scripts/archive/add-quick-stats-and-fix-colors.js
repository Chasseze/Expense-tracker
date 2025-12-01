// Add Quick Stats Cards and Fix Button Colors
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== ADDING QUICK STATS & FIXING BUTTON COLORS ===\n');

// 1. Add padding-top to header title
content = content.replace(
    /<h1 class="text-4xl md:text-5xl font-bold mb-3">/,
    '<h1 class="text-4xl md:text-5xl font-bold mb-3 pt-4">'
);
console.log('? Added top padding to header title');

// 2. Fix button colors to match original
content = content.replace(
    /<button id="addBlogPostBtn" class="px-6 py-3 bg-blue-600 hover:bg-blue-700/,
    '<button id="addBlogPostBtn" class="px-6 py-3 bg-white hover:bg-gray-100 text-purple-600'
);

content = content.replace(
    /<button id="importBtn" class="px-6 py-3 bg-cyan-600 hover:bg-cyan-700/,
    '<button id="importBtn" class="px-6 py-3 bg-cyan-500 hover:bg-cyan-600'
);

content = content.replace(
    /<button id="manageBudgetsBtn" class="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 rounded-xl/,
    '<button id="manageBudgetsBtn" class="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-gray-900 rounded-xl'
);
console.log('? Fixed button colors to match original design');

// 3. Add moon icon button before logout
content = content.replace(
    /<span class="text-2xl">??<\/span>/,
    `<button id="themeToggleBtn" class="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-all">
                    <i class="fas fa-moon text-xl"></i>
                </button>`
);
console.log('? Added theme toggle button (moon icon)');

// 4. Insert Quick Stats Cards after header, before Dashboard Cards
const quickStatsHTML = `
        <!-- Quick Stats Cards (Total Paid, Balance Due, Total Expenses) -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-xl p-6 text-white">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-green-100 text-sm mb-1">Total Paid</p>
                        <p id="quickTotalPaid" class="text-4xl font-bold">?0.00</p>
                    </div>
                    <i class="fas fa-money-bill-wave text-6xl text-white/30"></i>
                </div>
            </div>
            <div class="bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl shadow-xl p-6 text-white">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-orange-100 text-sm mb-1">Total Balance Due</p>
                        <p id="quickBalanceDue" class="text-4xl font-bold">?0.00</p>
                    </div>
                    <i class="fas fa-calendar-minus text-6xl text-white/30"></i>
                </div>
            </div>
            <div class="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl p-6 text-white">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-blue-100 text-sm mb-1">Total Expenses</p>
                        <p id="quickTotalExpenses" class="text-4xl font-bold">0</p>
                    </div>
                    <i class="fas fa-file-invoice-dollar text-6xl text-white/30"></i>
                </div>
            </div>
        </div>
`;

// Find where to insert (before Dashboard Cards)
const dashboardCardsMarker = '        <!-- Dashboard Cards -->';
content = content.replace(dashboardCardsMarker, quickStatsHTML + '\n' + dashboardCardsMarker);
console.log('? Added Quick Stats cards section');

// 5. Update renderDashboard function to also update quick stats
const renderDashboardPattern = /function renderDashboard\(dashboard\) \{[\s\S]*?const \{ statistics, categories \} = dashboard;/;

if (renderDashboardPattern.test(content)) {
    content = content.replace(
        /const \{ statistics, categories \} = dashboard;/,
        `const { statistics, categories } = dashboard;
                        
                        // Update quick stats cards
                        const quickPaid = document.getElementById('quickTotalPaid');
                        const quickBalance = document.getElementById('quickBalanceDue');
                        const quickExpenses = document.getElementById('quickTotalExpenses');
                        
                        if (quickPaid) quickPaid.textContent = fmtMoney(statistics.total_paid);
                        if (quickBalance) quickBalance.textContent = fmtMoney(statistics.total_balance);
                        if (quickExpenses) quickExpenses.textContent = statistics.total_expenses;`
    );
    console.log('? Updated renderDashboard to populate quick stats');
}

console.log('\nWriting fixed file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? ALL FIXES APPLIED!');
console.log('\nChanges made:');
console.log('1. ? Added top padding to header title');
console.log('2. ? Fixed button colors (Write Blog Post = white/purple, Import = cyan, Manage Budgets = yellow/gray text)');
console.log('3. ? Added moon icon theme toggle button');
console.log('4. ? Added Quick Stats cards (Total Paid, Balance Due, Total Expenses)');
console.log('5. ? Connected quick stats to renderDashboard function');
console.log('\n?? Your header now matches the original design exactly!');
console.log('?? Quick stats will update automatically when data loads!');
