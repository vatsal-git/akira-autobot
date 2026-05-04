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
const packagerCmd = `electron-packager . Akira --platform=win32 --arch=x64 --out="${versionedFolder}" --overwrite --icon=electron/icons/icon.ico --ignore=^/release --ignore=node_modules/electron$ --ignore=\\.git --ignore=scripts --ignore=src --ignore=public --ignore=\\.env --ignore=vite\\.config --app-version=${newVersion}`;

execSync(packagerCmd, { stdio: 'inherit' });

// Create zip for distribution
const builtFolder = path.join(versionedFolder, 'Akira-win32-x64');
const zipPath = path.join(versionedFolder, `Akira-v${newVersion}-win32-x64.zip`);

console.log(`\n📦 Creating zip: Akira-v${newVersion}-win32-x64.zip...`);
execSync(`powershell -Command "Compress-Archive -Path '${builtFolder}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'inherit' });

console.log(`\n✅ Build complete: release/v${newVersion}`);
console.log(`   Folder: Akira-win32-x64`);
console.log(`   Zip: Akira-v${newVersion}-win32-x64.zip\n`);
