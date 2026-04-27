const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const releasePath = path.join(__dirname, '..', 'release');

// Read package.json
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Parse current version
const [major, minor, patch] = pkg.version.split('.').map(Number);

// Increment patch version
const newVersion = `${major}.${minor}.${patch + 1}`;

// Update package.json with new version
pkg.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`\n📦 Building Akira v${newVersion}\n`);

// Create versioned release folder
const versionedFolder = path.join(releasePath, `v${newVersion}`);
if (!fs.existsSync(releasePath)) {
    fs.mkdirSync(releasePath, { recursive: true });
}

// Build Vite first
console.log('🔨 Building Vite...');
execSync('npm run build:vite', { stdio: 'inherit' });

// Build Electron package into versioned folder
console.log(`\n📁 Packaging to release/v${newVersion}...\n`);
const packagerCmd = `electron-packager . Akira --platform=win32 --arch=x64 --out="${versionedFolder}" --overwrite --ignore=node_modules/electron-builder --ignore=\\.git --app-version=${newVersion}`;

execSync(packagerCmd, { stdio: 'inherit' });

console.log(`\n✅ Build complete: release/v${newVersion}`);
console.log(`   Version: ${newVersion}\n`);
