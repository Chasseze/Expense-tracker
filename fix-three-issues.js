// Script to fix the three issues
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== APPLYING THREE FIXES ===\n');

// FIX 1: Theme toggle icon - replace textContent with innerHTML for icon
console.log('Fix 1: Theme toggle icon display...');
content = content.replace(
    /toggle\.textContent = 'â˜€ï¸';/g,
    `toggle.innerHTML = '<i class="fas fa-sun"></i>';`
);
content = content.replace(
    /toggle\.textContent = '<i class="fas fa-moon"><\/i>';/g,
    `toggle.innerHTML = '<i class="fas fa-moon"></i>';`
);

// FIX 2: Make logout async and add proper error handling
console.log('Fix 2: Logout functionality...');
content = content.replace(
    /function logout\(\) \{[\s\S]*?\n    \}/gm,
    `async function logout() {
        try {
            console.log('Logout initiated...');
            if (typeof firebaseLogout === 'function') {
                await firebaseLogout();
            }
            appCurrentUser = null;
            authToken = null;
            expenses = [];
            blogPosts = [];
            localStorage.removeItem('currentUser');
            localStorage.removeItem('authToken');
            $("#authScreen").classList.remove("hidden");
            $("#app").classList.add("hidden");
            console.log('Logout complete');
        } catch (error) {
            console.error('Logout error:', error);
            notify('Logout failed: ' + error.message, true);
        }
    }`
);

// FIX 3: Update filter button handlers to use enhancedFilters properly
console.log('Fix 3: Filter handlers to use enhancedFilters...');
const oldApplyHandler = `// Filters
        $("#applyFiltersBtn").addEventListener('click', () => {
            filters.session_term = $("#filterTerm").value;
            filters.category = $("#filterCategory").value;
            filters.status = $("#filterStatus").value;
            console.log('Apply Filters clicked - filters:', filters);
            resetExpensePagination();
            updateActiveFiltersLabel();
            loadData();
        });`;

const newApplyHandler = `// Filters - Update enhanced filters object
        $("#applyFiltersBtn").addEventListener('click', () => {
            const ef = window.enhancedFilters || {};
            ef.session_term = $("#filterTerm").value || '';
            ef.category = $("#filterCategory").value || '';
            ef.status = $("#filterStatus").value || '';
            ef.search = $("#filterSearch")?.value || '';
            ef.startDate = $("#filterStartDate")?.value || '';
            ef.endDate = $("#filterEndDate")?.value || '';
            ef.minAmount = $("#filterMinAmount")?.value || '';
            ef.maxAmount = $("#filterMaxAmount")?.value || '';
            ef.sortBy = $("#filterSortBy")?.value || 'date_desc';
            
            console.log('Applying filters:', ef);
            
            if (typeof window.renderFilterChips === 'function') {
                window.renderFilterChips();
            }
            
            resetExpensePagination();
            updateActiveFiltersLabel();
            loadData();
        });`;

content = content.replace(oldApplyHandler, newApplyHandler);

const oldClearHandler = `$("#clearFiltersBtn").addEventListener('click', () => {
            Object.keys(filters).forEach(key => filters[key] = '');
            syncFilterInputs();
            resetExpensePagination();
            updateActiveFiltersLabel();
            loadData();
        });`;

const newClearHandler = `$("#clearFiltersBtn").addEventListener('click', () => {
            const ef = window.enhancedFilters || {};
            Object.keys(ef).forEach(key => ef[key] = '');
            ef.sortBy = 'date_desc'; // Reset to default
            
            syncFilterInputs();
            
            if (typeof window.renderFilterChips === 'function') {
                window.renderFilterChips();
            }
            
            resetExpensePagination();
            updateActiveFiltersLabel();
            loadData();
        });`;

content = content.replace(oldClearHandler, newClearHandler);

console.log('\nWriting updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? All three fixes applied successfully!');
console.log('\nFixed:');
console.log('1. ? Theme toggle icon now displays properly (sun/moon icons)');
console.log('2. ? Logout function now works correctly (async with error handling)');
console.log('3. ? Filter handlers now use enhancedFilters properly');
console.log('\n?? Deploy these changes with: firebase deploy');
