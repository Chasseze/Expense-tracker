// Enhanced Filter Functionality for Expense Tracker
// This module provides advanced filtering, search, and preset management

// Extended filter state with new fields
const enhancedFilters = {
    session_term: '',
    category: '',
    status: '',
    search: '',
    startDate: '',
    endDate: '',
    minAmount: '',
    maxAmount: '',
    sortBy: 'date_desc'
};

let searchDebounceTimer = null;
let filterPresets = [];

// Load filter presets from localStorage
function loadFilterPresets() {
    try {
        const stored = localStorage.getItem('expenseFilterPresets');
        filterPresets = stored ? JSON.parse(stored) : [];
        return filterPresets;
    } catch (err) {
        console.warn('Failed to load filter presets:', err);
        return [];
    }
}

// Save filter presets to localStorage
function saveFilterPresets() {
    try {
        localStorage.setItem('expenseFilterPresets', JSON.stringify(filterPresets));
    } catch (err) {
        console.warn('Failed to save filter presets:', err);
    }
}

// Build query string with all filters including new ones
function buildEnhancedExpenseQuery() {
    const params = new URLSearchParams();
    
    if (enhancedFilters.session_term) params.append('session_term', enhancedFilters.session_term);
    if (enhancedFilters.category) params.append('category', enhancedFilters.category);
    if (enhancedFilters.status) params.append('status', enhancedFilters.status);
    if (enhancedFilters.search) params.append('search', enhancedFilters.search);
    if (enhancedFilters.startDate) params.append('startDate', enhancedFilters.startDate);
    if (enhancedFilters.endDate) params.append('endDate', enhancedFilters.endDate);
    if (enhancedFilters.minAmount) params.append('minAmount', enhancedFilters.minAmount);
    if (enhancedFilters.maxAmount) params.append('maxAmount', enhancedFilters.maxAmount);
    if (enhancedFilters.sortBy) params.append('sortBy', enhancedFilters.sortBy);
    
    const qs = params.toString();
    console.log('buildEnhancedExpenseQuery - filters:', enhancedFilters);
    console.log('buildEnhancedExpenseQuery - query string:', qs);
    return qs ? `?${qs}` : '';
}

// Client-side filtering for search and amount range (since backend may not support these yet)
function applyClientSideFilters(expenses) {
    let filtered = [...expenses];
    
    // Text search across multiple fields
    if (enhancedFilters.search) {
        const searchLower = enhancedFilters.search.toLowerCase();
        filtered = filtered.filter(expense => {
            return (
                (expense.description && expense.description.toLowerCase().includes(searchLower)) ||
                (expense.recipient && expense.recipient.toLowerCase().includes(searchLower)) ||
                (expense.category && expense.category.toLowerCase().includes(searchLower)) ||
                (expense.session_term && expense.session_term.toLowerCase().includes(searchLower))
            );
        });
    }
    
    // Amount range filtering
    if (enhancedFilters.minAmount) {
        const min = parseFloat(enhancedFilters.minAmount);
        filtered = filtered.filter(expense => {
            const total = (expense.amount_paid || 0) + (expense.balance_due || 0);
            return total >= min;
        });
    }
    
    if (enhancedFilters.maxAmount) {
        const max = parseFloat(enhancedFilters.maxAmount);
        filtered = filtered.filter(expense => {
            const total = (expense.amount_paid || 0) + (expense.balance_due || 0);
            return total <= max;
        });
    }
    
    // Client-side sorting
    filtered.sort((a, b) => {
        switch (enhancedFilters.sortBy) {
            case 'date_asc':
                return (a.date_time || '').localeCompare(b.date_time || '');
            case 'date_desc':
                return (b.date_time || '').localeCompare(a.date_time || '');
            case 'amount_asc': {
                const totalA = (a.amount_paid || 0) + (a.balance_due || 0);
                const totalB = (b.amount_paid || 0) + (b.balance_due || 0);
                return totalA - totalB;
            }
            case 'amount_desc': {
                const totalA = (a.amount_paid || 0) + (a.balance_due || 0);
                const totalB = (b.amount_paid || 0) + (b.balance_due || 0);
                return totalB - totalA;
            }
            case 'category':
                return (a.category || '').localeCompare(b.category || '');
            default:
                return (b.date_time || '').localeCompare(a.date_time || '');
        }
    });
    
    return filtered;
}

