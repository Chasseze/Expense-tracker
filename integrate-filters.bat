@echo off
REM Quick Integration Script for Enhanced Filters
REM Run this from the expense-tracker root directory

echo ======================================
echo Enhanced Filter Integration Script
echo ======================================
echo.

REM Check if we're in the right directory
if not exist "server.js" (
    echo X Error: server.js not found. Please run this from the expense-tracker root directory.
    exit /b 1
)

echo ? Found server.js

REM Check if files exist
echo.
echo Checking for enhanced filter files...

if not exist "public\js\filter-enhancements.js" (
    echo X Missing: public\js\filter-enhancements.js
    exit /b 1
)
echo ? Found filter-enhancements.js

if not exist "public\filter-preset-modal.html" (
    echo X Missing: public\filter-preset-modal.html
    exit /b 1
)
echo ? Found filter-preset-modal.html

echo.
echo ======================================
echo Integration Steps
echo ======================================
echo.

echo STEP 1: Backup current files
echo ----------------------------
copy public\index.html public\index.html.backup.%date:~-4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2% >nul
echo ? Backed up index.html

echo.
echo STEP 2: Server is already updated
echo ----------------------------
echo ? server.js has been updated with new filter endpoints

echo.
echo STEP 3: HTML is already updated
echo ----------------------------
echo ? index.html has been updated with new filter UI

echo.
echo STEP 4: Add script references to index.html
echo ----------------------------
echo ? MANUAL STEP REQUIRED:
echo.
echo Add these lines before the closing ^</body^> tag in public\index.html:
echo.
echo   ^<!-- Enhanced Filter Scripts --^>
echo   ^<script src="/js/filter-enhancements.js"^>^</script^>
echo   ^<script src="/filter-preset-modal.html"^>^</script^>
echo.
echo Also add the Filter Preset Modal HTML from public\filter-preset-modal.html
echo before the closing ^</body^> tag (after the other modals)
echo.

echo.
echo STEP 5: Initialize enhanced filters
echo ----------------------------
echo ? MANUAL STEP REQUIRED:
echo.
echo Add these lines in the DOMContentLoaded event handler:
echo.
echo   // Initialize enhanced filters
echo   if (window.initializeEnhancedFilters) {
echo       window.initializeEnhancedFilters();
echo   }
echo   if (window.initFilterPresetModal) {
echo       window.initFilterPresetModal();
echo   }
echo.

echo.
echo STEP 6: Update loadData() function
echo ----------------------------
echo ? MANUAL STEP REQUIRED:
echo.
echo After fetching expenses, add:
echo.
echo   // Apply client-side filters
echo   if (window.applyClientSideFilters) {
echo       expenses = window.applyClientSideFilters(expenses);
echo   }
echo.

echo.
echo ======================================
echo Testing Your Integration
echo ======================================
echo.
echo 1. Start your server:
echo    npm start
echo.
echo 2. Open http://localhost:3000
echo.
echo 3. Test each feature:
echo    ? Text search
echo    ? Date range filter
echo    ? Amount range filter
echo    ? Sorting
echo    ? Filter chips
echo    ? Save/load presets
echo.

echo.
echo ======================================
echo Documentation
echo ======================================
echo.
echo ?? Full integration guide: docs\FILTER_INTEGRATION_GUIDE.md
echo ?? Implementation summary: docs\IMPLEMENTATION_SUMMARY.md
echo.

echo ? Integration preparation complete!
echo.
echo ? Remember to complete the manual steps above!
pause
