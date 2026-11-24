// scripts/build-native.mjs
// Builds the ultra-compact native Windows desktop installer (<30 MB) using Rust + WebView2

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUST_DIR = path.join(ROOT, 'desktop-rust');
const RELEASE_NATIVE = path.join(ROOT, 'release-native');
const APP_DIR = path.join(RELEASE_NATIVE, 'app');
const OUT_DIR = path.join(ROOT, 'release');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest, filterFn) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child), filterFn);
    }
  } else {
    if (filterFn && !filterFn(src)) return;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

async function main() {
  console.log('=== Step 1: Building React frontend ===');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  console.log('\n=== Step 2: Building native Rust WebView2 binary ===');
  const cargoCmd = path.join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe');
  execSync(`"${cargoCmd}" build --release`, { cwd: RUST_DIR, stdio: 'inherit' });

  console.log('\n=== Step 3: Staging application payload ===');
  if (fs.existsSync(APP_DIR)) {
    fs.rmSync(APP_DIR, { recursive: true, force: true });
  }
  ensureDir(APP_DIR);
  ensureDir(OUT_DIR);

  // 1. Copy Rust launcher
  const rustExe = path.join(RUST_DIR, 'target', 'release', 'arth-sutra-app.exe');
  fs.copyFileSync(rustExe, path.join(APP_DIR, 'ArthSutra.exe'));

  // 2. Copy Node runtime
  console.log('  → Bundling Node.js runtime...');
  fs.copyFileSync(process.execPath, path.join(APP_DIR, 'node.exe'));

  // 3. Copy application files
  console.log('  → Bundling server and assets...');
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(APP_DIR, 'server.js'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP_DIR, 'package.json'));

  copyRecursive(path.join(ROOT, 'db'), path.join(APP_DIR, 'db'));
  copyRecursive(path.join(ROOT, 'utils'), path.join(APP_DIR, 'utils'));
  copyRecursive(path.join(ROOT, 'plugins'), path.join(APP_DIR, 'plugins'));
  copyRecursive(path.join(ROOT, 'src', 'utils.js'), path.join(APP_DIR, 'src', 'utils.js'));
  copyRecursive(path.join(ROOT, 'src', 'utils'), path.join(APP_DIR, 'src', 'utils'));
  copyRecursive(path.join(ROOT, 'dist'), path.join(APP_DIR, 'dist'));

  // 4. Copy ONLY production node_modules
  console.log('  → Resolving production node_modules...');
  const npmOutput = execSync('npm list --omit=dev --all --parseable', { cwd: ROOT, encoding: 'utf-8' });
  const prodDirs = npmOutput.split(/\r?\n/).filter(line => line.includes('node_modules') && fs.existsSync(line));

  for (const dir of prodDirs) {
    const rel = path.relative(path.join(ROOT, 'node_modules'), dir);
    if (!rel || rel.startsWith('..')) continue;

    const target = path.join(APP_DIR, 'node_modules', rel);
    copyRecursive(dir, target, (filePath) => {
      // Exclude non-Windows prebuilds, docs, and test sources
      if (filePath.includes('better-sqlite3') && filePath.includes('deps')) return false;
      if (filePath.includes('better-sqlite3') && filePath.includes('prebuilds')) {
        return filePath.includes('win32-x64');
      }
      if (/\.(md|ts|map|d\.ts)$/i.test(filePath)) return false;
      if (/[\\/](test|tests|example|examples|\.github)[\\/]/i.test(filePath)) return false;
      return true;
    });
  }

  // 5. Compile NSIS installer
  console.log('\n=== Step 4: Compiling ultra-compact installer via NSIS ===');
  const makensisPath = path.join(
    process.env.LOCALAPPDATA,
    'electron-builder',
    'Cache',
    'nsis-3.0.4.1',
    'nsis-3.0.4.1-1mx3n',
    'makensis.exe'
  );

  const nsiScript = path.join(RUST_DIR, 'installer.nsi');
  execSync(`"${makensisPath}" "${nsiScript}"`, { cwd: RUST_DIR, stdio: 'inherit' });

  const installerPath = path.join(OUT_DIR, 'ArthSutra-Lite-Setup.exe');
  if (fs.existsSync(installerPath)) {
    const stats = fs.statSync(installerPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`\n======================================================`);
    console.log(` SUCCESS! Installer created:`);
    console.log(`   ${installerPath}`);
    console.log(`   Final Size: ${sizeMb} MB`);
    console.log(`======================================================\n`);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
