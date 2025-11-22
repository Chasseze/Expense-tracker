// FINAL FIX - Pagination visibility issue
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading index.html...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== FIXING PAGINATION VISIBILITY ===\n');

// The CRITICAL FIX: updateActiveFiltersLabel still references 'filters' which doesn't exist!
console.log('Fix: Replacing updateActiveFiltersLabel to use enhancedFilters...');
const oldUpdateLabel = `const updateActiveFiltersLabel = () => {
        const label = $("#activeFilters");
        if (!label) return;
        const active = Object.entries(filters)
            .filter(([_, value]) => Boolean(value))
            .map(([key, value]) => \`\${key}: \${value}\`);
        label.textContent = active.length ? \`Active filters ? \${active.join(', ')}\` : '';
    };`;

const newUpdateLabel = `const updateActiveFiltersLabel = () => {
        // Delegate to enhanced filter module
        if (typeof window.updateEnhancedFiltersLabel === 'function') {
            window.updateEnhancedFiltersLabel();
        } else {
            // Fallback using enhancedFilters
            const ef = window.enhancedFilters || {};
            const label = $("#activeFilters");
            if (!label) return;
            const active = Object.entries(ef)
                .filter(([_, value]) => Boolean(value) && value !== 'date_desc')
                .map(([key, value]) => \`\${key.replace(/_/g, ' ')}: \${value}\`);
            label.textContent = active.length ? \`\${active.length} filter\${active.length > 1 ? 's' : ''} active\` : '';
        }
    };`;

content = content.replace(oldUpdateLabel, newUpdateLabel);

console.log('\nWriting updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? PAGINATION FIX APPLIED!');
console.log('\nWhat was fixed:');
console.log('- updateActiveFiltersLabel now correctly uses enhancedFilters');
console.log('- This fixes the JavaScript error that was preventing pagination from showing');
console.log('\n?? Deploy this fix with: firebase deploy --only hosting');
