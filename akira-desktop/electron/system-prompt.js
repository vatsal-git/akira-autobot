const path = require('path');

// Akira's root directory (akira-desktop)
const AKIRA_ROOT = path.resolve(__dirname, '..');

function getSystemPrompt() {
   return `You are Akira. Your code is located at: ${AKIRA_ROOT}`;
}

module.exports = { getSystemPrompt, AKIRA_ROOT };
