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

// Build Vite first
console.log('🔨 Building Vite...');
execSync('npm run build:vite', { stdio: 'inherit' });

// Build Electron package using electron-builder
console.log(`\n📁 Packaging standalone executable to release/v${newVersion}...\n`);
const builderCmd = `npx electron-builder --win -c.directories.output="release/v${newVersion}"`;

execSync(builderCmd, { stdio: 'inherit' });

// Clean up temporary config files if created
const tempConfig = path.join(releasePath, `v${newVersion}`, 'builder-effective-config.yaml');
if (fs.existsSync(tempConfig)) {
    fs.unlinkSync(tempConfig);
}

console.log(`\n✅ Build complete: release/v${newVersion}/akira.exe\n`);
