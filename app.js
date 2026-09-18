/* Regicidious — local-only, framework-free pass-and-play. */
const KEY = 'regicidious.game.v1';
const SLOT_PREFIX = 'regicidious.match.';
const META_PREFIX = 'regicidious.meta.';
const ACCESS_PREFIX = 'regicidious.access.';
const DELETED_PREFIX = 'regicidious.deleted.';
const ACTIVE_KEY = 'regicidious.active';
const MIGRATED_KEY = 'regicidious.legacy-imported';
const SUITS = ['♠', '♥', '♣', '♦'];
const NAMES = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const app = document.querySelector('#app');
let game = null;
let slotId=null,hubOpen=false;
let storageError = '';
let draft = { mode:'solo',count:2, names: ['You','Crimson Court','Iron Court','Ember Court'] };
let timings = {logic:0,save:0,render:0};
let backupText='',incomingBackup=null,incomingKind=null,incomingSeat=null,backupError='',linkLoading=false;
let selectedOpponent=null,sheetOpen=false,reserveOpen=false;
let computerRecording=null,computerPlayback=null,replayTimer=null;
let backupForSlot=null,deleteCandidate=null,hubNotice='';
let turnLink='',turnLinkSource='',turnLinkBusy=false,turnLinkError='';
let pasteOpen=false;
let inviteLinks={};

try {
  const legacy=localStorage.getItem(KEY);
  if(legacy && !localStorage.getItem(MIGRATED_KEY)) {
    const id=makeSlotId();
    localStorage.setItem(SLOT_PREFIX+id,legacy);
    localStorage.setItem(ACTIVE_KEY,id);
    localStorage.setItem(MIGRATED_KEY,'1');
  }
  slotId=localStorage.getItem(ACTIVE_KEY);
  if(slotId) game=readSlot(slotId);
}
catch { storageError = 'This browser could not read the saved game. Do not clear Safari website data.'; }
if(location.hash.startsWith('#backup=')) {
  if(location.hash.slice(8).startsWith('E1.'))linkLoading=true;
  else try { incomingBackup=validateState(StateCodec.decode(location.hash.slice(8)));incomingKind='backup'; }
  catch { backupError='This backup link is damaged or uses an unsupported version.'; }
}
if(location.hash.startsWith('#turn='))linkLoading=true;

const random = max => {
  const bytes = new Uint32Array(1);
  const limit = Math.floor(4294967296 / max) * max;
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
};
function makeSlotId() { return Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join(''); }
function makeMatchId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''); }
function textAccess() { return Number(localStorage.getItem(ACCESS_PREFIX+game.matchId)??-1); }
function validateState(saved) {
  const bad=()=>{throw Error('Invalid match state');};
  const validIndex=(i,length)=>Number.isInteger(i)&&i>=0&&i<length;
  const validCard=(id,owner)=>typeof id==='string'&&new RegExp(`^${owner}-(?:A|[2-9]|10|J|Q|K)$`).test(id);
  if(saved?.version!==1||!['solo','local','text'].includes(saved.mode)||!Array.isArray(saved.players)||saved.players.length<2||saved.players.length>4)bad();
  const count=saved.players.length;
  if(!validIndex(saved.turn,count)||!validIndex(saved.setup,count)||!Number.isInteger(saved.round)||saved.round<1||saved.round>1000000)bad();
  if(!['setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'].includes(saved.phase)||saved.view!=null&&!validIndex(saved.view,count))bad();
  if(!Number.isInteger(saved.attacks)||saved.attacks>2||saved.attacks<0||!Number.isInteger(saved.kills)||saved.kills<0||saved.kills>2)bad();
  saved.refillUndo??=[];
  if(!Array.isArray(saved.refill)||saved.refill.length>count||new Set(saved.refill).size!==saved.refill.length||saved.refill.some(i=>!validIndex(i,count)))bad();
  if(!Array.isArray(saved.refillUndo)||saved.refillUndo.length>3||saved.refillUndo.some(m=>!validIndex(m.owner,count)||!validIndex(m.from,3)||!validIndex(m.to,3)||!validCard(m.card,m.owner)))bad();
  if(!Number.isInteger(saved.refillIndex)||saved.refillIndex<0||saved.refillIndex>saved.refill.length||saved.phase==='refill'&&saved.refillIndex>=saved.refill.length)bad();
  if(typeof saved.message!=='string'||saved.message.length>2048||!Array.isArray(saved.log)||saved.log.length>1000||saved.log.some(s=>typeof s!=='string'||s.length>2048))bad();
  saved.matchId??='';saved.turnNumber??=1;saved.currentBattles??=[];saved.lastBattles??=[];
  if(typeof saved.matchId!=='string'||saved.matchId&&!/^[a-f0-9]{32}$/.test(saved.matchId)||saved.mode==='text'&&!saved.matchId||!Number.isInteger(saved.turnNumber)||saved.turnNumber<1||saved.turnNumber>1000000)bad();
  for(const events of [saved.currentBattles,saved.lastBattles]){
    if(!Array.isArray(events)||events.length>2)bad();
    for(const e of events){
      if(!validIndex(e.actor,count)||!validIndex(e.defender,count)||e.actor===e.defender||!['front','back'].includes(e.source?.row)||!validIndex(e.source?.index,3)||!['front','back'].includes(e.target?.row)||!validIndex(e.target?.index,3))bad();
      if(!validCard(e.attackCard,e.actor)||!validCard(e.defendCard,e.defender)||!['tie','attack','defend'].includes(e.result))bad();
      if(!Array.isArray(e.attackDice)||!Array.isArray(e.defendDice)||[e.attackDice,e.defendDice].some(d=>d.length<1||d.length>3||d.some(n=>!Number.isInteger(n)||n<1||n>6)))bad();
      if(e.sacrifice!=null&&(!['front','back'].includes(e.sacrifice.row)||!validIndex(e.sacrifice.index,3)))bad();
      for(const [owner,board] of [[e.actor,e.beforeActor],[e.defender,e.beforeDefender]])if(!Array.isArray(board)||board.length!==6||board.some(id=>id!=null&&!validCard(id,owner)))bad();
    }
  }
  saved.players.forEach((p,i)=>{
    if(p?.suit!==i||typeof p.name!=='string'||p.name.length>128||typeof p.alive!=='boolean'||typeof p.cpu!=='boolean'||!Number.isInteger(p.coins)||p.coins<0||p.coins>10000)bad();
    if(!Array.isArray(p.front)||p.front.length!==3||!Array.isArray(p.back)||p.back.length!==3||!Array.isArray(p.reserve)||!Array.isArray(p.deck))bad();
    const cards=[...p.front,...p.back,...p.reserve,...p.deck].filter(id=>id!=null);
    if(cards.length>13||new Set(cards).size!==cards.length||cards.some(id=>!validCard(id,i)))bad();
  });
  if(saved.selection!=null){
    const s=saved.selection,owner=saved.phase==='setup'?saved.setup:saved.phase==='refill'?saved.refill[saved.refillIndex]:saved.turn;
    if(!['front','back','reserve'].includes(s.location)||!validIndex(s.index,s.location==='reserve'?saved.players[owner]?.reserve.length:3))bad();
  }
  if(['battle','queen'].includes(saved.phase)!==Boolean(saved.pending))bad();
  if(saved.pending){
    const b=saved.pending;
    if(!validIndex(b.defender,count)||b.defender===saved.turn||!validIndex(b.source?.index,3)||!['front','back'].includes(b.source?.row)||!validIndex(b.target?.index,3)||!['front','back'].includes(b.target?.row)||b.target.player!==b.defender)bad();
    if(!validCard(b.attackCard,saved.turn)||!validCard(b.defendCard,b.defender)||!['tie','attack','defend'].includes(b.result))bad();
    if(!Array.isArray(b.attackDice)||!Array.isArray(b.defendDice)||[b.attackDice,b.defendDice].some(d=>d.length<1||d.length>3||d.some(n=>!Number.isInteger(n)||n<1||n>6)))bad();
    if(!Array.isArray(b.sacrifice)||b.sacrifice.length>2||b.sacrifice.some(s=>!['front','back'].includes(s.row)||!validIndex(s.index,3)||!validCard(s.id,b.defender)))bad();
    if(saved.players[saved.turn][b.source.row][b.source.index]!==b.attackCard||saved.players[b.defender][b.target.row][b.target.index]!==b.defendCard)bad();
  }
  return saved;
}
function readSlot(id) {
  const raw=localStorage.getItem(SLOT_PREFIX+id);
  if(!raw) return null;
  const saved=raw.startsWith('B1.')?StateCodec.decode(raw):JSON.parse(raw);
  if(saved.version!==1)throw Error('Unsupported match version');
  saved.log??=[]; saved.mode??='local';
  for(const p of saved.players)p.cpu??=false;
  return validateState(saved);
}
function readDates(id) {
  const raw=localStorage.getItem(META_PREFIX+id);
  if(!raw)return {started:0,last:0};
  const [started,last]=raw.split(';').map(Number);
  return {started:Number.isSafeInteger(started)&&started>0?started:0,last:Number.isSafeInteger(last)&&last>0?last:0};
}
function dateText(time) {
  return time?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(time):'not recorded';
}
function relativeText(time) {
  if(!time)return '';
  const elapsed=Math.max(0,Date.now()-time);
  const parts=elapsed<60000?[Math.floor(elapsed/1000),'second']:elapsed<3600000?[Math.floor(elapsed/60000),'minute']:elapsed<86400000?[Math.floor(elapsed/3600000),'hour']:[Math.floor(elapsed/86400000),'day'];
  return new Intl.RelativeTimeFormat(undefined,{numeric:'auto'}).format(-parts[0],parts[1]);
}
async function prepareBackupFor(saved,id) {
  const seat=saved.mode==='text'?Number(localStorage.getItem(ACCESS_PREFIX+saved.matchId)??-1):-1;
  if(saved.mode==='text'&&(seat<0||seat>=saved.players.length))throw Error('Seat ownership unavailable');
  const source=saved.mode==='text'?`P1:${seat}:${StateCodec.encode(saved)}`:StateCodec.encode(saved);
  const token=await LinkCodec.seal(source);
  backupText=location.href.split('#')[0]+'#backup='+token;
  backupForSlot=id;
  render();
}
function lastBattleSentence(saved) {
  const e=saved.lastBattles?.at(-1);
  if(!e)return 'The last turn ended without a battle.';
  const actor=saved.players[e.actor].name,defender=saved.players[e.defender].name;
  if(e.result==='tie')return `${actor}’s ${cardTitle(e.attackCard)} and ${defender}’s ${cardTitle(e.defendCard)} fought to a draw!`;
  if(e.result==='defend')return `${defender}’s ${cardTitle(e.defendCard)} defeated ${actor}’s ${cardTitle(e.attackCard)}!`;
  if(e.sacrifice){const id=e.beforeDefender[(e.sacrifice.row==='back'?3:0)+e.sacrifice.index];return `${defender}’s Queen survived; ${cardTitle(id)} fell instead!`;}
  return `${actor}’s ${cardTitle(e.attackCard)} defeated ${defender}’s ${cardTitle(e.defendCard)}!`;
}
function shareMessage(saved,url) {
  if(saved.phase==='victory')return `${saved.players.find(p=>p.alive)?.name||'A kingdom'} wins Regicidious! ${lastBattleSentence(saved)} ${url}`;
  return `${lastBattleSentence(saved)} ${saved.players[saved.turn].name}, it’s your turn #${saved.turnNumber}. To arms! ${url}`;
}
function ensureTurnLink() {
  if(!game||game.mode!=='text')return;
  const source=StateCodec.encode(game);
  if(source===turnLinkSource&&(turnLink||turnLinkBusy))return;
  turnLinkSource=source;turnLink='';turnLinkBusy=true;turnLinkError='';
  LinkCodec.seal(source).then(token=>{
    if(turnLinkSource!==source)return;
    turnLink=location.href.split('#')[0]+'#turn='+token;turnLinkBusy=false;render();
  }).catch(error=>{turnLinkBusy=false;turnLinkError='Could not prepare the turn link. Try again.';console.error(error);render();});
}
function ensureInvites(){
  if(!game||game.mode!=='text'||textAccess()!==0)return;
  const source=StateCodec.encode(game);
  for(let seat=1;seat<game.players.length;seat++){
    if(inviteLinks[seat]?.source===source)continue;
    inviteLinks[seat]={source,url:''};
    LinkCodec.seal(`P1:${seat}:${source}`).then(token=>{
      if(inviteLinks[seat]?.source!==source)return;
      inviteLinks[seat].url=location.href.split('#')[0]+'#backup='+token;render();
    }).catch(error=>{console.error(error);});
  }
}
function gameSlots() {
  const slots=[];
  for(let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);
    if(!key?.startsWith(SLOT_PREFIX))continue;
    try { const id=key.slice(SLOT_PREFIX.length),g=readSlot(id);if(g)slots.push({id,game:g,dates:readDates(id)}); }
    catch { /* Preserve a damaged save; never silently delete it. */ }
  }
  return slots.sort((a,b)=>a.id===slotId?-1:b.id===slotId?1:0);
}
function pastePanel() {
  return pasteOpen?`<section class="panel"><h2>Open a game link</h2><p class="muted small">Paste a turn or backup link here if Messages opened Safari instead of your Home Screen app.</p><label class="field"><span>Game link</span><textarea data-import-url rows="3" placeholder="https://…/#turn=…"></textarea></label><div class="actions"><button class="button" data-action="import-link">Open link →</button><button class="button secondary" data-action="close-link">Cancel</button></div></section>`:`<button class="button secondary wide" data-action="open-link">Open a turn or backup link</button>`;
}
function shuffle(items) { for (let i = items.length - 1; i > 0; i--) { const j = random(i + 1); [items[i],items[j]] = [items[j],items[i]]; } return items; }
const rank = id => id.split('-')[1];
const value = id => ['A','J','Q','K'].includes(rank(id)) ? 10 : Number(rank(id));
const isPeasant = id => value(id) >= 2 && value(id) <= 9;
const suit = id => SUITS[Number(id.split('-')[0])];
const label = id => `${rank(id)}${suit(id)}`;
const escapeHTML = str => String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const player = index => game.players[index];
const living = () => game.players.map((p,i) => p.alive ? i : -1).filter(i => i >= 0);
const hasCard = (p, r) => [...p.front,...p.back,...p.reserve].some(id => id && rank(id) === r);

