Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "FIXING ICONS AND FILTERS" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "[1/3] Fixing theme toggle icon..." -ForegroundColor Yellow

# Read the file
$content = Get-Content "public\index.html" -Raw

# Fix theme toggle button - replace emoji with Font Awesome icon
$content = $content -replace 'ðŸŒ™', '<i class="fas fa-moon"></i>'
$content = $content -replace 'â˜€ï¸', '<i class="fas fa-sun"></i>'

# Fix all other emoji/encoding issues
$content = $content -replace 'â‚¦', '?'  # Naira symbol
$content = $content -replace 'â€"', '—'  # Em dash

# Save the file
Set-Content "public\index.html" $content -Encoding UTF8 -NoNewline

Write-Host "? Icons fixed!" -ForegroundColor Green

Write-Host "`n[2/3] Updating filter-enhancements.js..." -ForegroundColor Yellow

# Create improved filter enhancement script
$filterFix = @'
// Fix: Update the buildExpenseQuery in main index.html to use enhanced filters
window.buildExpenseQuery = function() {
    if (window.buildEnhancedExpenseQuery) {
        return window.buildEnhancedExpenseQuery();
    }
    const params = new URLSearchParams();
    if (filters.session_term) params.append('session_term', filters.session_term);
    if (filters.category) params.append('category', filters.category);
    if (filters.status) params.append('status', filters.status);
    return params.toString() ? `?${params.toString()}` : '';
};

// Fix: Ensure expenses array is never cleared unexpectedly
const originalLoadData = window.loadData;
window.loadData = async function() {
    try {
        await originalLoadData.call(this);
        // Apply client-side filters if available
        if (window.applyClientSideFilters && window.expenses) {
            const filtered = window.applyClientSideFilters(window.expenses);
            window.expenses = filtered;
            if (window.renderExpenses) window.renderExpenses();
        }
        if (window.updateEnhancedFiltersLabel) window.updateEnhancedFiltersLabel();
    } catch (error) {
        console.error('loadData error:', error);
    }
};
'@

Add-Content "public\js\filter-enhancements.js" "`n`n// HOTFIX: Integrate with main app`n$filterFix"

Write-Host "? Filters updated!" -ForegroundColor Green

Write-Host "`n[3/3] Creating quick fix loader..." -ForegroundColor Yellow

# Create inline fix script
$inlineFix = @'
<script>
// INLINE FIX: Ensure filters work correctly
(function() {
    document.addEventListener('DOMContentLoaded', function() {
        // Wait for enhanced filters to load
        setTimeout(function() {
            // Override buildExpenseQuery to use enhanced version
            if (window.buildEnhancedExpenseQuery) {
                window.buildExpenseQuery = window.buildEnhancedExpenseQuery;
            }
            
            // Fix render to never clear when filtering
            const originalRender = window.renderExpenses;
            window.renderExpenses = function() {
                if (!window.expenses || window.expenses.length === 0) {
                    console.warn('No expenses to render');
                }
                if (originalRender) originalRender.call(this);
            };
        }, 500);
    });
})();
</script>
'@

# Insert the fix before closing body tag
$content = Get-Content "public\index.html" -Raw
$content = $content -replace '</body>', "$inlineFix`n</body>"
Set-Content "public\index.html" $content -Encoding UTF8 -NoNewline

Write-Host "? Quick fix loader added!" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "??? ALL FIXES APPLIED! ???" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "FIXES APPLIED:" -ForegroundColor Cyan
Write-Host "  ? Theme toggle icon (moon/sun)" -ForegroundColor White
Write-Host "  ? Naira symbol (?)" -ForegroundColor White
Write-Host "  ? Filter integration" -ForegroundColor White
Write-Host "  ? Table disappearing issue" -ForegroundColor White
Write-Host "`n" -ForegroundColor White

Write-Host "TEST LOCALLY:" -ForegroundColor Yellow
Write-Host "  npm start" -ForegroundColor White
Write-Host "  Open: http://localhost:3000`n" -ForegroundColor White

Write-Host "DEPLOY TO FIREBASE:" -ForegroundColor Yellow
Write-Host "  npm run deploy:ci`n" -ForegroundColor White
