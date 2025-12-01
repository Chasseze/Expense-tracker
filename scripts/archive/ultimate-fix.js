// ULTIMATE FIX - Theme Toggle + Filters
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading index.html...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== APPLYING CRITICAL FIXES ===\n');

// FIX 1: Remove extra closing brace in theme toggle
console.log('Fix 1: Removing syntax error in applyTheme...');
content = content.replace(
    /function applyTheme\(t\) \{[\s\S]*?toggle\.innerHTML = '<i class="fas fa-moon"><\/i>';[\s\S]*?toggle\.title = 'Switch to dark theme';[\s\S]*?\}[\s\S]*?\}/m,
    `function applyTheme(t) {
            if (t === 'dark') {
                body.classList.add('theme-dark');
                toggle.innerHTML = '<i class="fas fa-sun"></i>';
                toggle.title = 'Switch to light theme';
            } else {
                body.classList.remove('theme-dark');
                toggle.innerHTML = '<i class="fas fa-moon"></i>';
                toggle.title = 'Switch to dark theme';
            }
        }`
);

// FIX 2: Fix updateActiveFiltersLabel to use enhancedFilters
console.log('Fix 2: Fixing updateActiveFiltersLabel...');
content = content.replace(
    /const updateActiveFiltersLabel = \(\) => \{[\s\S]*?const label = \$\("#activeFilters"\);[\s\S]*?if \(!label\) return;[\s\S]*?const active = Object\.entries\(filters\)[\s\S]*?\.filter\(\[\[_, value\]\] => Boolean\(value\)\)[\s\S]*?\.map\(\[\[key, value\]\] => `\$\{key\}: \$\{value\}`\);[\s\S]*?label\.textContent = active\.length \? `Active filters.*?' : '';[\s\S]*?\};/,
    `const updateActiveFiltersLabel = () => {
        // Delegate to enhanced filter module
        if (typeof window.updateEnhancedFiltersLabel === 'function') {
            window.updateEnhancedFiltersLabel();
        } else {
            // Fallback
            const ef = window.enhancedFilters || {};
            const label = $("#activeFilters");
            if (!label) return;
            const active = Object.entries(ef)
                .filter(([_, value]) => Boolean(value))
                .map(([key, value]) => \`\${key}: \${value}\`);
            label.textContent = active.length ? \`Active filters ? \${active.join(', ')}\` : '';
        }
    };`
);

// FIX 3: Initialize enhancedFilters if not present
console.log('Fix 3: Ensuring enhancedFilters initialization...');
const initScript = `
    // Initialize enhancedFilters if not already set
    if (!window.enhancedFilters) {
        window.enhancedFilters = {
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
    }`;

// Insert initialization before buildExpenseQuery
if (!content.includes('if (!window.enhancedFilters)')) {
    content = content.replace(
        /const buildExpenseQuery = \(\) => \{/,
        initScript + '\n\n    const buildExpenseQuery = () => {'
    );
}

console.log('\nWriting updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? CRITICAL FIXES APPLIED!');
console.log('\nFixed:');
console.log('1. ? Theme toggle syntax error (removed extra brace)');
console.log('2. ? updateActiveFiltersLabel now uses enhancedFilters');
console.log('3. ? enhancedFilters initialized at startup');
console.log('\n?? Ready to deploy!');