function commit(change) {
  const previous = game ? structuredClone(game) : null;
  const previousSlot=slotId;
  try {
    const started=performance.now();
    change();
    timings.logic=Math.round((performance.now()-started)*1000);
    const saving=performance.now();
    localStorage.setItem(SLOT_PREFIX+slotId, StateCodec.encode(game));
    localStorage.setItem(ACTIVE_KEY,slotId);
    if(game.mode==='text'&&previousSlot!==slotId&&localStorage.getItem(ACCESS_PREFIX+game.matchId)==null)localStorage.setItem(ACCESS_PREFIX+game.matchId,String(game.turn));
    try {
      const now=Date.now(),dates=previousSlot===slotId?readDates(slotId):{started:now,last:now};
      localStorage.setItem(META_PREFIX+slotId,`${dates.started};${now}`);
    } catch { /* Match data remains saved even if date metadata cannot be written. */ }
    timings.save=Math.round((performance.now()-saving)*1000);
    storageError = '';
    const painting=performance.now();
    render();
    timings.render=Math.round((performance.now()-painting)*1000);
    const indicator=app.querySelector('.perf');
    if(indicator) indicator.textContent=`Last move: logic ${timings.logic} µs · save ${timings.save} µs · UI ${timings.render} µs`;
    return true;
  } catch (error) {
    game = previous;
    slotId=previousSlot;
    computerRecording=null;computerPlayback=null;clearTimeout(replayTimer);
    storageError = 'Could not save this move. Free device storage and allow Safari website storage before continuing.';
    render();
    console.error(error);
    return false;
  }
}
function newGame() {
  slotId=makeSlotId();
  const count = draft.count;
  const players = Array.from({length:count}, (_,i) => {
    const pool = shuffle(RANKS.filter(r => !['J','Q','K'].includes(r)).map(r => `${i}-${r}`));
    const six = [`${i}-K`,`${i}-Q`,`${i}-J`,...pool.splice(0,3)];
    pool.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b)));
    const p={ name:draft.names[i].trim() || `Player ${i+1}`, suit:i, cpu:draft.mode==='solo' && i!==0, front:[six[1],six[2],six[3]], back:[six[0],six[4],six[5]], reserve:[], deck:pool, coins:0, alive:true };
    if (p.cpu) arrangeAI(p);
    return p;
  });
  game = {version:1,mode:draft.mode,players,turn:0,round:1,phase:draft.mode==='text'?'buy':'setup',setup:0,view:draft.mode==='text'?0:null,selection:null,attacks:0,kills:0,pending:null,refill:[],refillIndex:0,refillUndo:[],matchId:makeMatchId(),turnNumber:1,currentBattles:[],lastBattles:[],message:'',log:[]};
  navigator.storage?.persist?.().catch(() => {});
}
function advanceTurn() {
  const alive = living();
  if (alive.length <= 1) { game.phase = 'victory'; game.view = null; return; }
  const next = alive.find(i => i > game.turn) ?? alive[0];
  if (next <= game.turn) game.round++;
  if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
  game.turn = next; game.phase = 'buy'; game.view = game.mode==='text'?next:null; game.selection = null;
  game.attacks = 0; game.kills = 0; game.pending = null;
  game.message = player(next).cpu?`${player(next).name} is thinking…`:game.mode==='solo'?'Your turn. Buy cards or arrange your line.':game.mode==='text'?`${player(next).name}’s turn #${game.turnNumber}.`:`${player(next).name}'s turn. Pass the phone to them.`;
}
function cardHTML(id, action, location, index, opts={}) {
  const selected = game?.selection && game.selection.location === location && game.selection.index === index;
  const attrs = action ? `data-action="${action}" data-location="${location}" data-index="${index}"` : 'disabled';
  const place=opts.owner!=null?`${player(opts.owner).name}, ${opts.row} slot ${index+1}, `:'';
  if (!id) return `<button class="card empty ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}empty slot">+</button>`;
  if (opts.hidden) return `<button class="card back ${opts.target?'target':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}face-down card"><span class="center">♛</span></button>`;
  return `<button class="card ${['♥','♦'].includes(suit(id))?'red':''} ${selected?'selected':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}${label(id)}"><span class="rank">${rank(id)}<small>${suit(id)}</small></span><span class="center">${suit(id)}</span><span class="rank foot">${rank(id)}<small>${suit(id)}</small></span></button>`;
}
function lineHTML(cards, action, location, hidden=false) { return `<div class="line">${cards.map((id,i) => cardHTML(id,action,location,i,{hidden})).join('')}</div>`; }
function frame(content,compact=false) {
  app.innerHTML = `<main class="app ${compact?'compact-app':''}"><header class="top ${compact?'compact-top':''}"><div class="brand">♛ Regicidious</div><div class="top-actions">${compact?`<button class="pill" data-action="toggle-sheet" aria-label="Game details">☰</button>`:''}<button class="pill" data-action="games">Games</button></div></header>${storageError ? `<div class="status" role="alert">${storageError}</div>` : ''}${backupError ? `<div class="status" role="alert">${backupError}</div>` : ''}${content}${!compact&&!game&&!hubOpen&&!incomingBackup?pastePanel():''}${!compact&&game?.mode==='solo'&&!hubOpen&&!incomingBackup?`<section class="panel"><h3>Keep a backup</h3><p class="muted small">A backup link contains the whole match, including hidden cards. Keep it private.</p><button class="button secondary wide" data-action="backup">Make backup link</button>${backupText?`<label class="field" style="margin-top:12px"><span>Backup link · copy this if clipboard access is unavailable</span><textarea readonly rows="3">${escapeHTML(backupText)}</textarea></label><button class="button secondary" data-action="copy-backup">Copy link</button>`:''}</section>`:''}${compact?'':`<p class="notice">Created by Shane Holmgren · Digital adaptation: Regicidious<br>Saved on this device after every move. Keep Safari website data to keep your game.<br><span class="perf">Last move: logic ${timings.logic} µs · save ${timings.save} µs · UI ${timings.render} µs</span></p>`}</main>`;
}
function renderHub() {
  const slots=gameSlots();
  frame(`<section class="hero"><div class="crown">♛</div><h1>Your games</h1><p>Every match stays here until you delete it or Safari website data is removed.</p></section>${hubNotice?`<p class="status">${escapeHTML(hubNotice)}</p>`:''}${slots.map(({id,game:g,dates})=>`<section class="panel"><div class="phase">${g.mode==='solo'?'Solo':g.mode==='text'?'Text multiplayer':'Pass the phone'} · Round ${g.round}</div><h2>${escapeHTML(g.players[0].name)}${g.mode==='solo'?' vs computer':''}</h2><p class="muted small">${g.phase==='victory'?'Finished':`Current turn: ${escapeHTML(g.players[g.turn].name)}`} · ${g.players.length} kingdoms</p><p class="muted small">Started ${dateText(dates.started)}<br>Last move ${dateText(dates.last)}${dates.last?` · ${relativeText(dates.last)}`:''}</p><button class="button wide" data-action="open-game" data-id="${id}">${g.phase==='victory'?'View game':'Continue →'}</button><div class="actions"><button class="button secondary" data-action="backup-slot" data-id="${id}">Make backup link</button><button class="button ghost" data-action="delete-game" data-id="${id}">Delete game</button></div>${backupForSlot===id&&backupText?`<label class="field"><span>Private backup link</span><textarea readonly rows="3">${escapeHTML(backupText)}</textarea></label><button class="button secondary" data-action="copy-backup">Copy link</button>`:''}${deleteCandidate===id?`<div class="delete-confirm"><p>This removes this game from this device. You can restore it only if you kept a backup link.</p><div class="actions"><button class="button danger" data-action="confirm-delete" data-id="${id}">Delete local game</button><button class="button secondary" data-action="cancel-delete">Cancel</button></div></div>`:''}</section>`).join('')}<div class="actions"><button class="button secondary wide" data-action="new-game">Start another game</button></div>${pastePanel()}`);
}
function renderImport() {
  const p=incomingBackup.players[incomingBackup.turn];
  const turn=incomingKind==='turn';
  frame(`<section class="panel"><div class="phase">${turn?'Text-message turn':'Backup link'}</div><h2>${turn?`${escapeHTML(p.name)}’s turn #${incomingBackup.turnNumber}`:'Restore this match?'}</h2><p class="muted">Round ${incomingBackup.round} · ${incomingBackup.players.length} players</p><p class="small">${turn?'Opening this link updates your local copy and replays the last fights. Only the addressed turn can move.':'Restoring adds another saved game. Your current games remain untouched.'}</p><div class="actions"><button class="button" data-action="restore-backup">${turn?'Open turn →':'Add backup'}</button><button class="button secondary" data-action="keep-current">Keep current games</button></div></section>`);
}
function renderTextWaiting() {
  ensureTurnLink();
  ensureInvites();
  const p=player(game.turn);
  const invites=textAccess()===0?`<section class="panel"><h2>Invite players to their own seats</h2><p class="small muted">Send each player only their named invite once. Invites bind their device to that seat, even before their first turn.</p>${game.players.map((q,i)=>i===0?'':`<p>${escapeHTML(q.name)} ${SUITS[i]}</p>${inviteLinks[i]?.url?`<div class="actions"><button class="button secondary" data-action="copy-invite" data-index="${i}">Copy invite</button><button class="button secondary" data-action="share-invite" data-index="${i}">Share…</button></div><textarea readonly rows="2">${escapeHTML(inviteLinks[i].url)}</textarea>`:'<p class="small muted">Preparing invite…</p>'}`).join('')}</section>`:'';
  frame(`<section class="hero"><div class="crown">${SUITS[game.turn]}</div><div class="phase">Text multiplayer · turn #${game.turnNumber}</div><h1>${escapeHTML(p.name)}’s turn</h1><p>Your local copy is waiting for the next turn link. Anyone in the group can send this link to ${escapeHTML(p.name)}.</p></section><section class="panel"><h2>Send the turn</h2><p class="muted small">${escapeHTML(lastBattleSentence(game))}</p>${turnLinkError?`<p class="status">${escapeHTML(turnLinkError)}</p>`:''}${turnLink?`<div class="actions"><button class="button" data-action="copy-turn">Copy message</button><button class="button secondary" data-action="share-turn">Share to app…</button></div><label class="field"><span>Message and link</span><textarea readonly rows="5">${escapeHTML(shareMessage(game,turnLink))}</textarea></label>`:'<p class="muted small">Preparing a private turn link…</p>'}<p class="muted small">The link contains the whole match and a key. Keep it in your game group; it deters casual peeking but cannot prevent cheating.</p></section>${invites}${pastePanel()}`);
}
function renderStart() {
  const modes=[['solo','Solo vs computer'],['local','Pass the phone'],['text','Text-message multiplayer']];
  frame(`<section class="hero"><div class="crown">♛</div><h1>Regicidious</h1><p>A tiny kingdom, a dangerous front line, and two attacks to make your mark.</p></section><section class="panel"><h2>Choose your battlefield</h2><p class="muted small">Solo and pass-the-phone work offline. Text multiplayer exchanges a new game link each turn.</p><div class="label">Mode</div><div class="actions mode-actions">${modes.map(([mode,title])=>`<button class="button ${draft.mode===mode?'':'ghost'}" data-action="mode" data-value="${mode}">${title}</button>`).join('')}</div><div class="label">${draft.mode==='solo'?'Computer opponents':'Players'}</div><div class="actions">${[2,3,4].map(n=>`<button class="button ${draft.count===n?'':'ghost'}" data-action="count" data-value="${n}">${draft.mode==='solo'?n-1:n}</button>`).join('')}</div><div class="stack" style="margin-top:18px">${draft.names.slice(0,draft.mode==='solo'?1:draft.count).map((name,i)=>`<label class="field"><span>${SUITS[i]} ${draft.mode==='solo'?'Your name':NAMES[i]}</span><input data-name="${i}" maxlength="24" value="${escapeHTML(name)}" autocomplete="off"></label>`).join('')}</div>${draft.mode==='text'?`<p class="small muted">One player creates the game and names all players. Each turn is carried by a private link. Anyone with the link could inspect or replay it; this is casual privacy, not cheat-proof multiplayer.</p>`:''}<div class="actions"><button class="button wide" data-action="start">Begin the war →</button></div></section><details class="panel"><summary>How this version plays</summary><ul class="rule-list"><li>Arrange six cards, then take turns buying, rearranging, and attacking up to twice.</li><li>Tap your front-line attacker or a back-line Knight, then an enemy card. A front-line Knight can reach the enemy back line; a back-line Knight can attack only the enemy front.</li><li>Highest single die wins. Ties spare both cards. Defeated cards return to the owner’s shuffled pile.</li><li>A surviving Jack earns one coin; each enemy card defeated earns one more. Cards cost two coins.</li><li>Civ bonuses are not included yet.</li></ul></details>`);
}
function renderVeil() {
  const index = game.phase === 'setup' ? game.setup : game.phase === 'refill' ? game.refill[game.refillIndex] : game.phase === 'queen' ? game.pending.defender : game.turn;
  const text = game.phase === 'setup' ? 'Arrange your starting cards in private.' : game.phase === 'refill' ? 'Fill any front-line gaps in private.' : game.phase === 'queen' ? 'Your Queen sacrifices the weakest adjacent peasant.' : 'Your kingdom is waiting.';
  const solo=game.mode==='solo';
  frame(`<section class="veil"><div><div class="crown">${SUITS[index]}</div><div class="phase">${solo?'Your kingdom':'Pass the phone'}</div><h1>${escapeHTML(player(index).name)}</h1><p>${text}${solo?'':'<br>Make sure only this player can see the screen.'}</p><div class="actions"><button class="button wide" data-action="reveal">${solo?'Continue →':`I’m ${escapeHTML(player(index).name)} — reveal`}</button></div></div></section>`);
}
function renderBoard(index, mode) {
  const p = player(index);
  const boardAction = mode === 'arrange' || mode === 'setup' || mode === 'refill' ? 'slot' : mode === 'attack' ? 'attacker' : '';
  return `<div class="board-title"><h3>${escapeHTML(p.name)} <span class="${[1,3].includes(index)?'red':'gold'}">${SUITS[index]}</span></h3><span class="pill">◉ ${p.coins} · Deck ${p.deck.length}</span></div><div class="label">Back line</div>${lineHTML(p.back,boardAction,'back')}<div class="label">Front line</div>${lineHTML(p.front,boardAction,'front')}${p.reserve.length ? `<div class="label">Reserve · place in an empty slot</div><div class="reserve">${p.reserve.map((id,i) => cardHTML(id,mode==='arrange'||mode==='refill'?'slot':'','reserve',i)).join('')}</div>` : ''}`;
}
function renderOpponents() {
  return game.players.map((p,i) => i === game.turn || !p.alive ? '' : `<section class="opponent"><div class="board-title"><h3>${escapeHTML(p.name)} ${SUITS[i]}</h3><span class="pill">${p.front.filter(Boolean).length+p.back.filter(Boolean).length} in play</span></div><div class="label">Back line</div>${lineHTML(p.back,'target',`${i}:back`,true)}<div class="label">Front line</div>${lineHTML(p.front,'target',`${i}:front`,true)}</section>`).join('');
}
function arenaRow(owner,row,own,mode,visual) {
  const p=player(owner);
  const cards=p[row].map((id,index)=>{
    let action='';
    if(own && ['setup','arrange','refill'].includes(mode))action='slot';
    if(own && mode==='attack' && id && (row==='front'||rank(id)==='10'))action='attacker';
    if(!own && mode==='attack' && id)action='target';
    const source=visual?.source?.owner===owner&&visual.source.row===row&&visual.source.index===index;
    const target=visual?.target?.owner===owner&&visual.target.row===row&&visual.target.index===index;
    const loser=visual?.loser?.owner===owner&&visual.loser.row===row&&visual.loser.index===index;
    const winner=visual?.winner?.owner===owner&&visual.winner.row===row&&visual.winner.index===index;
    const reveal=source||target&&visual?.revealTarget||!own && mode==='battle' && game.pending?.defender===owner && game.pending.target.row===row && game.pending.target.index===index;
    const hidden=visual?(!own||visual.hideOwnOthers||player(owner).cpu)&&!reveal:!own&&!reveal;
    const active=source||target&&visual?.showTarget;
    const className=visual?`${!active?'replay-dim':''} ${active?'replay-active':''} ${source&&visual.kind==='reveal'?'replay-flip':''} ${loser?'replay-loser':''} ${winner?'replay-winner':''}`:'';
    return cardHTML(id,action,own?row:`${owner}:${row}`,index,{hidden,owner,row,target:reveal,className});
  });
  return `<div class="arena-row"><span class="arena-label">${row==='front'?'Front line':'Back line'}</span><div class="line">${cards.join('')}</div></div>`;
}
function arenaDetails() {
  if(!sheetOpen)return '';
  const share=game.mode==='text'?`<p class="small muted">Turn #${game.turnNumber}: ${escapeHTML(player(game.turn).name)}</p><p class="small muted">Finish your turn to create the next player's link.</p>`:'';
  const backup=`<button class="button secondary wide" data-action="backup">Make backup link</button>${backupForSlot===slotId&&backupText?`<textarea readonly rows="3">${escapeHTML(backupText)}</textarea><button class="button secondary" data-action="copy-backup">Copy backup link</button>`:''}`;
  return `<div class="sheet-scrim" data-action="toggle-sheet"></div><section class="arena-sheet" role="dialog" aria-label="Game details"><div class="row"><h3>Game details</h3><button class="button ghost" data-action="toggle-sheet">Close</button></div><p class="muted small">Round ${game.round} · ${escapeHTML(player(game.turn).name)} · ${escapeHTML(game.phase)}</p><p class="small">${escapeHTML(game.message||'Tap a card to select it. The highest individual die wins.')}</p>${game.log?.length?`<div class="small muted">${game.log.slice(-6).reverse().map(item=>`<p>${escapeHTML(item)}</p>`).join('')}</div>`:''}${share}${backup}<p class="small muted">Created by Shane Holmgren. Last move: logic ${timings.logic} µs · save ${timings.save} µs · UI ${timings.render} µs.</p></section>`;
}
function arenaReserve(owner) {
  const p=player(owner);
  if(!p.reserve.length||!['setup','arrange'].includes(game.phase))return '';
  return `<button class="reserve-trigger" data-action="reserve">Reserve ${p.reserve.length} ▴</button>${reserveOpen?`<div class="reserve-overlay"><div class="row"><strong>Reserve cards</strong><button class="button ghost" data-action="reserve">Close</button></div><p class="small muted">Select a card, then tap a board slot.</p><div class="reserve">${p.reserve.map((id,i)=>cardHTML(id,'slot','reserve',i,{owner,row:'reserve'})).join('')}</div></div>`:''}`;
}
function renderArena(owner,mode,intro,controls,visual) {
  const candidates=living().filter(i=>i!==owner);
  const opponent=visual?.opponent??(mode==='battle'&&game.pending?.defender!==owner?game.pending.defender:(candidates.includes(selectedOpponent)?selectedOpponent:candidates[0]));
  selectedOpponent=opponent;
  const target=opponent==null?null:player(opponent);
  const switcher=!visual&&candidates.length>1?`<div class="opponent-switch"><button data-action="opponent-nav" data-step="-1" aria-label="Previous opponent">‹</button><strong>${escapeHTML(target.name)} ${SUITS[opponent]}</strong><button data-action="opponent-nav" data-step="1" aria-label="Next opponent">›</button></div>`:`<strong>${target?`${escapeHTML(target.name)} ${SUITS[opponent]}`:'Your opponent'}</strong>`;
  let middle=`<div class="arena-instruction">${escapeHTML((visual||mode==='refill')?intro:game.message||intro)}</div>`;
  if(mode==='battle'||visual?.showDice) {
    const b=game.pending;
    middle=`<div class="clash-dice" data-dice-lane aria-live="off"><div class="clash-side"><span>${label(b.defendCard)}</span><div class="dice">${b.defendDice.map(()=>`<span class="die">?</span>`).join('')}</div></div><span class="clash-versus">vs</span><div class="clash-side"><span>${label(b.attackCard)}</span><div class="dice">${b.attackDice.map(()=>`<span class="die">?</span>`).join('')}</div></div></div>`;
  }
  const own=player(owner);
  frame(`<section class="arena" aria-label="Battlefield"><div class="arena-opponent"><div class="arena-hud">${switcher}<span>${target?`${target.front.filter(Boolean).length+target.back.filter(Boolean).length} cards`:''}</span></div>${target?arenaRow(opponent,'back',false,mode,visual):''}${target?arenaRow(opponent,'front',false,mode,visual):''}</div><div class="arena-middle">${middle}</div><div class="arena-self"><div class="arena-hud"><strong>${escapeHTML(own.name)} ${SUITS[owner]}</strong><span>◉ ${own.coins} · ${game.attacks}/2 attacks</span></div>${arenaRow(owner,'front',true,mode,visual)}${arenaRow(owner,'back',true,mode,visual)}${arenaReserve(owner)}</div><div class="arena-dock ${visual?'replay-dock':''}">${controls}</div></section>${arenaDetails()}`,true);
}
function renderPlay() {
  const p = player(game.turn);
  let intro = '';
  let controls = '';
  if (game.phase === 'buy') {
    intro = `Draw one random card from your shuffled suit pile for 2 coins. You can buy more than one.`;
    controls = `<button class="button" data-action="buy" ${p.coins<2||!p.deck.length?'disabled':''}>Buy a card · 2 ◉</button><button class="button secondary" data-action="next">Arrange →</button>`;
  } else if (game.phase === 'arrange') {
    intro = `Tap two cards or an empty slot to move or swap. Front and back hold three each. Once you attack, your layout is locked for this turn.`;
    controls = `<button class="button wide" data-action="next">Attack →</button>`;
  } else if (game.phase === 'attack') {
    intro = `Attack ${game.attacks+1}/2: tap your front card or back-line Knight, then an enemy card.`;
    controls = `<button class="button secondary wide" data-action="finish-attacks">${game.attacks ? 'Finish attacks' : 'Skip attacks'} →</button>`;
  } else {
    const jack = hasCard(p,'J') ? 1 : 0;
    intro = `${game.kills} defeated ${game.kills===1?'card':'cards'} + ${jack} Jack bonus = ${game.kills+jack} ${game.kills+jack===1?'coin':'coins'}.`;
    controls = `<button class="button wide" data-action="income">Collect ${game.kills+jack} ◉ and end turn →</button>`;
  }
  renderArena(game.turn,game.phase,intro,controls);
}
function renderRefill() {
  const index = game.refill[game.refillIndex], p = player(index);
  const gaps = p.front.filter(id => !id).length;
  renderArena(index,'refill',gaps?`Fill ${Math.min(gaps,p.back.filter(Boolean).length)} front gap: tap a back card, then an empty front slot.`:'Front line ready. Tap a newly moved card, then its old back slot to undo.',`<button class="button wide" data-action="refill-done" ${gaps && p.back.some(Boolean)?'disabled':''}>${gaps?'Fill front gap first':'Confirm front line →'}</button>`);
}
function queenNeighbor(p, row, index) {
  return [index-1,index+1].filter(i => i>=0 && i<3 && isPeasant(p[row][i] || '')).map(i => ({row,index:i,id:p[row][i]}));
}
function diceCount(attacker, defender, source, target) {
  let a = 1, d = 1;
  if (value(attacker) > value(defender)) a++;
  if (value(defender) > value(attacker)) d++;
  if (rank(attacker)==='10' && target.row==='front') a++;
  if (rank(attacker)==='Q' && queenNeighbor(player(game.turn),source.row,source.index).length) a++;
  if (rank(defender)==='Q' && queenNeighbor(player(target.player),target.row,target.index).length) d++;
  return [a,d];
}
function roll(count) { return Array.from({length:count}, () => random(6)+1); }
function renderBattle() {
  const b = game.pending;
  const rescue=b.result==='attack'&&b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
  const outcome = b.result === 'tie' ? 'A draw. Both survive.' : rescue?`${player(b.defender).name}’s Queen is saved; ${cardTitle(rescue.id)} falls.`:b.result === 'attack' ? `${player(b.defender).name} loses ${label(b.defendCard)}.` : `${player(game.turn).name} loses ${label(b.attackCard)}.`;
  renderArena(game.turn,'battle',outcome,`<div class="battle-result" aria-live="polite" hidden>${escapeHTML(outcome)}</div><button class="button" data-action="battle-next" disabled>Continue →</button>`);
  animateDice(b);
}
function animateDice(b) {
  const lane=app.querySelector('[data-dice-lane]');
  if(!lane)return;
  const faces=[...lane.querySelectorAll('.die')],numbers=[...b.defendDice,...b.attackDice];
  const finish=()=>{
    if(!lane.isConnected)return;
    faces.forEach((face,i)=>{face.textContent=numbers[i];});
    lane.setAttribute('aria-live','polite');
    const result=app.querySelector('.battle-result'),button=app.querySelector('[data-action="battle-next"]');
    if(result)result.hidden=false;
    if(button)button.disabled=false;
    try { navigator.vibrate?.(18); } catch { /* iOS may not support vibration. */ }
  };
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){finish();return;}
  const delays=[65,80,105,135,165];
  let step=0;
  const cycle=()=>{
    if(!lane.isConnected)return;
    faces.forEach(face=>{face.textContent=random(6)+1;});
    if(step<delays.length)setTimeout(cycle,delays[step++]);
    else finish();
  };
  cycle();
}
function cardTitle(id) {
  const r=rank(id);
  return r==='10'?'Knight (10)':r==='A'?'Assassin (Ace)':r==='K'?'King':r==='Q'?'Queen':r==='J'?'Jack':`Peasant (${r})`;
}
function weakestSacrifice(b) {
  return b.sacrifice.reduce((best,s,i,a)=>value(s.id)<value(a[best].id)?i:best,0);
}
function recordComputer(kind,target) {
  if(computerRecording)computerRecording.push({kind,target,state:structuredClone(game)});
}
function runAIWithReplay() {
  computerRecording=game.mode==='solo'?[]:null;
  try { runAI(); }
  finally {
    if(computerRecording?.length)computerPlayback={frames:computerRecording,index:0,viewerSeat:0};
    computerRecording=null;
  }
}
function startTextReplay(saved) {
  const frames=[];
  for(const e of saved.lastBattles||[]){
    const state=structuredClone(saved);
    state.turn=e.actor;state.phase='attack';state.selection={location:e.source.row,index:e.source.index};state.pending=null;
    state.players[e.actor].front=e.beforeActor.slice(0,3);state.players[e.actor].back=e.beforeActor.slice(3);state.players[e.actor].alive=true;
    state.players[e.defender].front=e.beforeDefender.slice(0,3);state.players[e.defender].back=e.beforeDefender.slice(3);state.players[e.defender].alive=true;
    const target={owner:e.defender,row:e.target.row,index:e.target.index};
    frames.push({kind:'reveal',state:structuredClone(state),target});
    frames.push({kind:'target',state:structuredClone(state),target});
    const sacrifice=e.sacrifice?[{...e.sacrifice,id:e.beforeDefender[(e.sacrifice.row==='back'?3:0)+e.sacrifice.index]}]:[];
    state.phase='battle';state.selection=null;
    state.pending={defender:e.defender,source:e.source,target:{player:e.defender,...e.target},attackCard:e.attackCard,defendCard:e.defendCard,attackDice:e.attackDice,defendDice:e.defendDice,result:e.result,sacrifice};
    frames.push({kind:'roll',state:structuredClone(state)});
    frames.push({kind:'result',state:structuredClone(state)});
  }
  if(frames.length)computerPlayback={frames,index:0,viewerSeat:textAccess(),textReplay:true};
}
function advanceReplay() {
  if(!computerPlayback)return;
  clearTimeout(replayTimer);
  computerPlayback.index++;
  if(computerPlayback.index>=computerPlayback.frames.length)computerPlayback=null;
  render();
}
function renderPlayback() {
  const playback=computerPlayback,step=playback.frames[playback.index];
  const finalGame=game;
  game=step.state;
  try {
    const b=game.pending,attacker=game.turn;
    const source=b?{owner:attacker,row:b.source.row,index:b.source.index}:{owner:attacker,row:game.selection.location,index:game.selection.index};
    const target=b?{owner:b.defender,row:b.target.row,index:b.target.index}:step.target;
    const owner=target.owner,actor=player(attacker).name,opponent=player(owner).name;
    let narration='';
    if(step.kind==='reveal'){
      const title=cardTitle(player(attacker)[source.row][source.index]);
      narration=`${actor} shows ${/^[AEIOU]/.test(title)?'an':'a'} ${title}!`;
    }
    if(step.kind==='target')narration=`${actor}’s ${cardTitle(player(attacker)[source.row][source.index])} attacks ${owner===playback.viewerSeat?'your':`${opponent}’s`} ${owner===playback.viewerSeat?cardTitle(player(owner)[target.row][target.index]):'face-down card'}!`;
    if(step.kind==='roll')narration='The dice tumble…';
    let loser=null,winner=null;
    if(step.kind==='result') {
      if(b.result==='tie')narration='A draw! Both cards survive.';
      else if(b.result==='attack') {
        const sacrifice=b.sacrifice.length?weakestSacrifice(b):-1;
        loser=sacrifice>=0?{owner,row:b.sacrifice[sacrifice].row,index:b.sacrifice[sacrifice].index}:target;
        winner=source;
        narration=sacrifice>=0?`${opponent}’s Queen survives; ${cardTitle(b.sacrifice[sacrifice].id)} falls instead.`:`${actor} defeats ${opponent}’s ${cardTitle(b.defendCard)}!`;
      } else {loser=source;winner=target;narration=`${opponent}’s ${cardTitle(b.defendCard)} defeats ${actor}’s ${cardTitle(b.attackCard)}!`;}
    }
    const visual={kind:step.kind,opponent:attacker,source,target,showTarget:step.kind!=='reveal',revealTarget:['roll','result'].includes(step.kind),showDice:['roll','result'].includes(step.kind),hideOwnOthers:playback.textReplay,loser,winner};
    renderArena(owner,'replay',narration,`<div class="replay-narration" aria-live="polite">${escapeHTML(narration)}</div><button class="button secondary" data-action="replay-next">${playback.index===playback.frames.length-1?'Done':'Next'} →</button>`,visual);
    if(step.kind==='roll')animateDice(b);
    if(step.kind==='result'){
      const faces=app.querySelectorAll('[data-dice-lane] .die');
      [...faces].forEach((face,i)=>{face.textContent=[...b.defendDice,...b.attackDice][i];});
    }
    clearTimeout(replayTimer);
    replayTimer=setTimeout(advanceReplay,{reveal:600,target:650,roll:900,result:700}[step.kind]);
  } finally {game=finalGame;}
}
function renderQueen() {
  const b = game.pending, p = player(b.defender);
  frame(`<section class="panel"><h2>Royal sacrifice</h2><p class="muted">${escapeHTML(p.name)}’s Queen is saved by the weakest adjacent peasant.</p><button class="button wide" data-action="sacrifice">Continue →</button></section>`);
}
function renderVictory() {
  const winner = player(living()[0]);
  if(game.mode==='text')ensureTurnLink();
  frame(`<section class="hero"><div class="crown">♛</div><div class="phase">The kingdom stands</div><h1>${escapeHTML(winner.name)} wins.</h1><p>${SUITS[winner.suit]} ${NAMES[winner.suit]} is the last kingdom standing. This finished game remains saved on this device.</p></section>${game.mode==='text'?`<section class="panel"><h2>Tell the group</h2>${turnLink?`<div class="actions"><button class="button" data-action="copy-turn">Copy result</button><button class="button secondary" data-action="share-turn">Share to app…</button></div>`:'<p class="muted">Preparing result link…</p>'}</section>`:''}<section class="panel"><h2>Another game?</h2><p class="muted small">Starting another game leaves this one in your Games list.</p><button class="button secondary wide" data-action="new-after-win">New game</button></section>`);
}
function renderStalemate() {
  frame(`<section class="hero"><div class="crown">♛</div><h1>No winner yet.</h1><p>This match reached the computer-play safety limit. Its full state is saved in your Games list.</p></section><section class="panel"><button class="button secondary wide" data-action="new-game">Start another game</button></section>`);
}
function render() {
  if(linkLoading)return frame(`<section class="panel"><h2>Opening game link…</h2><p class="muted">Checking and decrypting the match.</p></section>`);
  if(incomingBackup) return renderImport();
  if(hubOpen) return renderHub();
  if(computerPlayback)return renderPlayback();
  if (!game) return renderStart();
  if(game.mode==='text'&&textAccess()!==game.turn&&game.phase!=='victory')return renderTextWaiting();
  if (game.phase === 'victory') return renderVictory();
  if (game.phase === 'stalemate') return renderStalemate();
  if (game.view === null) return renderVeil();
  if (game.phase === 'setup') {
    renderArena(game.setup,'setup',game.message || 'Tap two of your cards to swap. Keep at least as many in front as behind.',`<button class="button wide" data-action="setup-done">Lock formation →</button>`);
  } else if (game.phase === 'refill') renderRefill();
  else if (game.phase === 'queen') renderQueen();
  else if (game.phase === 'battle') renderBattle();
  else renderPlay();
}

