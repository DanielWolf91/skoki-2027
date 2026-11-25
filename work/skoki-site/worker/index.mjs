const recordKey = /^podmuch-record-[a-z0-9-]{1,100}$/;
const preferenceKeys = new Set([
  'podmuch-hills-v1', 'podmuch-athlete-v1', 'podmuch-controls-v1', 'podmuch-conditions', 'podmuch-camera'
]);
const noCache = {'Cache-Control':'private, no-store'};
const json = (payload, status=200) => Response.json(payload, {status, headers:noCache});

function validValue(key, value) {
  if(recordKey.test(key)) return Number.isFinite(value) && value>0 && value<=500;
  if(key==='podmuch-active-hill') return typeof value==='string' && /^[a-z0-9-]{1,100}$/.test(value);
  if(key==='podmuch-hills-v1') return Array.isArray(value) && JSON.stringify(value).length<160000;
  return preferenceKeys.has(key) && value && typeof value==='object' && !Array.isArray(value)
    && JSON.stringify(value).length<2048;
}

async function saveSettings(request, db, user) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if((origin && origin!==expectedOrigin) || request.headers.get('Sec-Fetch-Site')==='cross-site') {
    return json({error:'Nieprawidłowe źródło zapisu'},403);
  }
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'Wymagany JSON'},415);
  const body = await request.text();
  if(body.length>220000) return json({error:'Za duży zapis'},413);
  let values;
  try { values=JSON.parse(body); }
  catch { return json({error:'Nieprawidłowy JSON'},400); }
  if(!values || typeof values!=='object' || Array.isArray(values)) return json({error:'Nieprawidłowy zapis'},400);
  const entries = Object.entries(values);
  if(entries.length>500 || !entries.every(([key,value])=>validValue(key,value))) {
    return json({error:'Nieprawidłowe ustawienia'},400);
  }
  if(entries.length) {
    const upsert = db.prepare(`INSERT INTO settings (user_id,key,value) VALUES (?,?,?)
      ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value
      WHERE excluded.key NOT LIKE 'podmuch-record-%'
         OR CAST(excluded.value AS REAL)>CAST(settings.value AS REAL)`);
    await db.batch(entries.map(([key,value])=>upsert.bind(user,key,JSON.stringify(value))));
  }
  return json({ok:true});
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    const user = request.headers.get('oai-authenticated-user-id');
    if(pathname===rendererPath) {
      if(request.method!=='GET'&&request.method!=='HEAD') return new Response(null,{status:405});
      return new Response(request.method==='HEAD'?null:rendererSource,{headers:{
        'Content-Type':'text/javascript; charset=utf-8',
        'Cache-Control':'private, max-age=31536000, immutable'
      }});
    }
    if(pathname==='/api/settings' && request.method==='PUT') {
      if(!user) return json({error:'Zaloguj się do ChatGPT'},401);
      return saveSettings(request,env.DB,user);
    }
    if(pathname!=='/' && pathname!=='/index.html') return new Response(null,{status:404});
    if(request.method!=='GET' && request.method!=='HEAD') return new Response(null,{status:405});
    const headers={'Content-Type':'text/html; charset=utf-8',...noCache};
    if(!user || request.method==='HEAD') return new Response(request.method==='HEAD'?null:gameHTML,{headers});
    const {results} = await env.DB.prepare('SELECT key,value FROM settings WHERE user_id=?').bind(user).all();
    const settings = Object.fromEntries(results.map(({key,value})=>[key,JSON.parse(value)]));
    const serialized = JSON.stringify(settings).replaceAll('<','\\u003c');
    const bootstrap = '<script>window.__SKOKI_SETTINGS__='+serialized+';</script>';
    return new Response(gameHTML.replace('</head>',()=>bootstrap+'</head>'),{headers});
  }
};
