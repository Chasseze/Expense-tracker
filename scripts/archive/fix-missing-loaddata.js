// Fix the missing loadData function
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== FIXING MISSING loadData FUNCTION ===\n');

// Find where to insert the loadData function (right after hydrateStorageInfo)
const insertAfter = 'async function hydrateStorageInfo()';
const insertPoint = content.indexOf(insertAfter);

if (insertPoint === -1) {
    console.error('? Could not find insertion point!');
    process.exit(1);
}

// Find the end of hydrateStorageInfo function
const funcStart = content.indexOf('{', insertPoint);
let braceCount = 1;
let funcEnd = funcStart + 1;

while (braceCount > 0 && funcEnd < content.length) {
    if (content[funcEnd] === '{') braceCount++;
    if (content[funcEnd] === '}') braceCount--;
    funcEnd++;
}

// Insert the loadData function right after hydrateStorageInfo
const loadDataFunction = `

                    // Load all data
                    async function loadData() {
                        try {
                            console.log('Loading data...');
                            
                            const query = buildExpenseQuery();
                            console.log('Query:', query);
                            
                            const [expensesData, blogPostsData, dashboardData, budgetsData] = await Promise.all([
                                apiCall('/expenses' + query).catch(err => { console.error('Expenses error:', err); return []; }),
                                apiCall('/blog-posts').catch(err => { console.error('Blog posts error:', err); return []; }),
                                apiCall('/dashboard').catch(err => { console.error('Dashboard error:', err); return { statistics: {}, categories: [], budgets: [], alerts: [] }; }),
                                apiCall('/budgets').catch(err => { console.error('Budgets error:', err); return []; })
                            ]);

                            expenses = Array.isArray(expensesData) ? expensesData : [];
                            blogPosts = Array.isArray(blogPostsData) ? blogPostsData : [];
                            budgets = Array.isArray(budgetsData) ? budgetsData : [];
                            budgetAlerts = dashboardData.alerts || [];

                            console.log('Data loaded:', {
                                expenses: expenses.length,
                                blogPosts: blogPosts.length,
                                budgets: budgets.length,
                                alerts: budgetAlerts.length
                            });

                            renderExpenses();
                            renderBlogPosts();
                            renderDashboard(dashboardData);
                            renderBudgetsTable();
                            fillBudgetCategoryOptions();
                            announceBudgetAlerts();
                            updateExpensePaginationUI();
                            
                            console.log('? Data loaded and rendered successfully');
                        } catch (error) {
                            console.error('? Error loading data:', error);
                            notify('Error loading data: ' + (error.message || 'Unknown error'), true);
                        }
                    }
`;

content = content.substring(0, funcEnd) + loadDataFunction + content.substring(funcEnd);

// Also fix the close modal event listeners (there's a syntax error)
content = content.replace(
    /\$\("#closeExpenseModal"\)\.addEventListener\('click,/g,
    '$("#closeExpenseModal").addEventListener(\'click\','
);

console.log('Writing updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? Fixed successfully!');
console.log('\nWhat was fixed:');
console.log('1. ? Added missing loadData() function');
console.log('2. ? Fixed modal close event listener syntax error');
console.log('\n?? Please restart your server: npm start');