function slotAt(p, loc) { return p[loc]; }
function moveSlot(owner, location, index) {
  const p = player(owner);
  if (!['front','back','reserve'].includes(location) || !Number.isInteger(index) || index < 0 || index >= p[location].length) return;
  const current = {location,index};
  if (!game.selection) { if (p[location][index]) game.selection = current; return; }
  const from = game.selection;
  if (from.location===location && from.index===index) { game.selection=null; return; }
  const a = slotAt(p,from.location), b = slotAt(p,location);
  if (game.phase==='refill') {
    const forward=from.location==='back'&&location==='front'&&!b[index];
    const undo=from.location==='front'&&location==='back'&&!b[index]&&game.refillUndo?.find(m=>m.owner===owner&&m.to===from.index&&m.from===index&&m.card===a[from.index]);
    if(!forward&&!undo){game.selection=null;return;}
    if(forward)game.refillUndo.push({owner,from:from.index,to:index,card:a[from.index]});
    if(undo)game.refillUndo.splice(game.refillUndo.indexOf(undo),1);
  }
  if (from.location==='reserve' && location==='reserve') return;
  // A King must remain in a line; a reserve cannot be used as a safe hiding place.
  if ((location==='reserve' && rank(a[from.index])==='K') || (from.location==='reserve' && b[index] && rank(b[index])==='K')) { game.message='Your King must stay on the battlefield.'; game.selection=null; return; }
  [a[from.index],b[index]] = [b[index] || null,a[from.index]];
  if (from.location==='reserve' && !a[from.index]) a.splice(from.index,1);
  if (location==='reserve' && !b[index]) b.splice(index,1);
  game.selection=null;
}
function completeRefill() {
  game.selection=null; game.refillUndo=[]; game.refillIndex++;
  if (game.refillIndex < game.refill.length) game.view=null;
  else { game.phase='income'; game.view=game.turn; game.message=''; }
}
function finishAttacks() {
  game.refill = game.players.map((p,i) => p.alive && p.front.includes(null) && p.back.some(Boolean) ? i : -1).filter(i => i>=0);
  for(const i of game.refill.filter(i=>player(i).cpu||game.mode==='text')) refillAI(player(i));
  game.refill=game.refill.filter(i=>!player(i).cpu&&game.mode!=='text');
  game.refillIndex=0; game.refillUndo=[]; game.selection=null;
  game.message='';
  if (game.refill.length) { game.phase='refill'; game.view=null; }
  else { game.phase='income'; game.message=''; }
}
function defeat(owner,row,index) {
  const p = player(owner), id=p[row][index];
  p[row][index]=null;
  if (rank(id)==='K') p.alive=false;
  else { p.deck.push(id); p.deck.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b))); }
}
function drawCard(p) { return p.deck.splice(random(p.deck.length),1)[0]; }
function resolveBattle() {
  const b=game.pending;
  const sacrificeIndex=b.result==='attack'&&b.sacrifice.length?weakestSacrifice(b):-1;
  const defeated=b.result==='attack' ? sacrificeIndex>=0?b.sacrifice[sacrificeIndex].id:b.defendCard : b.result==='defend'?b.attackCard:null;
  game.log ??=[];
  game.log.push(`${player(game.turn).name} ${label(b.attackCard)} [${b.attackDice.join(',')}] vs ${player(b.defender).name} ${label(b.defendCard)} [${b.defendDice.join(',')}]: ${defeated?`${label(defeated)} defeated`:'draw'}.`);
  if (game.log.length>24) game.log.shift();
  if (b.result==='attack') {
    if (sacrificeIndex>=0) { const slot=b.sacrifice[sacrificeIndex]; defeat(b.defender,slot.row,slot.index); }
    else defeat(b.defender,b.target.row,b.target.index);
    game.kills++;
  } else if (b.result==='defend') defeat(game.turn,b.source.row,b.source.index);
  game.attacks++;
  game.pending=null; game.selection=null;
  if (living().length<=1) {
    if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
    game.phase='victory'; game.view=null; return;
  }
  game.phase='attack'; game.view=player(game.turn).cpu?null:game.turn; game.message=`${game.attacks} of 2 attacks used. ${game.attacks<2?'You may attack again or finish.':''}`;
  if (game.attacks>=2 || !player(game.turn).front.some(Boolean) && !player(game.turn).back.some(id=>id&&rank(id)==='10')) finishAttacks();
}

