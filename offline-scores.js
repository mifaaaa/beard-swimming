/* Local drafts are account scoped; server permissions are checked on every sync. */
const scoreStore = new Promise((resolve,reject)=>{
 const req=indexedDB.open('beard-offline-scores-v1',1);
 req.onupgradeneeded=()=>req.result.createObjectStore('items',{keyPath:'key'});
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
scoreStore.catch(()=>{});
async function scoreDB(action,key,value){
 const db=await scoreStore;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('items',action==='get'?'readonly':'readwrite');const store=tx.objectStore('items');
  const req=action==='get'?store.get(key):action==='put'?store.put({key,value}):store.delete(key);
  tx.oncomplete=()=>resolve(req.result?.value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('手機儲存失敗'));
 });
}
let scoreOwner=null,scoreSyncing=false,scoreSaving=false,scoreNotice='',scoreOffline=false;
function scoreOwnerId(){return scoreOwner||state.user?.id;}
async function scoreSnapshot(){
 if(!state.coach||!state.user)return;
 const owner=state.user.id;scoreOwner=owner;
 await scoreDB('put','snapshot:'+owner,{owner,at:Date.now(),roster:state.roster,performances:state.performances,records:state.records,allMeets:state.allMeets});
 await scoreDB('put','active',owner);
}
async function scoreRestore(){
 const owner=state.user?.id||await scoreDB('get','active');if(!owner)return scoreRestorePublic();
 const snap=await scoreDB('get','snapshot:'+owner);if(!snap)return scoreRestorePublic();
 scoreOwner=owner;scoreOffline=true;
 Object.assign(state,{roster:snap.roster,performances:snap.performances,records:snap.records,allMeets:snap.allMeets,meets:snap.allMeets.filter(m=>m.active!==false),coach:true,admin:false});
 computeDerivedData(state.performances);render();updateAuth();
 if(!state.user)document.getElementById('authArea').innerHTML='<button class="btn" onclick="openLogin()">連網登入</button><button class="btn" onclick="logout()">離開離線帳號</button>';
 refreshOpenScoreMeets();
 scoreNotice='使用此手機上次登入的教練資料（'+new Date(snap.at).toLocaleString('zh-TW')+'）；待同步成績尚未計入 PB。';
 await scorePanel();return true;
}
async function scoreDrafts(){const owner=scoreOwnerId();return owner?(await scoreDB('get','queue:'+owner)||[]):[];}
async function scorePanel(){
 const box=document.getElementById('offlineScores');if(!box)return;
 try{
  const q=await scoreDrafts();
  box.hidden=navigator.onLine&&q.length===0;
  if(box.hidden)return;
  box.querySelector('[data-status]').textContent=(navigator.onLine&&!scoreOffline?'🟢 已連網':'📴 離線資料模式')+' · 待同步 '+q.length+' 筆'+(scoreSyncing?' · 同步中':'');
  box.querySelector('[data-notice]').textContent=scoreNotice;
  box.querySelector('[data-list]').innerHTML=q.map(x=>'<li>'+esc(({add:'新增',edit:'修改',delete:'刪除'})[x.operation])+' · '+esc(x.payload.swimmer_name)+' · '+esc(x.payload.meet)+' · '+esc(x.payload.event)+' · '+esc(fmt(x.payload.seconds||x.payload.previous?.seconds))+' · '+esc(x.payload.swim_date||x.payload.previous?.swim_date||'日期未填')+(x.error?' — '+esc(x.error):' — 待同步')+(x.rejected?' <button class="btn ghost" onclick="scoreDiscard(\''+x.id+'\')">取消此待同步操作</button>':'')+'</li>').join('');
  box.querySelector('[data-sync]').disabled=scoreSyncing||!navigator.onLine||!q.length;
 }catch(e){box.hidden=false;box.querySelector('[data-status]').textContent='⚠️ 手機儲存不可用，請勿關閉尚未儲存的表單';}
}
async function scoreEnqueueUnlocked(payload,operation="add"){
 const owner=scoreOwnerId();if(!owner)throw new Error('請先連網登入教練帳號並載入資料。');
 const q=await scoreDrafts();
 if(q.some(x=>x.operation===operation&&JSON.stringify(x.payload)===JSON.stringify(payload)))throw new Error('這筆相同成績已在待同步清單。');
 q.push({id:crypto.randomUUID(),owner,payload,operation,createdAt:Date.now()});
 await scoreDB('put','queue:'+owner,q);await scorePanel();const details=document.querySelector('#offlineScores details');if(details)details.open=true;
}
async function scoreSynchronizeUnlocked(){
 if(scoreSyncing||scoreSaving||!navigator.onLine||!sb)return;
 scoreSyncing=true;await scorePanel();
 try{
  const {data,error}=await sb.auth.getUser();if(error||!data.user)throw new Error('請連網重新登入原教練帳號，再同步。');
  const owner=scoreOwnerId();if(data.user.id!==owner)throw new Error('待同步紀錄屬於另一個教練帳號，請登入原帳號。');
  state.user=data.user;
  const permission=await sb.rpc('is_coach');if(permission.error||permission.data!==true)throw new Error('此帳號目前沒有教練權限，紀錄仍保留在手機。');
  while(true){
   const q=await scoreDrafts();if(!q.length)break;const item=q[0];
   const {error}=await sb.rpc('sync_offline_score',{p_request_id:item.id,p_operation:item.operation,p_payload:item.payload,p_owner:owner});
   if(error){item.error=error.message;item.rejected=error.code==='P0001'||error.code==='22007'||error.code==='22P02';await scoreDB('put','queue:'+owner,q);throw new Error(error.message);}
   // Delete only after acknowledged success. A lost response is retried with the same UUID.
   q.shift();await scoreDB('put','queue:'+owner,q);await scorePanel();
  }
  scoreNotice='成績已同步。';scoreOffline=false;await loadCloud();
 }catch(e){scoreNotice='尚未完成同步：'+e.message+'。紀錄仍保留，請修正連線或登入後重試。';}
 finally{scoreSyncing=false;await scorePanel();}
}
async function scoreExport(){
 const q=await scoreDrafts();const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),drafts:q},null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='鬍子泳隊_待同步備份.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function scoreInstall(){
 const originalLoad=loadCloud;
 loadCloud=async function(){
  if(!navigator.onLine){try{return await scoreRestore();}catch(e){scoreNotice='無法讀取手機資料：'+e.message;await scorePanel();return false;}}
  const ok=await originalLoad();
  if(ok&&state.coach){scoreOwner=state.user.id;scoreOffline=false;try{await scoreSnapshot();}catch(e){scoreNotice='無法建立離線資料，請確認手機可用空間。';}}
  else if(!ok){try{await scoreRestore();}catch(e){/* Existing read error remains visible. */}}
  await scorePanel();if(ok&&state.coach&&!scoreSyncing&&(await scoreDrafts()).length)setTimeout(()=>scoreSynchronize(),0);return ok;
 };
 const originalLogout=logout;
 logout=async function(){
  if(scoreSyncing||scoreSaving){alert('成績處理中，請稍後再登出。');return;}
  const owner=scoreOwnerId();if((await scoreDrafts()).length&&!confirm('仍有待同步成績；登出後會保留在這支手機，需登入原帳號才能同步。確定登出？'))return;
  await scoreDB('delete','active');if(owner)await scoreDB('delete','snapshot:'+owner);scoreOwner=null;scoreOffline=false;await originalLogout();if(!navigator.onLine)await scoreRestorePublic();await scorePanel();
 };
 // Offline identity permits local drafts only. All cloud writes still require server authentication.
 for(const name of ['saveEdition','deleteMeet','addSwimmer','removeSwimmer','saveSwimmerProfile','removeEditedSwimmer','deleteMeetFromEditor']){
  const original=window[name];if(typeof original==='function')window[name]=async function(...args){if(scoreOffline||!navigator.onLine){alert('離線時可新增、修改、刪除比賽成績；這項修改需要連網並確認教練權限。');return;}return original.apply(this,args);};
 }
 addEventListener('online',async()=>{await loadCloud();await scoreSynchronize();});
 addEventListener('offline',()=>{scoreOffline=true;scorePanel();});
 addEventListener('focus',()=>{if(navigator.onLine)scoreSynchronize();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&navigator.onLine)scoreSynchronize();});
 if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;scoreNotice='離線頁面已準備；公開隊史可離線查看。教練請先連網登入一次。';}catch(e){scoreNotice='離線頁面尚未準備完成，請保持連網重試。';}}
 if(!navigator.onLine)await scoreRestore();else {await loadCloud();await scoreSynchronize();}
 await scorePanel();
}

