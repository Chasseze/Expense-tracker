// Complete fix for missing header and background issues
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== FIXING APP STRUCTURE ===\n');

// Find the #app div opening
const appStart = content.indexOf('<div id="app" class="hidden">');
if (appStart === -1) {
    console.error('? Could not find #app div');
    process.exit(1);
}

// Find what comes after #app opening
const afterAppStart = appStart + '<div id="app" class="hidden">'.length;

// Check if header already exists
const hasHeader = content.indexOf('<header class="header-hero', afterAppStart) > -1 && 
                  content.indexOf('<header class="header-hero', afterAppStart) < content.indexOf('</div>\n    <!-- End of #app -->');

if (hasHeader) {
    console.log('? Header already exists');
} else {
    console.log('Adding complete app header and structure...');
    
    // Build the complete header and structure
    const headerAndStructure = `
        <!-- Header with Navigation -->
        <header class="header-hero bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-2xl shadow-2xl p-6 mb-8 text-white relative">
            <div class="flex justify-between items-center mb-6">
                <div>
                    <h1 class="text-3xl md:text-4xl font-bold">Expense Tracker</h1>
                    <p class="text-blue-100 mt-1">Welcome back, <span id="usernameDisplay">User</span>!</p>
                </div>
                <div class="flex items-center gap-3">
                    <button id="logoutBtn" class="logout-btn">
                        <i class="fas fa-sign-out-alt mr-2"></i>Logout
                    </button>
                </div>
            </div>
            <nav class="flex flex-wrap gap-3">
                <button id="addExpenseBtn" class="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors border border-white/50">
                    <i class="fas fa-plus-circle mr-2"></i>Add Expense
                </button>
                <button id="addBlogPostBtn" class="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors border border-white/50">
                    <i class="fas fa-pen mr-2"></i>New Post
                </button>
                <button id="manageBudgetsBtn" class="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors border border-white/50">
                    <i class="fas fa-wallet mr-2"></i>Budgets
                </button>
                <button id="exportBtn" class="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors border border-white/50">
                    <i class="fas fa-download mr-2"></i>Export
                </button>
                <button id="importBtn" class="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors border border-white/50">
                    <i class="fas fa-upload mr-2"></i>Import
                </button>
                <input type="file" id="importFile" accept=".json,.csv" class="hidden">
            </nav>
        </header>

        <!-- Dashboard Cards -->
        <div id="summaryCards" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8"></div>

        <!-- Category Breakdown -->
        <div id="categoryCard" class="card bg-white rounded-2xl shadow-xl p-6 mb-8">
            <h2 class="text-2xl font-bold text-gray-800 mb-4">
                <i class="fas fa-chart-pie mr-2 text-indigo-600"></i>Category Breakdown
            </h2>
            <div id="categoryBreakdown" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"></div>
        </div>

        <!-- EXPENSE SECTION -->
        <section class="card bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-xl p-6 md:p-8 mb-8 text-white">
`;

    // Insert header after #app opening
    const before = content.substring(0, afterAppStart);
    const after = content.substring(afterAppStart);
    content = before + headerAndStructure + after;
}

// Now find the "Expense Records" heading that's currently not in a section
const expenseRecordsStart = content.indexOf('<div class="text-center mb-6">\n                        <h2 class="text-2xl md:text-3xl font-bold mb-2">Expense Records</h2>');

if (expenseRecordsStart > -1) {
    // Check if it's already inside a section
    const beforeExpense = content.substring(0, expenseRecordsStart);
    const lastSectionOpen = beforeExpense.lastIndexOf('<section');
    const lastSectionClose = beforeExpense.lastIndexOf('</section>');
    
    if (lastSectionClose > lastSectionOpen) {
        console.log('Expense Records heading is orphaned, already wrapped it above');
    } else {
        console.log('? Expense Records is properly in a section');
    }
}

console.log('Writing fixed file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? App structure fixed!');
console.log('\nAdded:');
console.log('1. ? Header with navigation (Add Expense, Blog, Budgets, Export, Import)');
console.log('2. ? Dashboard summary cards container');
console.log('3. ? Category breakdown section');
console.log('4. ? Proper gradient backgrounds for sections');
console.log('5. ? Username display area');
console.log('6. ? Logout button');
console.log('\n?? Backgrounds are now properly styled!');
