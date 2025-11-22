# Search Filter Fix Guide

## Problem Summary
The search filters are not working because:
1. Duplicate filter state (`filters` vs `enhancedFilters`)
2. `buildExpenseQuery()` only uses basic filters, ignoring search/dates/amounts
3. Filter button handlers don't update enhanced filters
4. Enhanced filter script loads after main script initialization

## Solution: 4 Changes to `public/index.html`

---

### **CHANGE 1: Remove Duplicate Filter Object** (Line ~655)

**FIND:**
```javascript
let storageInfo = { storageMode: 'sqlite', libsqlUrl: null };
const filters = { session_term: '', category: '', status: '' };
```

**REPLACE WITH:**
```javascript
let storageInfo = { storageMode: 'sqlite', libsqlUrl: null };
// REMOVED: const filters = { session_term: '', category: '', status: '' };
// Now using enhancedFilters from filter-enhancements.js as single source of truth
```

---

### **CHANGE 2: Update buildExpenseQuery()** (Line ~730)

**FIND:**
```javascript
const buildExpenseQuery = () => {
    const params = new URLSearchParams();
    if (filters.session_term) params.append('session_term', filters.session_term);
    if (filters.category) params.append('category', filters.category);
    if (filters.status) params.append('status', filters.status);
    const qs = params.toString();
    console.log('buildExpenseQuery - filters:', filters);
    console.log('buildExpenseQuery - query string:', qs);
    return qs ? `?${qs}` : '';
};
```

**REPLACE WITH:**
```javascript
const buildExpenseQuery = () => {
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
    return qs ? `?${qs}` : '';
};
```

---

### **CHANGE 3: Update Helper Functions** (Lines ~745-765)

**FIND:**
```javascript
const updateActiveFiltersLabel = () => {
    const label = $("#activeFilters");
    if (!label) return;
    const active = Object.entries(filters)
        .filter(([_, value]) => Boolean(value))
        .map(([key, value]) => `${key}: ${value}`);
    label.textContent = active.length ? `Active filters ? ${active.join(', ')}` : '';
};

const syncFilterInputs = () => {
    const term = $("#filterTerm");
    const category = $("#filterCategory");
    const status = $("#filterStatus");
    if (term) term.value = filters.session_term;
    if (category) category.value = filters.category;
    if (status) status.value = filters.status;
};
```

**REPLACE WITH:**
```javascript
const updateActiveFiltersLabel = () => {
    // Delegate to enhanced filter module
    if (typeof window.updateEnhancedFiltersLabel === 'function') {
        window.updateEnhancedFiltersLabel();
    }
};

const syncFilterInputs = () => {
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
};
```

---

### **CHANGE 4: Update Filter Button Handlers** (Lines ~1305-1330)

**FIND:**
```javascript
        // Filters
        $("#applyFiltersBtn").addEventListener('click', () => {
            filters.session_term = $("#filterTerm").value;
            filters.category = $("#filterCategory").value;
            filters.status = $("#filterStatus").value;
            console.log('Apply Filters clicked - filters:', filters);
            resetExpensePagination();
            updateActiveFiltersLabel();
            loadData();
        });

        $("#clearFiltersBtn").addEventListener('click', () => {
            Object.keys(filters).forEach(key => filters[key] = '');
            syncFilterInputs();
            resetExpensePagination();
            updateActiveFiltersLabel();
            loadData();
        });
```

**REPLACE WITH:**
```javascript
        // Filters - Update enhanced filters object
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
        });

        $("#clearFiltersBtn").addEventListener('click', () => {
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
        });
```

---

### **CHANGE 5: Update loadData() Filter Logging** (Line ~802)

**FIND:**
```javascript
    async function loadData() {
        try {
            console.log('=== loadData START ===');
            console.log('Current filters:', filters);
```

**REPLACE WITH:**
```javascript
    async function loadData() {
        try {
            console.log('=== loadData START ===');
            const ef = window.enhancedFilters || {};
            console.log('Current filters:', ef);
```

---

## Testing the Fix

After applying changes, test:

1. **Search Box**: Type "school" ? Wait 500ms ? Check Network tab for `?search=school`
2. **Category Filter**: Select "Home Upkeep" ? Click "Apply Filters" ? Check for `?category=Home%20Upkeep`
3. **Combined Filters**: Search + Category + Date Range ? Should see all params in URL
4. **Filter Chips**: Active filters should appear as removable chips below the buttons
5. **Clear Filters**: Click "Clear All" ? All inputs should reset

## Expected API Call Example

With search="fees", category="School Fees", minAmount=1000:
```
GET /api/expenses?search=fees&category=School%20Fees&minAmount=1000&sortBy=date_desc&pageSize=10&page=1
```

## Troubleshooting

If filters still don't work:
1. Open DevTools Console
2. Check for `buildExpenseQuery called` log
3. Verify `enhancedFilters` object exists: `console.log(window.enhancedFilters)`
4. Check Network tab for actual API call parameters
5. Ensure `filter-enhancements.js` loads before DOMContentLoaded fires

---

## Summary of Changes

? Removed duplicate `filters` object  
? Updated `buildExpenseQuery()` to use ALL filter params  
? Delegated helper functions to enhanced filter module  
? Updated filter button handlers to sync with `enhancedFilters`  
? Added comprehensive logging for debugging  

The core issue was **filter state fragmentation** - now everything uses `window.enhancedFilters` as the single source of truth.
