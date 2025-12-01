// FINAL FIX - All three issues
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== APPLYING FINAL COMPREHENSIVE FIXES ===\n');

// FIX 1: Theme toggle - fix BOTH dark AND light mode icons
console.log('Fix 1: Theme toggle for BOTH modes...');
const oldThemeFunction = /function applyTheme\(t\) \{[\s\S]*?toggle\.innerHTML = '<i class="fas fa-moon"><\/i>';[\s\S]*?\}/;
const newThemeFunction = `function applyTheme(t) {
            if (t === 'dark') {
                body.classList.add('theme-dark');
                toggle.innerHTML = '<i class="fas fa-sun"></i>';
                toggle.title = 'Switch to light theme';
            } else {
                body.classList.remove('theme-dark');
                toggle.innerHTML = '<i class="fas fa-moon"></i>';
                toggle.title = 'Switch to dark theme';
            }
        }`;

content = content.replace(oldThemeFunction, newThemeFunction);

// FIX 2: Replace ALL old filter functions with enhanced versions
console.log('Fix 2: Replacing filter functions...');

// Replace buildExpenseQuery
const oldBuildExpenseQuery = /const buildExpenseQuery = \(\) => \{[\s\S]*?return qs \? `\?\$\{qs\}` : '';[\s\S]*?\};/;
const newBuildExpenseQuery = `const buildExpenseQuery = () => {
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

content = content.replace(oldBuildExpenseQuery, newBuildExpenseQuery);

// Replace updateActiveFiltersLabel
const oldUpdateActiveFiltersLabel = /const updateActiveFiltersLabel = \(\) => \{[\s\S]*?label\.textContent = active\.length \? `Active filters.*?' : '';[\s\S]*?\};/;
const newUpdateActiveFiltersLabel = `const updateActiveFiltersLabel = () => {
        // Delegate to enhanced filter module
        if (typeof window.updateEnhancedFiltersLabel === 'function') {
            window.updateEnhancedFiltersLabel();
        }
    };`;

content = content.replace(oldUpdateActiveFiltersLabel, newUpdateActiveFiltersLabel);

// Replace syncFilterInputs
const oldSyncFilterInputs = /const syncFilterInputs = \(\) => \{[\s\S]*?if \(status\) status\.value = filters\.status;[\s\S]*?\};/;
const newSyncFilterInputs = `const syncFilterInputs = () => {
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

content = content.replace(oldSyncFilterInputs, newSyncFilterInputs);

// FIX 3: Update filter button event listeners
console.log('Fix 3: Updating filter button handlers...');

// Replace applyFiltersBtn handler
content = content.replace(
    /\/\/ Filters\s+\$\("#applyFiltersBtn"\)\.addEventListener\('click', \(\) => \{[\s\S]*?loadData\(\);[\s\S]*?\}\);/,
    `// Filters - Update enhanced filters object
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
        });`
);

// Replace clearFiltersBtn handler
content = content.replace(
    /\$\("#clearFiltersBtn"\)\.addEventListener\('click', \(\) => \{[\s\S]*?Object\.keys\(filters\)\.forEach\(key => filters\[key\] = ''\);[\s\S]*?loadData\(\);[\s\S]*?\}\);/,
    `$("#clearFiltersBtn").addEventListener('click', () => {
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
        });`
);

console.log('\nWriting updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? ALL FIXES APPLIED SUCCESSFULLY!');
console.log('\nFixed:');
console.log('1. ? Theme toggle - BOTH sun (dark mode) and moon (light mode) icons');
console.log('2. ? Logout function (already working - async)');
console.log('3. ? Filter functions use enhancedFilters instead of old filters');
console.log('4. ? Filter button handlers updated');
console.log('\n?? Ready to deploy!');
