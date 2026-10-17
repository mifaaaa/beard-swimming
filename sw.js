const CACHE='beard-offline-shell-20261017-v2';
const CORE=['./','./index.html','./config.js','./offline-scores.js','./vendor/supabase-2.49.8.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const c=await caches.open(CACHE);await c.addAll(CORE);
 const optional=['logo.png','manifest.webmanifest','app-icon-180.png','app-icon-192.png','app-icon-512.png','app-icon-maskable-192.png','app-icon-maskable-512.png',...['freestyle','backstroke','breaststroke','butterfly'].flatMap(s=>['male','female'].map(g=>`${s}-${g}.webp`))];
 await Promise.allSettled(optional.map(p=>c.add('./'+p)));
 // Activate on the next normal reopening, to keep code and page versions consistent.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const k of await caches.keys())if(k.startsWith('beard-offline-shell-')&&k!==CACHE)await caches.delete(k);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 if(event.request.method!=='GET'||u.origin!==self.location.origin)return;
 const allowed=event.request.mode==='navigate'||CORE.some(p=>new URL(p,self.registration.scope).pathname===u.pathname)||/\.(png|webp|webmanifest)$/.test(u.pathname);
 if(!allowed)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}
  catch(e){const cached=await cache.match(event.request,{ignoreSearch:true});if(cached)return cached;if(event.request.mode==='navigate')return cache.match('./index.html');throw e;}
 })());
});
