const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("public/index.html");
const css = read("public/styles/app.css");
const app = read("public/js/app.js");

assert.match(css, /\.app-shell\.hidden\s*\{\s*display:\s*none\s*!important/, "Signed-out users must not see the app shell.");
assert.match(css, /body\.theme-dark \.auth-form-panel h2/, "Authentication text needs a dark-mode contrast rule.");
assert.match(html, /data-range="this-month"/, "Dashboard needs a this-month shortcut.");
assert.match(html, /id="budgetProgressList"/, "Dashboard needs budget guidance.");
assert.match(html, /id="recurringOverview"/, "Dashboard needs recurring-payment guidance.");
assert.match(html, /id="dashboardOnboarding"/, "New users need a clear onboarding path.");
assert.match(css, /\.onboarding-actions\s*\{[^}]*flex-wrap:\s*nowrap/s, "Mobile onboarding actions must remain on one line.");
assert.match(html, /id="expensePaymentPlan"/, "Expense payment-plan fields should be progressively disclosed.");
assert.match(html, /<details class="sidebar-more">/, "Secondary tools should be grouped in the sidebar.");
assert.match(app, /recurringResp/, "Dashboard hydration should include recurring expenses.");
assert.match(app, /\.dash-preset/, "Date-range shortcut interactions must be wired up.");
assert.match(app, /Import preview:/, "Imports should be confirmed from a preview.");

console.log("UI contract checks passed.");
