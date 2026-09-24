const CACHE='newline-remote-v49';
const CORE=[
  './',
  './index.html',
  './404.html',
  './config.js',
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
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(request){
  const cache=await caches.open(CACHE);
  try{
    const fresh=await fetch(request);
    if(fresh && fresh.ok) cache.put(request,fresh.clone());
    return fresh;
  }catch(err){
    const cached=await cache.match(request,{ignoreSearch:true});
    if(cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate' || url.pathname.endsWith('/config.js')){
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached || fetch(req).then(resp=>{
      if(resp && resp.ok){
        const copy=resp.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy));
      }
      return resp;
    }))
  );
});
