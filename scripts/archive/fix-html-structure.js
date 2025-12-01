// Script to completely fix the HTML structure
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== CRITICAL STRUCTURAL FIX ===\n');
console.log('Problem: All app content is nested inside #registerForm div');
console.log('Solution: Properly close #registerForm and move app content into separate #app wrapper\n');

// Find where registerForm ends (after "Already registered?" paragraph)
const registerFormEnd = content.indexOf('Already registered?');
if (registerFormEnd === -1) {
    console.error('? Could not find "Already registered?" text');
    process.exit(1);
}

// Find the closing </p> tag after "Already registered?"
const nextClosingP = content.indexOf('</p>', registerFormEnd);
if (nextClosingP === -1) {
    console.error('? Could not find closing </p> after "Already registered?"');
    process.exit(1);
}

// Find the button that should come after (showLogin)
const showLoginButton = `<button id="showLogin" class="text-primary font-semibold hover:underline">Log in</button>`;

// Insert the showLogin button and properly close registerForm
const insertPoint = nextClosingP + 4; // After </p>

// Build the proper structure
const properClosure = `
                        <button id="showLogin" class="text-primary font-semibold hover:underline">Log in</button>
                    </p>
                </div>
            </div>
        </div>
    </div>

    <!-- APPLICATION CONTENT (properly separated from auth screen) -->
    <div id="app" class="hidden">
`;

// Get everything after the register form that should be in #app
const beforeRegisterEnd = content.substring(0, insertPoint);
const afterRegisterForm = content.substring(insertPoint);

// Find where to close the #app div (before closing body tag)
const bodyCloseIndex = afterRegisterForm.lastIndexOf('</body>');

// Remove everything between registerForm end and the theme toggle script (that's the misplaced content)
// Then wrap it properly in #app div

// Find the theme toggle script start
const themeScriptStart = afterRegisterForm.indexOf('<script>');

// Get the misplaced app content (filters, tables, blog, etc.)
const appContent = afterRegisterForm.substring(0, themeScriptStart);

// Get the scripts and closing tags
const scriptsAndClosing = afterRegisterForm.substring(themeScriptStart);

// Now properly structure: close auth divs, open #app, add content, close #app, add scripts
const fixed = beforeRegisterEnd + properClosure + appContent + `
    </div>
    <!-- End of #app -->
` + scriptsAndClosing;

console.log('Writing fixed structure...');
fs.writeFileSync(filePath, fixed, 'utf8');

console.log('\n? HTML structure fixed!');
console.log('\nChanges made:');
console.log('1. ? Properly closed #registerForm after "Already registered?" section');
console.log('2. ? Added #showLogin button');
console.log('3. ? Created separate #app wrapper with class="hidden"');
console.log('4. ? Moved all application content (filters, tables, blog) into #app');
console.log('5. ? Auth screen and app content are now siblings, not nested');
console.log('\n?? The app should now work correctly:');
console.log('   - Login shows #app, hides #authScreen');
console.log('   - Logout shows #authScreen, hides #app');
console.log('   - No more disappearing content!');