async function scoreLocked(fn){
 if(!navigator.locks)throw new Error('請使用支援離線同步鎖定的新版 Chrome 或 Safari');
 return navigator.locks.request('beard-score-queue',fn);
}
async function scoreEnqueue(payload,operation='add'){return scoreLocked(()=>scoreEnqueueUnlocked(payload,operation));}
async function scoreSynchronize(){return scoreLocked(()=>scoreSynchronizeUnlocked());}
function scorePrevious(row){return {seconds:Number(row.seconds),meet:row.meet??null,swim_date:row.swim_date??null,note:row.note??null,swimmer_name:row.swimmer_name,course:row.course,event:row.event};}
async function scoreQueueChange(operation,row,changes){
 if(scoreSaving||scoreSyncing)throw new Error('請稍候，目前正在處理成績。');
 scoreSaving=true;
 try{
 const q=await scoreDrafts();if(q.some(x=>x.payload.id===row.id))throw new Error('這筆成績已有待同步操作，請先同步或處理該筆操作。');
 await scoreEnqueue({id:row.id,swimmer_name:row.swimmer_name,course:row.course,event:row.event,meet:row.meet,swim_date:row.swim_date,previous:scorePrevious(row),...changes},operation);
 scoreNotice='已儲存'+(operation==='edit'?'修改':'刪除')+'操作，待同步後才會更新正式成績。';
 }finally{scoreSaving=false;}
 await scorePanel();if(navigator.onLine)await scoreSynchronize();
}

async function scoreRestorePublic(){
 const cached=await scoreDB('get','public-records');if(!cached)return false;
 clearCoachData();state.records=cached.records;scoreOffline=true;render();updateAuth();
 scoreNotice='離線公開隊史 · 更新於 '+new Date(cached.at).toLocaleString('zh-TW')+'。連網後會載入最新紀錄。';await scorePanel();return true;
}
async function scoreDiscard(id){
 if(!confirm('取消這筆已被資料庫拒絕的待同步操作？雲端成績不會被更動；需要時可先備份。'))return;
 await scoreLocked(async()=>{const q=await scoreDrafts();const item=q.find(x=>x.id===id);if(!item?.rejected)throw new Error('尚未確認失敗的操作不能取消，請先同步確認。');await scoreDB('put','queue:'+scoreOwnerId(),q.filter(x=>x.id!==id));});
 await scorePanel();
}