function cardPriority(id) {
  const r=rank(id);
  return r==='Q'?18:r==='10'?17:r==='A'?15:r==='J'?13:r==='9'?12:r==='8'?11:r==='K'?-100:value(id);
}
function arrangeAI(p) {
  const cards=[...p.front,...p.back,...p.reserve].filter(Boolean);
  const king=cards.find(id=>rank(id)==='K');
  if(king && cards.length===1){p.front=[king,null,null];p.back=[null,null,null];p.reserve=[];return;}
  const queen=cards.find(id=>rank(id)==='Q');
  let front=[];
  if (queen) {
    const neighbor=cards.filter(id=>isPeasant(id)).sort((a,b)=>cardPriority(b)-cardPriority(a))[0];
    front=[queen,...(neighbor?[neighbor]:[])];
  }
  front.push(...cards.filter(id=>id!==king&&!front.includes(id)).sort((a,b)=>cardPriority(b)-cardPriority(a)));
  front=front.slice(0,3);
  const rest=cards.filter(id=>!front.includes(id)).sort((a,b)=>cardPriority(b)-cardPriority(a));
  p.front=[...front,...Array(3-front.length).fill(null)];
  p.back=[king,...rest.filter(id=>id!==king).slice(0,2)];
  while(p.back.length<3) p.back.push(null);
  p.reserve=rest.filter(id=>id!==king).slice(2);
}
function refillAI(p) {
  for(let i=0;i<3;i++) if(!p.front[i]) {
    let from=p.back.findIndex(id=>id && rank(id)!=='K');
    if(from<0)from=p.back.findIndex(Boolean);
    if(from<0) break;
    p.front[i]=p.back[from]; p.back[from]=null;
  }
}
function chooseAIAttack() {
  const self=player(game.turn);
  const targets=[];
  for(const enemy of living()) if(enemy!==game.turn) {
    for(const row of ['front','back']) for(let index=0;index<3;index++) if(player(enemy)[row][index]) targets.push({enemy,row,index});
  }
  const choices=[];
  for(const sourceRow of ['front','back']) for(let index=0;index<3;index++) {
    const id=self[sourceRow][index]; if(!id || sourceRow==='back' && rank(id)!=='10') continue;
    for(const t of targets) {
      if(t.row==='back' && (rank(id)!=='10' || sourceRow==='back')) continue;
      // Evaluate a probability model for a face-down card, never its actual rank.
      const guesses=t.row==='back'?[['K',.48],['Q',.12],['J',.12],['10',.08],['8',.2]]:[['Q',.23],['J',.18],['10',.14],['A',.12],['8',.33]];
      let score=0;
      for(const [r,probability] of guesses) {
        const imagined=`${t.enemy}-${r}`;
        const attackCount=1+(value(id)>value(imagined)?1:0)+(rank(id)==='10'&&t.row==='front'?1:0)+(rank(id)==='Q'&&queenNeighbor(self,sourceRow,index).length?1:0);
        const defendCount=1+(value(imagined)>value(id)?1:0);
        const ordinary=diceOdds(attackCount,defendCount);
        const guarded=r==='Q'?diceOdds(attackCount,defendCount+1):ordinary;
        const odds={win:ordinary.win*.65+guarded.win*.35,lose:ordinary.lose*.65+guarded.lose*.35};
        const targetValue=r==='K'?7:r==='Q'?2.4:r==='10'?1.7:1;
        const ownValue=rank(id)==='K'?7:rank(id)==='Q'?2.6:rank(id)==='10'?1.8:1;
        score+=probability*(odds.win*(1+targetValue)-odds.lose*(rank(id)==='A'?0:ownValue));
      }
      if(t.row==='front' && player(t.enemy).front.filter(Boolean).length===1) score+=.15;
      score+=(random(1000)/1000)*.025;
      choices.push({sourceRow,sourceIndex:index,...t,score});
    }
  }
  return choices.sort((a,b)=>b.score-a.score)[0];
}
function computeDiceOdds(a,d) {
  let win=0,lose=0;
  for(let k=1;k<=6;k++) {
    const pA=(k/6)**a-((k-1)/6)**a;
    const pD=(k/6)**d-((k-1)/6)**d;
    win+=pA*((k-1)/6)**d;
    lose+=pD*((k-1)/6)**a;
  }
  return {win,lose};
}
const ODDS=Array.from({length:4},(_,a)=>Array.from({length:4},(_,d)=>a&&d?computeDiceOdds(a,d):null));
function diceOdds(a,d) { return ODDS[a][d]; }
function runAI(maxSteps=2000) {
  let steps=0;
  while(game.phase!=='victory' && player(game.turn).cpu) {
    if(++steps>maxSteps) { game.phase='stalemate';game.message='Computer-play safety limit reached.';return; }
    const p=player(game.turn);
    if(game.phase==='buy') {
      while(p.coins>=2 && p.deck.length && p.reserve.length<3) { p.coins-=2; p.reserve.push(drawCard(p)); }
      game.phase='arrange';
    } else if(game.phase==='arrange') { arrangeAI(p); game.phase='attack'; }
    else if(game.phase==='attack') {
      const choice=game.attacks<2 && chooseAIAttack();
      if(!choice) { finishAttacks(); continue; }
      game.selection={location:choice.sourceRow,index:choice.sourceIndex};
      const target={owner:choice.enemy,row:choice.row,index:choice.index};
      recordComputer('reveal',target);
      recordComputer('target',target);
      attack(choice.enemy,choice.row,choice.index);
      recordComputer('roll');
    } else if(game.phase==='battle') {
      recordComputer('result');
      resolveBattle();
    } else if(game.phase==='refill') {
      // A human refill needs the private handoff screen.
      if(game.refill.length) { game.view=null; return; }
      game.phase='income';
    } else if(game.phase==='income') {
      p.coins+=game.kills+(hasCard(p,'J')?1:0);
      advanceTurn();
    } else return;
  }
}
function attack(targetPlayer,row,index) {
  const source=game.selection;
  if (!source || !['front','back'].includes(source.location) || !player(game.turn)[source.location][source.index]) return;
  if (targetPlayer===game.turn || !player(targetPlayer)?.alive || !player(targetPlayer)[row]?.[index]) return;
  const attackCard=player(game.turn)[source.location][source.index], defendCard=player(targetPlayer)[row][index];
  if(source.location==='back' && (rank(attackCard)!=='10' || row!=='front')) { game.message='A back-line Knight can attack only the enemy front line.'; return; }
  if (row==='back' && rank(attackCard)!=='10') { game.message='Only a Knight (10) can attack the back line.'; return; }
  const sourceSlot={row:source.location,index:source.index}, target={player:targetPlayer,row,index};
  const [a,d]=diceCount(attackCard,defendCard,sourceSlot,target);
  const attackDice=roll(a), defendDice=roll(d);
  let result=Math.max(...attackDice)>Math.max(...defendDice)?'attack':Math.max(...attackDice)<Math.max(...defendDice)?'defend':'tie';
  if (result==='defend' && rank(attackCard)==='A') result='tie';
  const sacrifice=result==='attack' && rank(defendCard)==='Q' ? queenNeighbor(player(targetPlayer),row,index) : [];
  if(game.mode==='text') {
    const chosen=sacrifice.length?sacrifice[weakestSacrifice({sacrifice})]:null;
    game.currentBattles.push({actor:game.turn,defender:targetPlayer,source:sourceSlot,target:{row,index},attackCard,defendCard,attackDice,defendDice,result,sacrifice:chosen?{row:chosen.row,index:chosen.index}:null,beforeActor:[...player(game.turn).front,...player(game.turn).back],beforeDefender:[...player(targetPlayer).front,...player(targetPlayer).back]});
  }
  game.pending={defender:targetPlayer,source:sourceSlot,target,attackCard,defendCard,attackDice,defendDice,result,sacrifice};
  game.phase='battle'; game.selection=null; game.message='';
}

