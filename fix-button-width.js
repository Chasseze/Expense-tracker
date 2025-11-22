// Fix filter action buttons to span full width
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('\n=== FIXING BUTTON WIDTH ===\n');

// Find and replace the button container to make buttons full width
const oldButtonHtml = `<div class="flex flex-wrap gap-3 mt-4">
                            <button id="applyFiltersBtn"
                                class="flex-1 sm:flex-initial bg-white text-blue-700 px-6 py-2.5 rounded-lg font-semibold hover:bg-blue-50 transition-colors">
                                <i class="fas fa-filter mr-2"></i>Apply Filters
                            </button>
                            <button id="clearFiltersBtn"
                                class="flex-1 sm:flex-initial border border-white/50 px-6 py-2.5 rounded-lg font-semibold text-white hover:bg-white/10 transition-colors">
                                <i class="fas fa-times mr-2"></i>Clear All
                            </button>
                            <button id="saveFilterPresetBtn"
                                class="flex-1 sm:flex-initial bg-amber-500 hover:bg-amber-600 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors">
                                <i class="fas fa-save mr-2"></i>Save Preset
                            </button>
                            <button id="loadFilterPresetBtn"
                                class="flex-1 sm:flex-initial bg-purple-500 hover:bg-purple-600 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors">
                                <i class="fas fa-folder-open mr-2"></i>Load Preset
                            </button>
                        </div>`;

const newButtonHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                            <button id="applyFiltersBtn"
                                class="w-full bg-white text-blue-700 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition-colors shadow-md">
                                <i class="fas fa-filter mr-2"></i>Apply Filters
                            </button>
                            <button id="clearFiltersBtn"
                                class="w-full border-2 border-white/50 px-6 py-3 rounded-lg font-semibold text-white hover:bg-white/10 transition-colors shadow-md">
                                <i class="fas fa-times mr-2"></i>Clear All
                            </button>
                            <button id="saveFilterPresetBtn"
                                class="w-full bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors shadow-md">
                                <i class="fas fa-save mr-2"></i>Save Preset
                            </button>
                            <button id="loadFilterPresetBtn"
                                class="w-full bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors shadow-md">
                                <i class="fas fa-folder-open mr-2"></i>Load Preset
                            </button>
                        </div>`;

// Replace in content
if (content.includes('flex-1 sm:flex-initial bg-white text-blue-700')) {
    content = content.replace(oldButtonHtml, newButtonHtml);
    console.log('? Replaced button container with grid layout');
} else {
    console.log('? Pattern not found, trying alternate approach...');
    
    // Replace individual button classes
    content = content.replace(
        /class="flex-1 sm:flex-initial bg-white text-blue-700 px-6 py-2\.5/g,
        'class="w-full bg-white text-blue-700 px-6 py-3'
    );
    content = content.replace(
        /class="flex-1 sm:flex-initial border border-white\/50 px-6 py-2\.5/g,
        'class="w-full border-2 border-white/50 px-6 py-3'
    );
    content = content.replace(
        /class="flex-1 sm:flex-initial bg-amber-500/g,
        'class="w-full bg-amber-500'
    );
    content = content.replace(
        /class="flex-1 sm:flex-initial bg-purple-500/g,
        'class="w-full bg-purple-500'
    );
    
    // Change flex-wrap to grid
    content = content.replace(
        /<div class="flex flex-wrap gap-3 mt-4">/g,
        '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">'
    );
    
    console.log('? Applied individual class replacements');
}

console.log('Writing updated file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('\n? Button width fixed successfully!');
console.log('\nChanges made:');
console.log('1. ? Changed from flex to grid layout');
console.log('2. ? Made all buttons w-full (100% width)');
console.log('3. ? Responsive: 1 column on mobile, 2 on tablet, 4 on desktop');
console.log('4. ? Increased button padding for better click area');
console.log('5. ? Added shadow for better visual separation');
console.log('\n?? Refresh your browser to see the changes!');
