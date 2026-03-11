# test_login.ps1
# PowerShell script to start the Expense Tracker server and run login tests

param(
    [switch]$KeepServerRunning = $false,
    [switch]$SkipTests = $false,
    [int]$Port = 3000,
    [string]$TestScript = "test_login.js"
)

$ErrorActionPreference = "Stop"

# Function to check if server is running
function Test-ServerRunning {
    param([int]$Port)

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/status" -TimeoutSec 2 -ErrorAction SilentlyContinue
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

# Function to start server
function Start-LocalServer {
    param([int]$Port)

    Write-Host "Starting server on port $Port..." -ForegroundColor Cyan

    # Set environment variables for development
    $env:NODE_ENV = "development"
    $env:DISABLE_AUTH = "1"

    # Start server in background job
    $serverJob = Start-Job -Name "ExpenseTrackerServer" -ScriptBlock {
        param($Port)
        cd $using:PWD
        node server.js
    } -ArgumentList $Port

    # Wait for server to be ready
    Write-Host "Waiting for server to start..." -ForegroundColor Yellow
    $maxWait = 30
    $waitInterval = 1
    $serverReady = $false

    for ($i = 0; $i -lt $maxWait; $i++) {
        if (Test-ServerRunning -Port $Port) {
            $serverReady = $true
            Write-Host "Server is ready!" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds $waitInterval
        Write-Host "." -NoNewline -ForegroundColor DarkGray
    }

    if (-not $serverReady) {
        Write-Host "`nServer failed to start within $maxWait seconds" -ForegroundColor Red
        Stop-Job -Name "ExpenseTrackerServer" -ErrorAction SilentlyContinue
        Remove-Job -Name "ExpenseTrackerServer" -ErrorAction SilentlyContinue
        throw "Server startup timeout"
    }

    return $serverJob
}

# Function to stop server
function Stop-LocalServer {
    param([System.Management.Automation.Job]$ServerJob)

    if ($ServerJob -and $ServerJob.State -eq "Running") {
        Write-Host "Stopping server..." -ForegroundColor Cyan
        Stop-Job -Job $ServerJob -ErrorAction SilentlyContinue
        Remove-Job -Job $ServerJob -Force -ErrorAction SilentlyContinue

        # Give server time to shutdown
        Start-Sleep -Seconds 2
        Write-Host "Server stopped." -ForegroundColor Green
    }
}

# Function to run login tests
function Run-LoginTests {
    param([string]$TestScript)

    Write-Host "`nRunning login tests..." -ForegroundColor Cyan
    Write-Host "================================" -ForegroundColor DarkGray

    if (-not (Test-Path $TestScript)) {
        Write-Host "Test script '$TestScript' not found." -ForegroundColor Red
        Write-Host "Creating test script..." -ForegroundColor Yellow

        # Check if test_login.js exists
        if (-not (Test-Path "test_login.js")) {
            Write-Host "test_login.js not found. Please create the test script first." -ForegroundColor Red
            return $false
        }
        $TestScript = "test_login.js"
    }

    try {
        # Run the test script
        $output = node $TestScript 2>&1
        $exitCode = $LASTEXITCODE

        # Display output
        Write-Host $output

        if ($exitCode -eq 0) {
            Write-Host "`n✅ Tests completed successfully!" -ForegroundColor Green
            return $true
        } else {
            Write-Host "`n❌ Tests failed with exit code $exitCode" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "`n❌ Error running tests: $_" -ForegroundColor Red
        return $false
    }
}

# Main script
try {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Expense Tracker Login Test Runner" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # Check if Node.js is available
    try {
        $nodeVersion = node --version
        Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "Node.js is not installed or not in PATH." -ForegroundColor Red
        Write-Host "Please install Node.js to run the tests." -ForegroundColor Yellow
        exit 1
    }

    # Check if server is already running
    $serverWasRunning = Test-ServerRunning -Port $Port
    $serverJob = $null

    if ($serverWasRunning) {
        Write-Host "Server is already running on port $Port." -ForegroundColor Yellow
    } else {
        # Start the server
        $serverJob = Start-LocalServer -Port $Port
    }

    # Run tests if not skipped
    $testsPassed = $false
    if (-not $SkipTests) {
        $testsPassed = Run-LoginTests -TestScript $TestScript
    } else {
        Write-Host "`nSkipping tests as requested." -ForegroundColor Yellow
        $testsPassed = $true  # Assume passed since we skipped
    }

    # Cleanup
    if (-not $KeepServerRunning -and $serverJob -ne $null) {
        Stop-LocalServer -ServerJob $serverJob
    } elseif ($KeepServerRunning -and $serverJob -ne $null) {
        Write-Host "`nServer is still running in the background." -ForegroundColor Yellow
        Write-Host "Job ID: $($serverJob.Id)" -ForegroundColor DarkGray
        Write-Host "To stop it later: Stop-Job -Id $($serverJob.Id)" -ForegroundColor DarkGray
    } elseif ($KeepServerRunning -and $serverWasRunning) {
        Write-Host "`nServer was already running and will continue to run." -ForegroundColor Yellow
    }

    # Return appropriate exit code
    if ($testsPassed) {
        Write-Host "`n✅ All operations completed successfully!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n❌ Tests failed or encountered errors." -ForegroundColor Red
        exit 1
    }

} catch {
    Write-Host "`n❌ Script error: $_" -ForegroundColor Red
    Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor DarkGray
    exit 1
}
