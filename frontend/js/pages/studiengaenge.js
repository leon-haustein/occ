import '../init.js';
import { API_BASE } from '../config.js';
import { OTTO_FIRST_LAYER_SVG } from '../vector-graphics.js';

const host = document.getElementById('otto-logo-host');
if (host) {
    host.innerHTML = OTTO_FIRST_LAYER_SVG;
}

let studyPrograms = [];
let filteredPrograms = [];
let selectedIndex = -1;
let isDropdownOpen = false;

const input = document.getElementById('studyInput');
const dropdown = document.getElementById('dropdownMenu');
const toggle = document.getElementById('dropdownToggle');

// Load study programs from backend (occ.studiengaenge)
async function loadStudyPrograms() {
    try {
        const res = await fetch(`${API_BASE}/api/programs`);
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        studyPrograms = data.map(row => ({
            id: row.id,
            name: row.studiengang || '',
            degree: row.abschluss || ''
        }));
        filteredPrograms = [...studyPrograms];
        return true;
    } catch (err) {
        console.error('Failed to load study programs:', err);
        return false;
    }
}

// Display label: degree in front of study program (e.g. "B.Sc. Medizintechnik")
function getProgramLabel(program) {
    return program.degree ? `${program.degree} ${program.name}` : program.name;
}

// Initialize dropdown
async function initializeDropdown() {
    setupEventListeners();
    dropdown.innerHTML = '<div class="dropdown-option no-results">Lade Studiengänge…</div>';
    const ok = await loadStudyPrograms();
    if (!ok) {
        dropdown.innerHTML = '<div class="dropdown-option no-results">Fehler beim Laden. Backend läuft?</div>';
        return;
    }
    renderOptions();
}

// Setup event listeners
function setupEventListeners() {
    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    toggle.addEventListener('click', toggleDropdown);
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            closeDropdown();
        }
    });
}

// Handle input changes
function handleInput(e) {
    const query = e.target.value.toLowerCase();
    filteredPrograms = studyPrograms.filter(program => 
        getProgramLabel(program).toLowerCase().includes(query)
    );
    selectedIndex = -1;
    renderOptions();
    openDropdown();
}

// Handle keyboard navigation
function handleKeydown(e) {
    if (!isDropdownOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
            openDropdown();
            return;
        }
    }

    switch(e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, filteredPrograms.length - 1);
            updateSelection();
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelection();
            break;
        case 'Enter':
            e.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < filteredPrograms.length) {
                selectProgram(filteredPrograms[selectedIndex]);
            } else if (filteredPrograms.length === 1) {
                selectProgram(filteredPrograms[0]);
            }
            break;
        case 'Escape':
            closeDropdown();
            break;
    }
}

// Handle focus
function handleFocus() {
    openDropdown();
}

// Handle blur
function handleBlur() {
    // Delay to allow click events on options
    setTimeout(() => {
        if (!document.activeElement.closest('.dropdown-menu')) {
            closeDropdown();
        }
    }, 150);
}

// Toggle dropdown
function toggleDropdown() {
    if (isDropdownOpen) {
        closeDropdown();
    } else {
        openDropdown();
    }
}

// Open dropdown
function openDropdown() {
    isDropdownOpen = true;
    dropdown.style.display = 'block';
    toggle.textContent = '▲';
}

// Close dropdown
function closeDropdown() {
    isDropdownOpen = false;
    dropdown.style.display = 'none';
    toggle.textContent = '▼';
    selectedIndex = -1;
}

// Render options
function renderOptions() {
    dropdown.innerHTML = '';
    
    if (filteredPrograms.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'dropdown-option no-results';
        noResults.textContent = 'Keine Studiengänge gefunden';
        dropdown.appendChild(noResults);
        return;
    }

    filteredPrograms.forEach((program, index) => {
        const option = document.createElement('div');
        option.className = 'dropdown-option';
        const name = document.createElement('div');
        name.className = 'option-name';
        name.textContent = getProgramLabel(program);
        option.appendChild(name);
        option.addEventListener('mousedown', (e) => e.preventDefault());
        option.addEventListener('click', () => selectProgram(program));
        dropdown.appendChild(option);
    });
}

// Update selection highlighting
function updateSelection() {
    const options = dropdown.querySelectorAll('.dropdown-option');
    options.forEach((option, index) => {
        option.classList.toggle('selected', index === selectedIndex);
    });
}

// Select a program
function selectProgram(program) {
    input.value = getProgramLabel(program);
    closeDropdown();
    
    // Redirect to kurse.html with program ID
    const redirectUrl = `kurse.html?program=${encodeURIComponent(program.id)}`;
    window.location.href = redirectUrl;
}

// Initialize when page loads
window.addEventListener('load', initializeDropdown);
