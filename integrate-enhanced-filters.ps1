Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Enhanced Filters Integration - Automatic Setup" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Read the filter preset modal content
$modalContent = Get-Content "public\filter-preset-modal.html" -Raw

# Read the current index.html
$indexContent = Get-Content "public\index.html" -Raw

# Check if already integrated
if ($indexContent -match "filter-enhancements.js") {
    Write-Host "? Enhanced filters already integrated!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Run 'npm start' to see the changes." -ForegroundColor Yellow
    exit 0
}

Write-Host "[1/5] Backing up index.html..." -ForegroundColor Yellow
Copy-Item "public\index.html" "public\index.html.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Write-Host "? Backup created" -ForegroundColor Green

Write-Host "[2/5] Adding enhanced filter scripts..." -ForegroundColor Yellow
$scriptTags = @"

    <!-- Enhanced Filter Scripts -->
    <script src="/js/filter-enhancements.js"></script>
    <script>
    // Load the preset modal content
    fetch('/filter-preset-modal.html')
        .then(response => response.text())
        .then(html => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            // Insert modal before notification div
            const notification = document.getElementById('notification');
            if (notification) {
                notification.parentNode.insertBefore(tempDiv.firstElementChild, notification);
            }
        });
    </script>
"@

# Insert scripts before </body>
$indexContent = $indexContent -replace '</body>', "$scriptTags`n</body>"
Write-Host "? Scripts added" -ForegroundColor Green

Write-Host "[3/5] Initializing enhanced filters..." -ForegroundColor Yellow
# Find the DOMContentLoaded section and add initialization
$initCode = @"

        // Initialize enhanced filters
        if (window.initializeEnhancedFilters) {
            window.initializeEnhancedFilters();
        }
        if (window.initFilterPresetModal) {
            window.initFilterPresetModal();
        }
"@

# Insert after the hydrateStorageInfo(); line in DOMContentLoaded
$indexContent = $indexContent -replace "(hydrateStorageInfo\(\);)", "`$1$initCode"
Write-Host "? Initialization added" -ForegroundColor Green

Write-Host "[4/5] Removing duplicate filter section..." -ForegroundColor Yellow
# Remove the duplicate old filter section (lines 377-419 approximately)
$pattern = '(?s)<div class="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-6">.*?<div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm items-end">.*?<span id="activeFilters" class="text-blue-100 text-xs block mt-3"></span>.*?</div>'
$indexContent = $indexContent -replace $pattern, '', 1, 'Multiline'
Write-Host "? Duplicate section removed" -ForegroundColor Green

Write-Host "[5/5] Saving updated index.html..." -ForegroundColor Yellow
Set-Content "public\index.html" $indexContent -Encoding UTF8
Write-Host "? File saved" -ForegroundColor Green

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "? Integration Complete!" -ForegroundColor Green  
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Run: npm start" -ForegroundColor White
Write-Host "2. Open: http://localhost:3000" -ForegroundColor White
Write-Host "3. Login and test the new filter features!" -ForegroundColor White
Write-Host ""
Write-Host "New Features Available:" -ForegroundColor Cyan
Write-Host "  • Full-text search" -ForegroundColor White
Write-Host "  • Date range filtering" -ForegroundColor White
Write-Host "  • Amount range filtering" -ForegroundColor White
Write-Host "  • Advanced sorting options" -ForegroundColor White
Write-Host "  • Filter chips" -ForegroundColor White
Write-Host "  • Save & load filter presets" -ForegroundColor White
Write-Host ""
Write-Host "If you encounter any issues, restore backup:" -ForegroundColor Yellow
Write-Host "  Copy-Item public\index.html.backup_* public\index.html" -ForegroundColor Gray
Write-Host ""
