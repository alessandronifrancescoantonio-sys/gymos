const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root,'vendor'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/idb/build/index.js'),path.join(root,'vendor/idb.js'));
fs.copyFileSync(path.join(root,'node_modules/idb/LICENSE'),path.join(root,'vendor/idb.LICENSE'));
const manifest = path.join(root,'features/manifest.json');
if (fs.existsSync(manifest)) {
  const names=JSON.parse(fs.readFileSync(manifest));
  fs.writeFileSync(path.join(root,'modules.js'), '// Generated from features/*.js by npm run build. Edit feature sources.\n'+names.map(n=>fs.readFileSync(path.join(root,'features',n),'utf8')).join('\n'));
}
const build = Number(JSON.parse(fs.readFileSync(path.join(root, 'version.json'))).build);
if (!Number.isInteger(build)) throw new Error('Build ID missing');
for (const name of ['index.html','tests.html']) {
  const file = path.join(root,name);
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\?v=\d+/g, '?v='+build));
}
const file = path.join(root,'sw.js');
fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/const CACHE = "gymos-v\d+"/, 'const CACHE = "gymos-v'+build+'"'));
console.log('Build '+build+' synchronized');
