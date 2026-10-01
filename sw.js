const RELEASE=73;
const CACHE='newline-remote-v73';
const CORE=[
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

function bustUrl(path,label='fresh'){
  const url=new URL(path,self.location.href);
  url.searchParams.set('__'+label,String(Date.now()));
  return url.href;
}

async function fetchFresh(path){
  const response=await fetch(bustUrl(path,'swv'+RELEASE),{cache:'no-store'});
  if(!response||!response.ok)throw new Error('Could not fetch '+path+' ('+(response?response.status:'network')+')');
  return response;
}

function responseFromText(text,source){
  return new Response(text,{
    status:source.status,
    statusText:source.statusText,
    headers:new Headers(source.headers)
  });
}

function readEmbeddedVersion(text){
  const match=String(text||'').match(/const\s+APP_VERSION\s*=\s*(\d+)/);
  return match?Number(match[1]):0;
}

async function fetchVerifiedIndex(minVersion){
  const response=await fetchFresh('./index.html');
  const text=await response.text();
  const found=readEmbeddedVersion(text);
  if(!found||found<Number(minVersion||1)){
    throw new Error('The new app shell is still publishing (found v'+(found||'?')+', expected v'+minVersion+').');
  }
  return {text,response,version:found};
}

async function putIndexIntoCache(cacheName,indexData){
  const cache=await caches.open(cacheName);
  await cache.put('./index.html',responseFromText(indexData.text,indexData.response));
  await cache.put('./',responseFromText(indexData.text,indexData.response));
}

async function installFreshCore(){
  // Fetch and verify the shell from the network instead of trusting HTTP cache.
  const indexData=await fetchVerifiedIndex(RELEASE);
  const cache=await caches.open(CACHE);
  await cache.put('./index.html',responseFromText(indexData.text,indexData.response));
  await cache.put('./',responseFromText(indexData.text,indexData.response));

  for(const path of CORE){
    if(path==='./'||path==='./index.html')continue;
    const response=await fetchFresh(path);
    await cache.put(path,response.clone());
  }

  // iOS standalone PWAs can leave the previous worker controlling the Home Screen
  // app even after a newer worker has installed. Seed the fresh shell into every
  // older Newline cache so even the old controller reloads into this release.
  const keys=await caches.keys();
  for(const key of keys){
    if(key!==CACHE&&key.startsWith('newline-remote-v')){
      await putIndexIntoCache(key,indexData);
    }
  }
}

self.addEventListener('install',event=>{
  event.waitUntil(installFreshCore().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('newline-remote-v')).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  const data=event.data||{};
  if(data.type==='SKIP_WAITING'){
    event.waitUntil(self.skipWaiting());
    return;
  }

  if(data.type==='STAGE_UPDATE'){
    const target=Math.max(RELEASE,Number(data.targetVersion)||RELEASE);
    event.waitUntil((async()=>{
      try{
        const indexData=await fetchVerifiedIndex(target);
        // Stage into the cache THIS worker currently serves. The next navigation
        // therefore gets the new shell even before iOS changes SW controllers.
        await putIndexIntoCache(CACHE,indexData);
        if(event.ports&&event.ports[0])event.ports[0].postMessage({ok:true,version:indexData.version});
      }catch(error){
        if(event.ports&&event.ports[0])event.ports[0].postMessage({ok:false,message:(error&&error.message)||'Could not stage update.'});
      }
    })());
  }
});

async function cachedShell(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match('./index.html') || await cache.match(request,{ignoreSearch:true});

  const refresh=fetch(request,{cache:'no-store'}).then(async resp=>{
    if(resp&&resp.ok){
      const text=await resp.clone().text();
      if(readEmbeddedVersion(text)>=RELEASE){
        await cache.put('./index.html',resp.clone());
        await cache.put('./',resp.clone());
      }
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
    fetch(request,{cache:'no-store'}).then(resp=>{
      if(resp&&resp.ok)cache.put(request,resp.clone());
    }).catch(()=>{});
    return cached;
  }
  const fresh=await fetch(request,{cache:'no-store'});
  if(fresh&&fresh.ok)cache.put(request,fresh.clone());
  return fresh;
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  // Version probes must always go straight to the network.
  if(url.pathname.endsWith('/version.json'))return;

  // Never intercept service-worker script requests. This matters for iOS,
  // where aggressively cached sw.js responses can otherwise delay an update.
  if(url.pathname.endsWith('/sw.js'))return;

  if(req.mode==='navigate'){
    event.respondWith(cachedShell(req));
    return;
  }

  event.respondWith(cachedAsset(req));
});