// Render filter chips for active filters
function renderFilterChips() {
    const container = document.getElementById('activeFilterChips');
    if (!container) return;
    
    const chips = [];
    
    if (enhancedFilters.search) {
        chips.push({
            label: `Search: "${enhancedFilters.search}"`,
            key: 'search'
        });
    }
    
    if (enhancedFilters.session_term) {
        chips.push({
            label: `Term: ${enhancedFilters.session_term}`,
            key: 'session_term'
        });
    }
    
    if (enhancedFilters.category) {
        chips.push({
            label: `Category: ${enhancedFilters.category}`,
            key: 'category'
        });
    }
    
    if (enhancedFilters.status) {
        chips.push({
            label: `Status: ${enhancedFilters.status}`,
            key: 'status'
        });
    }
    
    if (enhancedFilters.startDate) {
        chips.push({
            label: `From: ${enhancedFilters.startDate}`,
            key: 'startDate'
        });
    }
    
    if (enhancedFilters.endDate) {
        chips.push({
            label: `To: ${enhancedFilters.endDate}`,
            key: 'endDate'
        });
    }
    
    const money = (n) => {
        try {
            return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(n);
        } catch (e) {
            return '₦' + Number(n).toFixed(2);
        }
    };
    if (enhancedFilters.minAmount) {
        chips.push({
            label: `Min: ${money(parseFloat(enhancedFilters.minAmount))}`,
            key: 'minAmount'
        });
    }
    
    if (enhancedFilters.maxAmount) {
        chips.push({
            label: `Max: ${money(parseFloat(enhancedFilters.maxAmount))}`,
            key: 'maxAmount'
        });
    }
    
    if (chips.length === 0) {
        container.innerHTML = '';
        container.classList.add('empty:hidden');
        return;
    }
    
    container.classList.remove('empty:hidden');
    container.innerHTML = chips.map(chip => `
        <div class="chip">
            <span>${chip.label}</span>
            <button 
                class="remove-filter-chip" 
                data-filter-key="${chip.key}"
                aria-label="Remove ${chip.label} filter"
            >
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
    
    // Add click handlers for chip removal
    container.querySelectorAll('.remove-filter-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-filter-key');
            removeFilterByKey(key);
        });
    });
}

// Remove a specific filter
function removeFilterByKey(key) {
    if (key in enhancedFilters) {
        enhancedFilters[key] = '';
        syncFilterInputs();
        renderFilterChips();
        updateActiveFiltersLabel();
        // Trigger filter application
        if (window.resetExpensePagination) window.resetExpensePagination();
        if (window.loadData) window.loadData();
    }
}

// Sync enhanced filter inputs with state
function syncEnhancedFilterInputs() {
    const inputs = {
        filterSearch: enhancedFilters.search,
        filterTerm: enhancedFilters.session_term,
        filterCategory: enhancedFilters.category,
        filterStatus: enhancedFilters.status,
        filterStartDate: enhancedFilters.startDate,
        filterEndDate: enhancedFilters.endDate,
        filterMinAmount: enhancedFilters.minAmount,
        filterMaxAmount: enhancedFilters.maxAmount,
        filterSortBy: enhancedFilters.sortBy
    };
    
    Object.entries(inputs).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
}

// Update active filters label with count
function updateEnhancedFiltersLabel() {
    const label = document.getElementById('activeFilters');
    const countLabel = document.getElementById('filterResultCount');
    
    if (label) {
        const active = Object.entries(enhancedFilters)
            .filter(([key, value]) => Boolean(value) && key !== 'sortBy')
            .map(([key, value]) => {
                const displayKey = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
                return `${displayKey}: ${value}`;
            });
        
        if (active.length > 0) {
            label.textContent = `${active.length} filter${active.length > 1 ? 's' : ''} active`;
        } else {
            label.textContent = '';
        }
    }
    
    if (countLabel && window.expenses) {
        const count = window.expenses.length;
        countLabel.textContent = count > 0 ? `${count} result${count !== 1 ? 's' : ''}` : '';
    }
}

// Debounced search handler
function handleSearchInput(value) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        enhancedFilters.search = value;
        renderFilterChips();
        updateEnhancedFiltersLabel();
        if (window.resetExpensePagination) window.resetExpensePagination();
        if (window.loadData) window.loadData();
    }, 500); // 500ms debounce
}

// Save current filters as a preset
function saveFilterPreset() {
    const name = prompt('Enter a name for this filter preset:');
    if (!name || !name.trim()) return;
    
    const preset = {
        name: name.trim(),
        filters: { ...enhancedFilters },
        createdAt: new Date().toISOString()
    };
    
    // Check if preset with same name exists
    const existingIndex = filterPresets.findIndex(p => p.name === preset.name);
    if (existingIndex >= 0) {
        if (!confirm(`A preset named "${preset.name}" already exists. Overwrite it?`)) {
            return;
        }
        filterPresets[existingIndex] = preset;
    } else {
        filterPresets.push(preset);
    }
    
    saveFilterPresets();
    if (window.notify) window.notify(`Filter preset "${preset.name}" saved!`);
}

// Load a saved filter preset
function loadFilterPreset() {
    loadFilterPresets();
    
    if (filterPresets.length === 0) {
        if (window.notify) window.notify('No saved filter presets found.', true);
        return;
    }
    
    // Show preset selection modal or prompt
    const presetNames = filterPresets.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    const selection = prompt(`Select a preset by number:\n\n${presetNames}`);
    
    if (!selection) return;
    
    const index = parseInt(selection, 10) - 1;
    if (index < 0 || index >= filterPresets.length) {
        if (window.notify) window.notify('Invalid selection.', true);
        return;
    }
    
    const preset = filterPresets[index];
    Object.assign(enhancedFilters, preset.filters);
    syncEnhancedFilterInputs();
    renderFilterChips();
    updateEnhancedFiltersLabel();
    
    if (window.resetExpensePagination) window.resetExpensePagination();
    if (window.loadData) window.loadData();
    
    if (window.notify) window.notify(`Loaded preset: ${preset.name}`);
}

// Initialize enhanced filters
function initializeEnhancedFilters() {
    loadFilterPresets();
    
    // Search input with debouncing
    const searchInput = document.getElementById('filterSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            handleSearchInput(e.target.value);
        });
        
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchDebounceTimer);
                enhancedFilters.search = e.target.value;
                renderFilterChips();
                updateEnhancedFiltersLabel();
                if (window.resetExpensePagination) window.resetExpensePagination();
                if (window.loadData) window.loadData();
            }
        });
    }
    
    // Date inputs
    const startDateInput = document.getElementById('filterStartDate');
    if (startDateInput) {
        startDateInput.addEventListener('change', (e) => {
            enhancedFilters.startDate = e.target.value;
        });
    }
    
    const endDateInput = document.getElementById('filterEndDate');
    if (endDateInput) {
        endDateInput.addEventListener('change', (e) => {
            enhancedFilters.endDate = e.target.value;
        });
    }
    
    // Amount inputs
    const minAmountInput = document.getElementById('filterMinAmount');
    if (minAmountInput) {
        minAmountInput.addEventListener('change', (e) => {
            enhancedFilters.minAmount = e.target.value;
        });
    }
    
    const maxAmountInput = document.getElementById('filterMaxAmount');
    if (maxAmountInput) {
        maxAmountInput.addEventListener('change', (e) => {
            enhancedFilters.maxAmount = e.target.value;
        });
    }
    
    // Sort selector
    const sortBySelect = document.getElementById('filterSortBy');
    if (sortBySelect) {
        sortBySelect.addEventListener('change', (e) => {
            enhancedFilters.sortBy = e.target.value;
            // Sorting applies immediately without hitting server
            renderFilterChips();
            updateEnhancedFiltersLabel();
            if (window.renderExpenses) window.renderExpenses();
        });
    }
    
    // Apply filters button
    const applyBtn = document.getElementById('applyFiltersBtn');
    if (applyBtn) {
        const originalHandler = applyBtn.onclick;
        applyBtn.onclick = function(e) {
            // Update enhanced filters from all inputs
            enhancedFilters.session_term = document.getElementById('filterTerm')?.value || '';
            enhancedFilters.category = document.getElementById('filterCategory')?.value || '';
            enhancedFilters.status = document.getElementById('filterStatus')?.value || '';
            enhancedFilters.search = document.getElementById('filterSearch')?.value || '';
            enhancedFilters.startDate = document.getElementById('filterStartDate')?.value || '';
            enhancedFilters.endDate = document.getElementById('filterEndDate')?.value || '';
            enhancedFilters.minAmount = document.getElementById('filterMinAmount')?.value || '';
            enhancedFilters.maxAmount = document.getElementById('filterMaxAmount')?.value || '';
            enhancedFilters.sortBy = document.getElementById('filterSortBy')?.value || 'date_desc';
            
            renderFilterChips();
            updateEnhancedFiltersLabel();
            
            // Call original handler if exists
            if (originalHandler) originalHandler.call(this, e);
        };
    }
    
    // Clear filters button
    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
        const originalHandler = clearBtn.onclick;
        clearBtn.onclick = function(e) {
            Object.keys(enhancedFilters).forEach(key => enhancedFilters[key] = '');
            enhancedFilters.sortBy = 'date_desc'; // Reset to default
            syncEnhancedFilterInputs();
            renderFilterChips();
            updateEnhancedFiltersLabel();
            
            // Call original handler if exists
            if (originalHandler) originalHandler.call(this, e);
        };
    }
    
    // Save preset button
    const savePresetBtn = document.getElementById('saveFilterPresetBtn');
    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', saveFilterPreset);
    }
    
    // Load preset button
    const loadPresetBtn = document.getElementById('loadFilterPresetBtn');
    if (loadPresetBtn) {
        loadPresetBtn.addEventListener('click', loadFilterPreset);
    }
    
    // Initial render
    renderFilterChips();
    updateEnhancedFiltersLabel();
}

// Export functions to global scope for integration with existing code
if (typeof window !== 'undefined') {
    window.enhancedFilters = enhancedFilters;
    window.applyClientSideFilters = applyClientSideFilters;
    window.renderFilterChips = renderFilterChips;
    window.updateEnhancedFiltersLabel = updateEnhancedFiltersLabel;
    window.syncEnhancedFilterInputs = syncEnhancedFilterInputs;
    window.initializeEnhancedFilters = initializeEnhancedFilters;
    window.buildEnhancedExpenseQuery = buildEnhancedExpenseQuery;
}
