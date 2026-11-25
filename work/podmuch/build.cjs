const path=require('node:path');
const fs=require('node:fs');
const {deflateSync}=require('node:zlib');
const esbuild=require('esbuild');

const root=__dirname;
const markup=fs.readFileSync(path.join(root,'dist','index.html'),'utf8');
const placeholder='<!-- PODMUCH_RENDERER -->';
if (!markup.includes(placeholder)) throw new Error('Brak miejsca na kod renderera w HTML.');
const packed=esbuild.buildSync({
  entryPoints:[path.join(root,'render3d.mjs')],
  bundle:true,minify:true,globalName:'PodmuchGraphics',format:'iife',target:'es2020',
  charset:'utf8',legalComments:'inline',write:false
}).outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const asset=deflateSync(fs.readFileSync(path.join(root,'athlete.glb')),{level:9}).toString('base64');
const sello=fs.readFileSync(path.join(root,'sello-nx.json'),'utf8');
const html=markup.replace(placeholder,()=>`<script id="podmuch-renderer">${packed}\nwindow.PodmuchAthlete="${asset}";\nwindow.PodmuchSponsorLogo=${sello};</script>`);
fs.writeFileSync(path.join(root,'Podmuch-built.html'),html);
console.log(`${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB, jeden plik offline`);
