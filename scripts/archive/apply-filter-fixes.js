// Script to apply all search filter fixes to public/index.html
// Run this in Node.js: node apply-filter-fixes.js

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');

console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('Applying Fix 1: Remove duplicate filters object...');
// CHANGE 1: Remove duplicate filters line
content = content.replace(
    /let storageInfo = { storageMode: 'sqlite', libsqlUrl: null };[\r\n\s]*const filters = { session_term: '', category: '', status: '' };/g,
    `let storageInfo = { storageMode: 'sqlite', libsqlUrl: null };
    // REMOVED: const filters = { session_term: '', category: '', status: '' };
    // Now using enhancedFilters from filter-enhancements.js as single source of truth`
);

console.log('Applying Fix 2: Update buildExpenseQuery()...');
// CHANGE 2: Replace buildExpenseQuery function
const oldBuildQuery = `const buildExpenseQuery = () => {
        const params = new URLSearchParams();
        if (filters.session_term) params.append('session_term', filters.session_term);
        if (filters.category) params.append('category', filters.category);
        if (filters.status) params.append('status', filters.status);
        const qs = params.toString();
        console.log('buildExpenseQuery - filters:', filters);
        console.log('buildExpenseQuery - query string:', qs);
        return qs ? \`?\${qs}\` : '';
    };`;

const newBuildQuery = `const buildExpenseQuery = () => {
        console.log('buildExpenseQuery called');
        // Use the enhanced query builder from filter-enhancements.js
        if (typeof window.buildEnhancedExpenseQuery === 'function') {
            return window.buildEnhancedExpenseQuery();
        }
        
        // Fallback to building manually with enhancedFilters
        const ef = window.enhancedFilters || {};
        const params = new URLSearchParams();
        
        if (ef.session_term) params.append('session_term', ef.session_term);
        if (ef.category) params.append('category', ef.category);
        if (ef.status) params.append('status', ef.status);
        if (ef.search) params.append('search', ef.search);
        if (ef.startDate) params.append('startDate', ef.startDate);
        if (ef.endDate) params.append('endDate', ef.endDate);
        if (ef.minAmount) params.append('minAmount', ef.minAmount);
        if (ef.maxAmount) params.append('maxAmount', ef.maxAmount);
        if (ef.sortBy) params.append('sortBy', ef.sortBy);
        
        const qs = params.toString();
        console.log('Built query string:', qs);
        return qs ? \`?\${qs}\` : '';
    };`;

content = content.replace(oldBuildQuery, newBuildQuery);

console.log('Applying Fix 3: Update helper functions...');
// CHANGE 3: Replace updateActiveFiltersLabel
const oldUpdateLabel = `const updateActiveFiltersLabel = () => {
        const label = $("#activeFilters");
        if (!label) return;
        const active = Object.entries(filters)
            .filter(([_, value]) => Boolean(value))
            .map(([key, value]) => \`\${key}: \${value}\`);
        label.textContent = active.length ? \`Active filters â†' \${active.join(', ')}\` : '';
    };`;

const newUpdateLabel = `const updateActiveFiltersLabel = () => {
        // Delegate to enhanced filter module
        if (typeof window.updateEnhancedFiltersLabel === 'function') {
            window.updateEnhancedFiltersLabel();
        }
    };`;

content = content.replace(oldUpdateLabel, newUpdateLabel);

// CHANGE 3b: Replace syncFilterInputs
const oldSyncInputs = `const syncFilterInputs = () => {
        const term = $("#filterTerm");
        const category = $("#filterCategory");
        const status = $("#filterStatus");
        if (term) term.value = filters.session_term;
        if (category) category.value = filters.category;
        if (status) status.value = filters.status;
    };`;

const newSyncInputs = `const syncFilterInputs = () => {
        // Delegate to enhanced filter module
        if (typeof window.syncEnhancedFilterInputs === 'function') {
            window.syncEnhancedFilterInputs();
        } else {
            // Fallback
            const ef = window.enhancedFilters || {};
            const term = $("#filterTerm");
            const category = $("#filterCategory");
            const status = $("#filterStatus");
            if (term) term.value = ef.session_term || '';
            if (category) category.value = ef.category || '';
            if (status) status.value = ef.status || '';
        }
    };`;

content = content.replace(oldSyncInputs, newSyncInputs);

console.log('Applying Fix 4: Update filter button handlers...');
// CHANGE 4: Replace applyFiltersBtn handler
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

// CHANGE 4b: Replace clearFiltersBtn handler
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

console.log('Applying Fix 5: Update loadData filter logging...');
// CHANGE 5: Update loadData logging
content = content.replace(
    /console\.log\('=== loadData START ==='\);[\r\n\s]*console\.log\('Current filters:', filters\);/g,
    `console.log('=== loadData START ===');
            const ef = window.enhancedFilters || {};
            console.log('Current filters:', ef);`
);

console.log('Writing updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? All fixes applied successfully!');
console.log('\nChanges made:');
console.log('1. ? Removed duplicate filters object');
console.log('2. ? Updated buildExpenseQuery() to use ALL filter params');
console.log('3. ? Updated helper functions to delegate to enhanced module');
console.log('4. ? Updated filter button handlers');
console.log('5. ? Updated loadData filter logging');
console.log('\n?? Your search filters should now work properly!');
console.log('\nNext steps:');
console.log('1. Reload your app');
console.log('2. Try the search box');
console.log('3. Check the Network tab for proper query parameters');
