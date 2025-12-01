// Script to fix the logout issue
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== FIXING LOGOUT ISSUE ===\n');

// Fix 1: Ensure loadData function is defined before logout
console.log('Adding loadData function definition...');

// Find where to insert loadData function (after hydrateStorageInfo)
const insertPoint = content.indexOf('// Authentication');
if (insertPoint !== -1) {
    const loadDataFunction = `
                    // Load data function
                    async function loadData() {
                        try {
                            console.log('Loading data...');
                            const [expensesData, blogPostsData, dashboardData, budgetsData] = await Promise.all([
                                apiCall('/expenses' + buildExpenseQuery()).catch(() => []),
                                apiCall('/blog-posts').catch(() => []),
                                apiCall('/dashboard').catch(() => ({ statistics: {}, categories: [], budgets: [], alerts: [] })),
                                apiCall('/budgets').catch(() => [])
                            ]);

                            expenses = Array.isArray(expensesData) ? expensesData : [];
                            blogPosts = Array.isArray(blogPostsData) ? blogPostsData : [];
                            budgets = Array.isArray(budgetsData) ? budgetsData : [];
                            budgetAlerts = dashboardData.alerts || [];

                            renderExpenses();
                            renderBlogPosts();
                            renderDashboard(dashboardData);
                            renderBudgetsTable();
                            fillBudgetCategoryOptions();
                            announceBudgetAlerts();
                            updateExpensePaginationUI();
                            
                            console.log('Data loaded successfully');
                        } catch (error) {
                            console.error('Error loading data:', error);
                            notify('Error loading data: ' + (error.message || 'Unknown error'), true);
                        }
                    }

                    `;
    
    content = content.substring(0, insertPoint) + loadDataFunction + content.substring(insertPoint);
    console.log('? loadData function added');
}

// Fix 2: Update the logout button event listener to ensure it fires properly
console.log('Fixing logout button event listener...');
content = content.replace(
    /\$\("#logoutBtn"\)\.addEventListener\('click', logout\);/g,
    `$("#logoutBtn").addEventListener('click', async (e) => {
                            e.preventDefault();
                            console.log('Logout button clicked');
                            await logout();
                        });`
);
console.log('? Logout button event listener fixed');

// Fix 3: Make sure the theme toggle button is visible
console.log('Making theme toggle visible...');
content = content.replace(
    /<button id="themeToggle"[^>]*class="bg-white rounded-full p-3 shadow hidden"><\/button>/,
    '<button id="themeToggle" aria-label="Toggle theme" title="Toggle theme" style="position:fixed;top:1rem;right:1rem;z-index:60" class="bg-white rounded-full p-3 shadow"></button>'
);
console.log('? Theme toggle visibility fixed');

console.log('\nWriting updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? Logout issue fixed successfully!');
console.log('\nWhat was fixed:');
console.log('1. ? Added missing loadData() function definition');
console.log('2. ? Fixed logout button event listener to properly handle async');
console.log('3. ? Made theme toggle button visible by default');
console.log('\n?? Please restart your server and test the logout functionality');
