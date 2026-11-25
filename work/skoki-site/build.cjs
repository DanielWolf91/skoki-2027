const fs = require('node:fs');
const {createHash} = require('node:crypto');

const html = fs.readFileSync('dist/index.html', 'utf8');
const worker = fs.readFileSync('worker/index.mjs', 'utf8');
const renderer = html.match(/<script id="podmuch-renderer">([\s\S]*?)<\/script>/);
if(!renderer) throw new Error('Brak skryptu renderera w kompilacji gry.');
const assetHash = createHash('sha256').update(renderer[1]).digest('hex').slice(0,20);
const rendererPath = `/assets/renderer-${assetHash}.js`;
const gameHTML = html.replace(renderer[0],`<script src="${rendererPath}"></script>`)
  .replace('</head>', `<link rel="preload" as="script" href="${rendererPath}"></head>`);
fs.mkdirSync('dist/server', {recursive:true});
fs.mkdirSync('dist/.openai', {recursive:true});
fs.writeFileSync('dist/server/index.js', `const gameHTML = ${JSON.stringify(gameHTML)};\nconst rendererPath = ${JSON.stringify(rendererPath)};\nconst rendererSource = ${JSON.stringify(renderer[1])};\n${worker}`);
