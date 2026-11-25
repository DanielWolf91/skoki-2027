const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const game = path.join(__dirname, 'work', 'podmuch');
const site = path.join(__dirname, 'work', 'skoki-site');
execFileSync(process.execPath, ['build.cjs'], { cwd: game, stdio: 'inherit' });
fs.mkdirSync(path.join(site, 'dist'), { recursive: true });
fs.copyFileSync(path.join(game, 'Podmuch-built.html'), path.join(site, 'dist', 'index.html'));
execFileSync(process.execPath, ['build.cjs'], { cwd: site, stdio: 'inherit' });
