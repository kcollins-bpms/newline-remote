const APP_VERSION=67;
const CACHE='newline-remote-v67';
const CORE=[
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});

async function cachedShell(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match('./index.html') || await cache.match(request,{ignoreSearch:true});

  const refresh=fetch(request,{cache:'no-store'}).then(resp=>{
    if(resp && resp.ok){
      cache.put('./index.html',resp.clone());
    }
    return resp;
  }).catch(()=>null);

  if(cached){
    refresh.catch(()=>{});
    return cached;
  }

  const fresh=await refresh;
  if(fresh)return fresh;

  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#07101d;color:white;padding:28px"><h2>Newline Remote</h2><p>Could not load the app shell yet. Reopen the app when a network connection is available.</p></body>',
    {headers:{'Content-Type':'text/html; charset=utf-8'}}
  );
}

async function cachedAsset(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached){
    fetch(request).then(resp=>{
      if(resp&&resp.ok)cache.put(request,resp.clone());
    }).catch(()=>{});
    return cached;
  }
  const fresh=await fetch(request);
  if(fresh&&fresh.ok)cache.put(request,fresh.clone());
  return fresh;
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  // Never intercept version.json. Let the browser perform the normal network
  // request itself. This avoids an iOS PWA failure mode where a version probe
  // routed through the service worker can fail before the page sees a response.
  if(url.pathname.endsWith('/version.json'))return;

  if(req.mode==='navigate'){
    event.respondWith(cachedShell(req));
    return;
  }

  event.respondWith(cachedAsset(req));
});
