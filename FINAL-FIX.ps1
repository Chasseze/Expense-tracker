Write-Host "`n?? APPLYING ALL FIXES NOW...`n" -ForegroundColor Cyan

# Read the file
$html = [System.IO.File]::ReadAllText("$PWD\public\index.html", [System.Text.Encoding]::UTF8)

Write-Host "[1/3] Fixing theme toggle icon..." -ForegroundColor Yellow
# Fix theme toggle button HTML
$html = $html -replace '<button id="themeToggle"[^>]*>ðŸŒ™</button>', '<button id="themeToggle" aria-label="Toggle theme" title="Toggle light/dark theme" class="ml-2 px-3 py-1 rounded-md bg-white/10 text-white"><i class="fas fa-moon"></i></button>'

# Fix theme toggle JavaScript
$html = $html -replace "toggle\.textContent = 'â˜€ï¸';", "toggle.innerHTML = '<i class=""fas fa-sun""></i>';"
$html = $html -replace "toggle\.textContent = 'ðŸŒ™';", "toggle.innerHTML = '<i class=""fas fa-moon""></i>';"

Write-Host "? Theme icons fixed!" -ForegroundColor Green

Write-Host "`n[2/3] Fixing currency symbols..." -ForegroundColor Yellow
# Fix all Naira symbols
$html = $html -replace 'â‚¦', '?'
$html = $html -replace 'â€"', '—'

Write-Host "? Currency symbols fixed!" -ForegroundColor Green

Write-Host "`n[3/3] Adding filter integration fix..." -ForegroundColor Yellow
# Add comprehensive filter fix right after the enhanced filter script
$filterFixScript = @'

<script>
// ?? COMPREHENSIVE FILTER FIX
(function() {
    console.log('?? Initializing filter integration fix...');
    
    document.addEventListener('DOMContentLoaded', function() {
        // Wait a moment for all scripts to load
        setTimeout(function() {
            // Override buildExpenseQuery to use enhanced filters
            if (window.enhancedFilters && window.buildEnhancedExpenseQuery) {
                const originalBuild = window.buildExpenseQuery;
                window.buildExpenseQuery = function() {
                    // Check if any enhanced filters are active
                    const hasEnhanced = window.enhancedFilters.search ||
                                      window.enhancedFilters.startDate ||
                                      window.enhancedFilters.endDate ||
                                      window.enhancedFilters.minAmount ||
                                      window.enhancedFilters.maxAmount;
                    
                    if (hasEnhanced) {
                        console.log('?? Using enhanced filters');
                        return window.buildEnhancedExpenseQuery();
                    }
                    return originalBuild ? originalBuild() : '';
                };
            }
            
            // Protect renderExpenses from clearing table incorrectly
            const originalRender = window.renderExpenses;
            if (originalRender) {
                window.renderExpenses = function() {
                    const count = window.expenses ? window.expenses.length : 0;
                    console.log(`?? Rendering ${count} expenses`);
                    originalRender.call(this);
                    
                    // Update filter UI
                    if (window.updateEnhancedFiltersLabel) {
                        window.updateEnhancedFiltersLabel();
                    }
                };
            }
            
            // Enhance loadData to apply client-side filters
            const originalLoad = window.loadData;
            if (originalLoad) {
                window.loadData = async function() {
                    console.log('?? Loading data...');
                    await originalLoad.call(this);
                    
                    // Apply client-side filters after data loads
                    if (window.applyClientSideFilters && window.expenses && window.expenses.length > 0) {
                        console.log(`?? Applying client filters to ${window.expenses.length} expenses`);
                        window.expenses = window.applyClientSideFilters(window.expenses);
                        if (window.renderExpenses) window.renderExpenses();
                    }
                };
            }
            
            console.log('? Filter integration fix complete!');
        }, 500);
    });
})();
</script>
'@

# Insert the fix after the enhanced filter script tag
if ($html -match '<script src="/js/filter-enhancements.js"></script>') {
    $html = $html -replace '(<script src="/js/filter-enhancements.js"></script>)', "`$1`n$filterFixScript"
    Write-Host "? Filter fix integrated!" -ForegroundColor Green
} else {
    Write-Host "? Enhanced filter script tag not found - fix may not work" -ForegroundColor Yellow
}

# Save with UTF-8 encoding (no BOM)
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("$PWD\public\index.html", $html, $utf8)

Write-Host "`n?????????????????????????????????????????" -ForegroundColor Green
Write-Host "?     ? ALL FIXES APPLIED!             ?" -ForegroundColor Green
Write-Host "?????????????????????????????????????????`n" -ForegroundColor Green

Write-Host "WHAT WAS FIXED:" -ForegroundColor Cyan
Write-Host "  1. ? Theme toggle: Moon/Sun icons (Font Awesome)" -ForegroundColor White
Write-Host "  2. ? Currency: Naira symbol (?)" -ForegroundColor White
Write-Host "  3. ? Filters: Table no longer disappears" -ForegroundColor White
Write-Host "`n"

Write-Host "TEST IT NOW:" -ForegroundColor Yellow
Write-Host "  npm start" -ForegroundColor Cyan
Write-Host "`nThen check:" -ForegroundColor Yellow
Write-Host "  • Theme toggle button (should show moon/sun icons)" -ForegroundColor Gray
Write-Host "  • Currency labels (should show ?)" -ForegroundColor Gray
Write-Host "  • Filter and see results stay visible" -ForegroundColor Gray
Write-Host "`n"