app.addEventListener('input', event => {
  if (event.target.matches('[data-name]')) draft.names[Number(event.target.dataset.name)] = event.target.value;
});
app.addEventListener('click', event => {
  const button=event.target.closest('[data-action]');
  if(computerPlayback) {
    if(button?.dataset.action==='games') { clearTimeout(replayTimer);computerPlayback=null;hubOpen=true;render(); }
    else advanceReplay();
    return;
  }
  if (!button) return;
  const action=button.dataset.action, index=Number(button.dataset.index);
  if(action==='open-link'){pasteOpen=true;render();return;}
  if(action==='close-link'){pasteOpen=false;render();return;}
  if(action==='import-link'){
    const raw=app.querySelector('[data-import-url]')?.value.trim()||'';
    let hash='';
    try { hash=raw.startsWith('#')?raw:new URL(raw,location.href).hash; }
    catch { /* Explain malformed links below. */ }
    if(!/^#(?:turn|backup)=/.test(hash)){backupError='Paste a Regicidious turn or backup link.';render();return;}
    pasteOpen=false;openIncomingHash(hash);return;
  }
  if(action==='backup-slot') {
    try { const saved=readSlot(button.dataset.id);if(saved)prepareBackupFor(saved,button.dataset.id).catch(error=>{backupError='Could not prepare a backup link.';console.error(error);render();}); }
    catch(error){backupError='Could not read this game for backup.';console.error(error);render();}
    return;
  }
  if(action==='copy-backup' && backupText) { navigator.clipboard?.writeText(backupText).catch(()=>{});return; }
  if(action==='copy-invite'&&inviteLinks[index]?.url){navigator.clipboard?.writeText(`${game.players[index].name}, join Regicidious as ${SUITS[index]}: ${inviteLinks[index].url}`).catch(()=>{});return;}
  if(action==='share-invite'&&inviteLinks[index]?.url){
    const message=`${game.players[index].name}, join Regicidious as ${SUITS[index]}: ${inviteLinks[index].url} `;
    if(navigator.share)navigator.share({text:message}).catch(error=>{if(error.name!=='AbortError')console.error(error);});
    return;
  }
  if(action==='copy-turn'&&game?.mode==='text'&&turnLink) { navigator.clipboard?.writeText(shareMessage(game,turnLink)).catch(()=>{});return; }
  if(action==='share-turn'&&game?.mode==='text'&&turnLink) {
    if(navigator.share)navigator.share({text:shareMessage(game,turnLink)+' '}).catch(error=>{if(error.name!=='AbortError'){turnLinkError='Sharing failed. Copy the message instead.';console.error(error);render();}});
    else {turnLinkError='Sharing is unavailable here. Copy the message instead.';render();}
    return;
  }
  if(action==='delete-game'){deleteCandidate=button.dataset.id;render();return;}
  if(action==='cancel-delete'){deleteCandidate=null;render();return;}
  if(action==='confirm-delete' && deleteCandidate===button.dataset.id){
    const id=deleteCandidate;
    try {
      const doomed=readSlot(id);if(!doomed)throw Error('Match missing');
      localStorage.removeItem(SLOT_PREFIX+id);
      localStorage.removeItem(META_PREFIX+id);
      if(doomed.mode==='text'){
        const owned=localStorage.getItem(ACCESS_PREFIX+doomed.matchId);
        if(owned!=null)localStorage.setItem(DELETED_PREFIX+doomed.matchId,owned);
        localStorage.removeItem(ACCESS_PREFIX+doomed.matchId);
      }
      if(id===slotId){localStorage.removeItem(ACTIVE_KEY);slotId=null;game=null;}
      deleteCandidate=null;hubNotice='Game removed from this device. A saved backup link can restore it.';
      render();
    }catch(error){storageError='Could not delete this game. Its remaining data was not cleared.';console.error(error);render();}
    return;
  }
  if(action==='backup' && game) {
    prepareBackupFor(game,slotId).catch(error=>{backupError='Could not prepare a backup link.';console.error(error);render();});return;
  }
  if(action==='toggle-sheet') { sheetOpen=!sheetOpen;render();return; }
  if(action==='reserve') { reserveOpen=!reserveOpen;render();return; }
  if(action==='opponent') { selectedOpponent=index;render();return; }
  if(action==='opponent-nav') {
    const owner=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.turn;
    const candidates=living().filter(i=>i!==owner);
    if(candidates.length>1){const current=Math.max(0,candidates.indexOf(selectedOpponent));selectedOpponent=candidates[(current+Number(button.dataset.step)+candidates.length)%candidates.length];render();}
    return;
  }
  if(action==='games') { hubOpen=true;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='new-game' || action==='new-after-win') { game=null;slotId=null;hubOpen=false;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='open-game') {
    try { const chosen=readSlot(button.dataset.id);if(!chosen)throw Error('Missing match');game=chosen;slotId=button.dataset.id;hubOpen=false;sheetOpen=false;reserveOpen=false;backupText='';localStorage.setItem(ACTIVE_KEY,slotId);storageError='';render(); }
    catch(error) { storageError='This game could not be opened. Its saved data was not changed.';render();console.error(error); }
    return;
  }
  if(action==='keep-current') { incomingBackup=null;incomingKind=null;incomingSeat=null;hubOpen=!game;history.replaceState(null,'',location.pathname+location.search);render();return; }
  if(action==='restore-backup' && incomingBackup) {
    const restored=incomingBackup,kind=incomingKind,seat=incomingSeat;
    const existing=restored.mode==='text'?gameSlots().find(s=>s.game.matchId===restored.matchId):null;
    if(restored.mode==='text'&&kind==='turn'&&!existing&&localStorage.getItem(DELETED_PREFIX+restored.matchId)!=null){
      incomingBackup=null;incomingKind=null;incomingSeat=null;backupError='This game was deleted here. Restore your own seat with your backup or invite link; a turn link cannot claim another seat.';hubOpen=true;render();return;
    }
    if(existing){
      const same=StateCodec.encode(existing.game)===StateCodec.encode(restored);
      if(restored.turnNumber<existing.game.turnNumber||restored.turnNumber===existing.game.turnNumber&&!same){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This link is older than your saved match or conflicts with it. Your saved game was kept.';
        history.replaceState(null,'',location.pathname+location.search);hubOpen=true;render();return;
      }
    }
    if(commit(()=>{game=restored;slotId=existing?.id??makeSlotId();backupText='';hubOpen=false;})) {
      if(restored.mode==='text'&&seat!=null&&(!existing||textAccess()<0)){
        localStorage.setItem(ACCESS_PREFIX+restored.matchId,String(seat));
        localStorage.removeItem(DELETED_PREFIX+restored.matchId);
      }
      if(restored.mode==='text'&&kind==='turn'&&(!existing||existing.game.turnNumber<restored.turnNumber))startTextReplay(restored);
      incomingBackup=null;incomingKind=null;incomingSeat=null;
      history.replaceState(null,'',location.pathname+location.search);render();
    }
    return;
  }
  if(storageError) return;
  if (action==='count') { draft.count=Number(button.dataset.value); render(); return; }
  if (action==='mode') { draft.mode=button.dataset.value; render(); return; }
  if (action==='start') return commit(newGame);
  if (!game) return;
  if(game.mode==='text'&&textAccess()!==game.turn)return;
  commit(() => {
    if (action==='reveal') { game.view=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.phase==='queen'?game.pending.defender:game.turn; return; }
    if (action==='slot') {
      const owner=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.turn;
      if (['setup','arrange','refill'].includes(game.phase)) { moveSlot(owner,button.dataset.location,index);if(button.dataset.location==='reserve')reserveOpen=false; }
      return;
    }
    if (action==='setup-done' && game.phase==='setup') {
      const p=player(game.setup);
      if (p.back.filter(Boolean).length>p.front.filter(Boolean).length) { game.message='Your back line cannot outnumber your front line.'; return; }
      if (game.setup+1<game.players.length && game.mode!=='solo') { game.setup++; game.view=null; game.selection=null; game.message=''; }
      else { game.phase='buy'; game.turn=0; game.view=null; game.selection=null; game.message=game.mode==='solo'?'The war begins. Your turn.':'The war begins. Pass the phone to the first player.'; }
      return;
    }
    if (action==='buy' && game.phase==='buy') { const p=player(game.turn); if (p.coins>=2 && p.deck.length) { p.coins-=2; p.reserve.push(drawCard(p)); } return; }
    if (action==='next') {
      if (game.phase==='arrange' && player(game.turn).back.filter(Boolean).length>player(game.turn).front.filter(Boolean).length) { game.message='Move cards forward: your back line cannot outnumber your front line.'; return; }
      if (game.phase==='buy') game.phase='arrange'; else if (game.phase==='arrange') game.phase='attack';
      game.selection=null; game.message=''; return;
    }
    if (action==='attacker' && game.phase==='attack') {
      const row=button.dataset.location,id=player(game.turn)[row]?.[index];
      if (id && (row==='front' || row==='back' && rank(id)==='10')) game.selection=game.selection?.location===row&&game.selection.index===index?null:{location:row,index};
      return;
    }
    if (action==='target' && game.phase==='attack') { const [owner,row]=button.dataset.location.split(':'); attack(Number(owner),row,index); return; }
    if (action==='battle-next' && game.phase==='battle') { resolveBattle(); return; }
    if (action==='sacrifice' && game.phase==='queen') { resolveBattle(); if(player(game.turn).cpu) runAIWithReplay(); return; }
    if (action==='finish-attacks' && game.phase==='attack') { finishAttacks(); return; }
    if (action==='refill-done' && game.phase==='refill') { const p=player(game.refill[game.refillIndex]); if (!p.front.includes(null) || !p.back.some(Boolean)) { completeRefill(); if(player(game.turn).cpu) runAIWithReplay(); } return; }
    if (action==='income' && game.phase==='income') { player(game.turn).coins+=game.kills+(hasCard(player(game.turn),'J')?1:0); advanceTurn(); runAIWithReplay(); }
  });
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
render();
async function openIncomingHash(hash){
  linkLoading=true;backupError='';incomingBackup=null;incomingKind=null;incomingSeat=null;render();
  try {
    const kind=hash.startsWith('#turn=')?'turn':'backup';
    const token=hash.slice(kind==='turn'?6:8);
    let decoded=token.startsWith('E1.')?await LinkCodec.open(token):token;
    if(kind==='backup'&&decoded.startsWith('P1:')){
      const match=/^P1:([0-3]):(B1\..+)$/.exec(decoded);
      if(!match)throw Error('Invalid seat backup');
      incomingSeat=Number(match[1]);decoded=match[2];
    }
    const saved=validateState(StateCodec.decode(decoded));
    if(kind==='turn'&&saved.mode!=='text')throw Error('Not a text match');
    if(incomingSeat!=null&&(saved.mode!=='text'||incomingSeat>=saved.players.length))throw Error('Invalid seat backup');
    incomingBackup=saved;incomingKind=kind;
  } catch(error) { backupError='This game link is damaged, stale, or cannot be opened.';console.error(error); }
  linkLoading=false;render();
}
if(linkLoading)openIncomingHash(location.hash);
