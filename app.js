/* Regicidious — framework-free, offline-first card game. */
const KEY = 'regicidious.game.v1';
const SLOT_PREFIX = 'regicidious.match.';
const META_PREFIX = 'regicidious.meta.';
const ACCESS_PREFIX = 'regicidious.access.';
const DELETED_PREFIX = 'regicidious.deleted.';
const ACTIVE_KEY = 'regicidious.active';
const PLAYER_NAME_KEY = 'regicidious.player-name';
const MIGRATED_KEY = 'regicidious.legacy-imported';
const SUITS = ['♠', '♥', '♣', '♦'];
const NAMES = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const app = document.querySelector('#app');
let game = null;
let slotId=null,hubOpen=false;
let storageError = '';
let draft = { mode:'solo',count:2, layout:'expanded', names: ['You','Crimson Court','Iron Court','Ember Court'] };
try {
  const rememberedName=localStorage.getItem(PLAYER_NAME_KEY);
  if(rememberedName!=null&&rememberedName.trim())draft.names[0]=rememberedName.slice(0,24);
} catch { /* The game remains usable if preferences cannot be read. */ }
function rememberPlayerName(name) {
  try { localStorage.setItem(PLAYER_NAME_KEY,String(name).slice(0,24)); }
  catch { /* Saving a preference must not block a game move. */ }
}
let timings = {logic:0,save:0,render:0};
let backupText='',incomingBackup=null,incomingKind=null,incomingSeat=null,backupError='',linkLoading=false;
let selectedOpponent=null,sheetOpen=false,reserveOpen=false;
let computerRecording=null,computerPlayback=null,replayTimer=null;
let historyLock=false,matchReplay=null,matchReplayTimer=null,matchHoldTimer=null;
let backupForSlot=null,deleteCandidate=null,hubNotice='';
let turnLink='',turnLinkSource='',turnLinkBusy=false,turnLinkError='';
let pasteOpen=false;
let inviteLinks={};
let setupOpen=false,installDismissed=false,deleteTimer=null,buyPrompt=null,buyPromptTimer=null,completedOpen=false;
let retreatArmed=null,retreatTimer=null;
const expandedGameDates=new Set();
const SEAT_COOKIE='rgseat_';
try { installDismissed=localStorage.getItem('regicidious.install-tip.dismissed')==='1'; } catch { /* Storage warning appears elsewhere. */ }
const micro=n=>`${Math.round(n).toLocaleString()} µs`;

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
catch { storageError = 'Could not load saved games. Please check browser storage settings.'; }
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
function cookieSeat(matchId) {
  try {
    const m=String(document.cookie||'').match(new RegExp(`(?:^|; )${SEAT_COOKIE}${matchId}=([0-3])`));
    return m?m[1]:null;
  } catch { return null; }
}
function persistSeat(matchId,seat) {
  localStorage.setItem(ACCESS_PREFIX+matchId,String(seat));
  try { document.cookie=`${SEAT_COOKIE}${matchId}=${seat};max-age=31536000;path=/;SameSite=Lax`; }
  catch { /* Safari may ignore cookies; localStorage remains the primary seat claim. */ }
}
function recallSeat(matchId) {
  const ls=localStorage.getItem(ACCESS_PREFIX+matchId);
  if(ls!=null)return ls;
  const cookie=cookieSeat(matchId);
  if(cookie!=null){
    try { localStorage.setItem(ACCESS_PREFIX+matchId,cookie); } catch { /* Cookie is a fallback copy only. */ }
    return cookie;
  }
  return null;
}
function textAccess() { return Number(recallSeat(game.matchId)??-1); }
function clearLinkError() { backupError=''; }
function encodeForBackup(state) {
  const full=StateCodec.encode(state);
  if(full.length<=65536)return full;
  return StateCodec.encode(state,{history:false});
}
function encodeForTurn(state) {
  if(state.history?.origin){
    const full=StateCodec.encode(state);
    if(full.length<=8000)return full;
  }
  return StateCodec.encode(state,{history:false});
}
function captureOrigin(state) {
  return {
    turn:state.turn,round:state.round,phase:state.phase,setup:state.setup,view:state.view,
    attacks:state.attacks,kills:state.kills,turnNumber:state.turnNumber||1,
    players:state.players.map(p=>({front:[...p.front],back:[...p.back],reserve:[...p.reserve],deck:[...p.deck],coins:p.coins,alive:p.alive,cpu:p.cpu}))
  };
}
function record(event) {
  if(historyLock||!game?.history?.events||game.history.truncated)return;
  if(game.history.events.length>=8192){game.history.truncated=true;return;}
  game.history.events.push(event);
}
function canReplay(saved) {
  return saved?.phase==='victory' && !!saved.history?.origin && Array.isArray(saved.history.events) && saved.history.events.length>0 && !saved.history.truncated;
}
function canReplayLast(saved=game) {
  return saved?.mode==='text' && Array.isArray(saved.lastBattles) && saved.lastBattles.length>0;
}
function replayLastButton(compact=false) {
  if(!canReplayLast()||hubOpen||incomingBackup)return '';
  return `<button class="button ${compact?'ghost replay-last-btn':'secondary wide'}" data-action="replay-last">Replay last battles</button>`;
}
function validateState(saved) {
  const bad=()=>{throw Error('Invalid match state');};
  const validIndex=(i,length)=>Number.isInteger(i)&&i>=0&&i<length;
  const validCard=(id,owner)=>typeof id==='string'&&new RegExp(`^${owner}-(?:A|[2-9]|10|J|Q|K)$`).test(id);
  if(saved?.version!==1||!['solo','local','text'].includes(saved.mode)||!Array.isArray(saved.players)||saved.players.length<2||saved.players.length>4)bad();
  const count=saved.players.length;
  saved.layout??='classic';
  if(saved.layout!=='classic'&&saved.layout!=='expanded')bad();
  // The old rule bit remains readable in links, but all matches now use one rule set.
  saved.queenRule='cedric';
  const cols=saved.layout==='expanded'?4:3, boardLen=cols*2;
  if(!validIndex(saved.turn,count)||!validIndex(saved.setup,count)||!Number.isInteger(saved.round)||saved.round<1||saved.round>1000000)bad();
  if(!['setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'].includes(saved.phase)||saved.view!=null&&!validIndex(saved.view,count))bad();
  if(!Number.isInteger(saved.attacks)||saved.attacks>2||saved.attacks<0||!Number.isInteger(saved.kills)||saved.kills<0||saved.kills>2)bad();
  saved.refillUndo??=[];
  if(!Array.isArray(saved.refill)||saved.refill.length>count||new Set(saved.refill).size!==saved.refill.length||saved.refill.some(i=>!validIndex(i,count)))bad();
  if(!Array.isArray(saved.refillUndo)||saved.refillUndo.length>3||saved.refillUndo.some(m=>!validIndex(m.owner,count)||!validIndex(m.from,cols)||!validIndex(m.to,cols)||!validCard(m.card,m.owner)))bad();
  if(!Number.isInteger(saved.refillIndex)||saved.refillIndex<0||saved.refillIndex>saved.refill.length||saved.phase==='refill'&&saved.refillIndex>=saved.refill.length)bad();
  if(typeof saved.message!=='string'||saved.message.length>2048||!Array.isArray(saved.log)||saved.log.length>1000||saved.log.some(s=>typeof s!=='string'||s.length>2048))bad();
  saved.matchId??='';saved.turnNumber??=1;saved.currentBattles??=[];saved.lastBattles??=[];saved.history??=null;saved.startedAt??=0;
  if(!Number.isInteger(saved.startedAt)||saved.startedAt<0||saved.startedAt>4e12)bad();
  if(typeof saved.matchId!=='string'||saved.matchId&&!/^[a-f0-9]{32}$/.test(saved.matchId)||saved.mode==='text'&&!saved.matchId||!Number.isInteger(saved.turnNumber)||saved.turnNumber<1||saved.turnNumber>1000000)bad();
  for(const events of [saved.currentBattles,saved.lastBattles]){
    if(!Array.isArray(events)||events.length>2)bad();
    for(const e of events){
      if(!validIndex(e.actor,count)||!validIndex(e.defender,count)||e.actor===e.defender||!['front','back'].includes(e.source?.row)||!validIndex(e.source?.index,cols)||!['front','back'].includes(e.target?.row)||!validIndex(e.target?.index,cols))bad();
      if(!validCard(e.attackCard,e.actor)||!validCard(e.defendCard,e.defender)||!['tie','attack','defend'].includes(e.result))bad();
      if(!Array.isArray(e.attackDice)||!Array.isArray(e.defendDice)||[e.attackDice,e.defendDice].some(d=>d.length<1||d.length>3||d.some(n=>!Number.isInteger(n)||n<1||n>6)))bad();
      if(e.sacrifice!=null&&(!['front','back'].includes(e.sacrifice.row)||!validIndex(e.sacrifice.index,cols)))bad();
      for(const [owner,board] of [[e.actor,e.beforeActor],[e.defender,e.beforeDefender]])if(!Array.isArray(board)||board.length!==boardLen||board.some(id=>id!=null&&!validCard(id,owner)))bad();
    }
  }
  saved.players.forEach((p,i)=>{
    if(p?.suit!==i||typeof p.name!=='string'||p.name.length>128||typeof p.alive!=='boolean'||typeof p.cpu!=='boolean'||!Number.isInteger(p.coins)||p.coins<0||p.coins>10000)bad();
    if(!Array.isArray(p.front)||p.front.length!==cols||!Array.isArray(p.back)||p.back.length!==cols||!Array.isArray(p.reserve)||!Array.isArray(p.deck))bad();
    const cards=[...p.front,...p.back,...p.reserve,...p.deck].filter(id=>id!=null);
    if(cards.length>13||new Set(cards).size!==cards.length||cards.some(id=>!validCard(id,i)))bad();
  });
  if(saved.selection!=null){
    const s=saved.selection,owner=saved.phase==='setup'?saved.setup:saved.phase==='refill'?saved.refill[saved.refillIndex]:saved.turn;
    if(!['front','back','reserve'].includes(s.location)||!validIndex(s.index,s.location==='reserve'?saved.players[owner]?.reserve.length:cols))bad();
  }
  if(saved.history!=null){
    const hist=saved.history,origin=hist.origin;
    if(typeof hist!=='object'||!origin||!Array.isArray(origin.players)||origin.players.length!==count||!Array.isArray(hist.events)||hist.events.length>8192)bad();
    if(!validIndex(origin.turn,count)||!validIndex(origin.setup,count)||!['setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'].includes(origin.phase))bad();
    if(!Number.isInteger(origin.round)||origin.round<1||origin.view!=null&&!validIndex(origin.view,count))bad();
    origin.players.forEach((p,i)=>{
      if(!Array.isArray(p.front)||p.front.length!==cols||!Array.isArray(p.back)||p.back.length!==cols||!Array.isArray(p.reserve)||!Array.isArray(p.deck))bad();
      const cards=[...p.front,...p.back,...p.reserve,...p.deck].filter(id=>id!=null);
      if(cards.some(id=>!validCard(id,i))||typeof p.alive!=='boolean'||typeof p.cpu!=='boolean'||!Number.isInteger(p.coins)||p.coins<0)bad();
    });
    for(const e of hist.events){
      if(!e||typeof e.t!=='string')bad();
      if(e.t==='swap'&&(!validIndex(e.owner,count)||!['front','back','reserve'].includes(e.from?.location)||!['front','back','reserve'].includes(e.to?.location)))bad();
      if(e.t==='buy'&&!validCard(e.card,saved.turn)&&!(typeof e.card==='string'&&/^[0-3]-(?:A|[2-9]|10|J|Q|K)$/.test(e.card)))bad();
      if(e.t==='phase'&&!['setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'].includes(e.phase))bad();
      if(e.t==='attack'){
        if(!validIndex(e.defender,count)||!['front','back'].includes(e.source?.row)||!['front','back'].includes(e.target?.row)||!['tie','attack','defend'].includes(e.result))bad();
        if(!Array.isArray(e.attackDice)||!Array.isArray(e.defendDice)||!Array.isArray(e.sacrifice))bad();
      }
      if(e.t==='arrangeSet'){
        if(!validIndex(e.owner,count)||!Array.isArray(e.front)||e.front.length!==cols||!Array.isArray(e.back)||e.back.length!==cols||!Array.isArray(e.reserve))bad();
      }
    }
  }
  if(['battle','queen'].includes(saved.phase)!==Boolean(saved.pending))bad();
  if(saved.pending){
    const b=saved.pending;
    if(!validIndex(b.defender,count)||b.defender===saved.turn||!validIndex(b.source?.index,cols)||!['front','back'].includes(b.source?.row)||!validIndex(b.target?.index,cols)||!['front','back'].includes(b.target?.row)||b.target.player!==b.defender)bad();
    if(!validCard(b.attackCard,saved.turn)||!validCard(b.defendCard,b.defender)||!['tie','attack','defend'].includes(b.result))bad();
    if(!Array.isArray(b.attackDice)||!Array.isArray(b.defendDice)||[b.attackDice,b.defendDice].some(d=>d.length<1||d.length>3||d.some(n=>!Number.isInteger(n)||n<1||n>6)))bad();
    const sacrificeOwner=b.result==='defend'?saved.turn:b.defender;
    if(!Array.isArray(b.sacrifice)||b.sacrifice.length>2||b.sacrifice.some(s=>!['front','back'].includes(s.row)||!validIndex(s.index,cols)||!validCard(s.id,sacrificeOwner)))bad();
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
function startedDayText(time) {
  if(!time)return 'not recorded';
  const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;
  return new Intl.RelativeTimeFormat(undefined,{numeric:'auto'}).format(day(new Date(time))-day(new Date()),'day');
}
function gameDateButton(id,kind,time) {
  const label=kind==='last'?'Last move · ':'Started: ';
  if(!time)return `<span class="game-date">${label}not recorded</span>`;
  const expanded=expandedGameDates.has(`${id}:${kind}`);
  const value=expanded?dateText(time):kind==='last'?relativeText(time):startedDayText(time);
  return `<button type="button" class="game-date" data-action="toggle-game-date" data-id="${escapeHTML(id)}" data-kind="${kind}" aria-pressed="${expanded}" title="${expanded?'Show relative date':'Show full date and time'}">${label}${escapeHTML(value)}</button>`;
}
async function prepareBackupFor(saved,id) {
  const seat=saved.mode==='text'?Number(recallSeat(saved.matchId)??-1):-1;
  if(saved.mode==='text'&&(seat<0||seat>=saved.players.length))throw Error('Seat ownership unavailable');
  const source=saved.mode==='text'?`P1:${seat}:${encodeForBackup(saved)}`:encodeForBackup(saved);
  const token=await LinkCodec.seal(source);
  backupText=location.href.split('#')[0]+'#backup='+token;
  backupForSlot=id;
  render();
}
function battleSentence(saved,e) {
  const actor=saved.players[e.actor].name,defender=saved.players[e.defender].name;
  if(e.result==='tie')return `${actor}’s ${cardTitle(e.attackCard)} and ${defender}’s ${cardTitle(e.defendCard)} fought to a draw!`;
  if(e.sacrifice){const owner=e.result==='attack'?e.defender:e.actor;const board=e.result==='attack'?e.beforeDefender:e.beforeActor;const fl=board.length>>1;const id=board[(e.sacrifice.row==='back'?fl:0)+e.sacrifice.index];return royalSacrificeSentence(saved.players[owner].name,e.result==='attack'?e.defendCard:e.attackCard,id);}
  if(e.result==='defend')return `${defender}’s ${cardTitle(e.defendCard)} defended itself and slew ${actor}’s ${cardTitle(e.attackCard)}.`;
  return `${actor}’s ${cardTitle(e.attackCard)} defeated ${defender}’s ${cardTitle(e.defendCard)}!`;
}
function lastBattleSentence(saved) {
  const events=saved.lastBattles||[];
  if(!events.length)return 'The last turn ended without a battle.';
  return events.map((e,i)=>`${i?'Meanwhile, ':''}${battleSentence(saved,e)}`).join(' ');
}
function shareMessage(saved,url) {
  if(saved.phase==='victory')return `${saved.players.find(p=>p.alive)?.name||'A kingdom'} wins Regicidious! ${lastBattleSentence(saved)} ${url}`;
  if(saved.phase==='setup')return `${saved.players[saved.turn].name}, the enemy is at the gates! Set your battle lines in Regicidious. ${url}`;
  return `${lastBattleSentence(saved)} ${saved.players[saved.turn].name}, it’s your turn #${saved.turnNumber}. To arms! ${url}`;
}
function ensureTurnLink() {
  if(!game||game.mode!=='text')return;
  const source=encodeForTurn(game);
  if(source===turnLinkSource&&(turnLink||turnLinkBusy))return;
  turnLinkSource=source;turnLink='';turnLinkBusy=true;turnLinkError='';
  LinkCodec.seal(source).then(token=>{
    if(turnLinkSource!==source)return;
    turnLink=location.href.split('#')[0]+'#turn='+token;turnLinkBusy=false;render();
  }).catch(error=>{turnLinkBusy=false;turnLinkError='Could not prepare the turn link. Try again.';console.error(error);render();});
}
function ensureInvites(){
  if(!game||game.mode!=='text'||textAccess()!==0)return;
  const source=encodeForTurn(game);
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
function slotIsMine(saved) {
  if(saved.mode!=='text')return true;
  const seat=Number(recallSeat(saved.matchId)??-1);
  return seat>=0 && seat===(saved.phase==='setup'?saved.setup:saved.turn);
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
  const started=performance.now();
  try {
    change();
    timings.logic=Math.round((performance.now()-started)*1000);
    const saving=performance.now();
    localStorage.setItem(SLOT_PREFIX+slotId, encodeForBackup(game));
    timings.save=Math.round((performance.now()-saving)*1000);
  } catch (error) {
    game = previous;
    slotId=previousSlot;
    computerRecording=null;computerPlayback=null;clearTimeout(replayTimer);
    clearTimeout(matchReplayTimer);clearTimeout(matchHoldTimer);matchReplay=null;
    storageError = 'Could not save this move. Free device storage and allow Safari website storage before continuing.';
    try { render(); } catch (paintError) { console.error(paintError); }
    console.error(error);
    return false;
  }
  // The match slot is the commit point. Auxiliary writes and painting cannot undo it.
  try { localStorage.setItem(ACTIVE_KEY,slotId); }
  catch (error) { console.error(error); }
  try {
    const now=Date.now(),dates=previousSlot===slotId?readDates(slotId):{started:now,last:now};
    localStorage.setItem(META_PREFIX+slotId,`${dates.started};${now}`);
  } catch { /* Match data remains saved even if date metadata cannot be written. */ }
  storageError = '';
  try {
    const painting=performance.now();
    render();
    timings.render=Math.round((performance.now()-painting)*1000);
    const indicator=app.querySelector('.perf');
    if(indicator) indicator.textContent=`Last move: logic ${micro(timings.logic)} · save ${micro(timings.save)} · UI ${micro(timings.render)}`;
  } catch (error) { console.error(error); }
  return true;
}
function newGame() {
  buyPrompt=null;clearTimeout(buyPromptTimer);setupOpen=false;
  slotId=makeSlotId();
  const count = draft.count, layout=draft.layout==='classic'?'classic':'expanded';
  const players = Array.from({length:count}, (_,i) => {
    const pool = shuffle(RANKS.filter(r => !['J','Q','K'].includes(r)).map(r => `${i}-${r}`));
    if(layout==='classic'){
      const six = [`${i}-K`,`${i}-Q`,`${i}-J`,...pool.splice(0,3)];
      pool.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b)));
      const p={ name:draft.names[i].trim() || `Player ${i+1}`, suit:i, cpu:draft.mode==='solo' && i!==0, front:[six[1],six[2],six[3]], back:[six[0],six[4],six[5]], reserve:[], deck:pool, coins:0, alive:true };
      if (p.cpu) arrangeAI(p);
      return p;
    }
    const seven = [`${i}-K`,`${i}-Q`,`${i}-J`,...pool.splice(0,4)];
    pool.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b)));
    const p={ name:draft.names[i].trim() || `Player ${i+1}`, suit:i, cpu:draft.mode==='solo' && i!==0, front:[seven[1],seven[2],seven[3],seven[4]], back:[seven[0],seven[5],seven[6],null], reserve:[], deck:pool, coins:0, alive:true };
    if (p.cpu) arrangeAI(p);
    return p;
  });
  game = {version:1,layout,queenRule:'cedric',mode:draft.mode,players,turn:0,round:1,phase:'setup',setup:0,view:draft.mode==='text'?0:null,selection:null,attacks:0,kills:0,pending:null,refill:[],refillIndex:0,refillUndo:[],matchId:makeMatchId(),turnNumber:1,currentBattles:[],lastBattles:[],message:'',log:[],history:null,startedAt:Math.floor(Date.now()/1000)*1000};
  game.history={origin:captureOrigin(game),events:[]};
  if(draft.mode==='text') persistSeat(game.matchId,0);
  navigator.storage?.persist?.().catch(() => {});
}
function advanceTurn() {
  const alive = living();
  if (alive.length <= 1) { game.phase = 'victory'; game.view = null; return; }
  const next = alive.find(i => i > game.turn) ?? alive[0];
  if (next <= game.turn) game.round++;
  if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
  game.turn = next; game.phase = player(next).cpu?'buy':'arrange'; game.view = game.mode==='text'?next:null; game.selection = null;
  game.attacks = 0; game.kills = 0; game.pending = null;
  game.message = player(next).cpu?`${player(next).name} is thinking…`:'';
}
function cardHTML(id, action, location, index, opts={}) {
  const selected = game?.selection && game.selection.location === location && game.selection.index === index;
  const attrs = action ? `data-action="${action}" data-location="${location}" data-index="${index}"` : 'disabled';
  const place=opts.owner!=null?`${player(opts.owner).name}, ${opts.row} slot ${index+1}, `:'';
  if (!id) return `<button class="card empty ${opts.buyConfirm?'buy-armed':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}${opts.buyConfirm?'tap again to hire for two coins':'empty slot'}">${opts.buyConfirm?'2 ◉':'+'}</button>`;
  if (opts.hidden) return `<button class="card back ${opts.target?'target':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}face-down card"><span class="center">♛</span></button>`;
  const r=rank(id),role={A:'ASSASSIN','10':'KNIGHT',J:'JACK',Q:'QUEEN',K:'KING'}[r]||'';
  return `<button class="card ${['♥','♦'].includes(suit(id))?'red':''} ${selected?'selected':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}${label(id)}${role?`, ${role.toLowerCase()}`:''}" aria-pressed="${Boolean(selected)}"><span class="rank">${r}<small>${suit(id)}</small></span><span class="center">${suit(id)}</span>${role?`<span class="card-role">${role}</span>`:''}<span class="rank foot">${r}<small>${suit(id)}</small></span></button>`;
}
function lineHTML(cards, action, location, hidden=false) { return `<div class="line">${cards.map((id,i) => cardHTML(id,action,location,i,{hidden})).join('')}</div>`; }
function frame(content,compact=false) {
  const backup=game?.mode==='solo'&&!hubOpen&&!incomingBackup?`<section class="panel"><h3>Keep a backup</h3><p class="muted small">A backup link contains the whole match, including hidden cards. Keep it private.</p><button class="button secondary wide" data-action="backup">Make Backup</button>${backupText?`<label class="field" style="margin-top:12px"><span>Backup link</span><textarea readonly rows="3">${escapeHTML(backupText)}</textarea></label><button class="button secondary" data-action="copy-backup">Copy link</button>`:''}</section>`:'';
  const credit=`<p class="notice">Game by Shane Holmgren · Digital adaptation by Jamon Holmgren, <a href="https://jammin.games/" target="_blank" rel="noopener noreferrer">Jammin Games</a><br><span class="perf">Last move: logic ${micro(timings.logic)} · save ${micro(timings.save)} · UI ${micro(timings.render)}</span></p>`;
  app.innerHTML = `<main class="app ${compact?'compact-app':''}"><header class="top ${compact?'compact-top':''}"><div class="brand">♛ Regicidious</div><div class="top-actions">${compact?`<button class="pill" data-action="toggle-sheet" aria-label="Game details">☰</button>`:''}<button class="pill" data-action="games">Games</button></div></header>${storageError?`<div class="status" role="alert">${storageError}</div>`:''}${backupError?`<div class="status" role="alert">${backupError}</div>`:''}${content}${!compact&&!game&&!hubOpen&&!incomingBackup?pastePanel():''}${compact?'':backup+credit}</main>`;
}
function slotCard({id,game:g,dates}, finished) {
  const roster=g.players.map(p=>p.name).join(' vs ');
  const started=dates.started||g.startedAt||0;
  const turn=finished?'Battle ended':g.phase==='setup'?`${g.players[g.setup].name} sets their lines`:`${g.players[g.turn].name} to move`;
  const clashes=g.lastBattles?.length?`<p class="game-clashes">${escapeHTML(lastBattleSentence(g))}</p>`:'';
  return `<section class="panel game-slot ${finished?'':slotIsMine(g)?'game-ready':'game-waiting'}"><div class="phase">${g.mode==='solo'?'Solo':g.mode==='text'?'Text multiplayer':'Pass the phone'} · Round ${g.round}</div><h2 class="game-roster">${escapeHTML(roster)}</h2><p class="game-turn">${escapeHTML(turn)}</p>${clashes}<div class="game-dates">${gameDateButton(id,'last',dates.last)}${gameDateButton(id,'started',started)}</div><button class="button wide" data-action="open-game" data-id="${id}">${finished?'View game':'Continue →'}</button>${canReplay(g)?`<button class="button secondary wide" data-action="replay-game" data-id="${id}">Replay game</button>`:''}<div class="actions"><button class="button secondary" data-action="backup-slot" data-id="${id}">Make Backup</button><button class="button ${deleteCandidate===id?'danger':'ghost'}" data-action="delete-game" data-id="${id}">${deleteCandidate===id?'Confirm delete':'Delete game'}</button></div>${backupForSlot===id&&backupText?`<label class="field"><span>Private backup link</span><textarea readonly rows="3">${escapeHTML(backupText)}</textarea></label><button class="button secondary" data-action="copy-backup">Copy link</button>`:''}</section>`;
}
function renderHub() {
  const slots=gameSlots();
  const active=slots.filter(s=>s.game.phase!=='victory'&&s.game.phase!=='stalemate').sort((a,b)=>Number(slotIsMine(b.game))-Number(slotIsMine(a.game))||(b.dates.last||0)-(a.dates.last||0));
  const done=slots.filter(s=>s.game.phase==='victory'||s.game.phase==='stalemate');
  if(completedOpen){
    frame(`<section class="hero"><div class="crown">♛</div><h1>Completed games</h1><p>Finished matches stay here for replay and backup.</p></section>${hubNotice?`<p class="status">${escapeHTML(hubNotice)}</p>`:''}${done.map(s=>slotCard(s,true)).join('')||'<p class="muted">No completed games on this device.</p>'}<div class="actions"><button class="button secondary wide" data-action="games">Back to games</button></div>`);
    return;
  }
  frame(`<section class="hero"><div class="crown">♛</div><h1>Your games</h1><p>Active matches stay here until you delete them.</p></section>${hubNotice?`<p class="status">${escapeHTML(hubNotice)}</p>`:''}${active.map(s=>slotCard(s,false)).join('')||'<p class="muted">No games in progress.</p>'}<div class="actions">${done.length?`<button class="button secondary wide" data-action="completed-games">Completed games</button>`:''}<button class="button secondary wide" data-action="new-game">Start another game</button></div>${pastePanel()}`);
}
function playerChips(saved) {
  return `<div class="dispatch-seats">${saved.players.map((p,i)=>`<span class="suit-chip">${SUITS[i]} ${escapeHTML(p.name)}</span>`).join('')}</div>`;
}
function renderImport() {
  const g=incomingBackup, victory=g.phase==='victory', turn=incomingKind==='turn';
  const winner=g.players.find(p=>p.alive);
  const focus=incomingSeat!=null&&g.players[incomingSeat]?g.players[incomingSeat]:g.players[g.turn];
  const title=victory?'The final dispatch':turn?'A royal dispatch':'A private backup';
  const headline=victory?`${escapeHTML(winner?.name||'A kingdom')} takes the crown`:`${escapeHTML(focus.name)}, your move`;
  const started=g.startedAt>0?dateText(g.startedAt):'unknown';
  const body=victory?'Open to watch the final clash and the result. Your other saved games stay on this device.':turn?'Open to replay the last fights and continue if this seat is yours. Your other saved games stay on this device.':'Restoring adds another saved game. Your current games remain untouched.';
  const go=victory?'View final clash':turn?'Open turn & replay':'Add backup';
  const progress=g.phase==='setup'?`Battle lines · ${g.setup+1} of ${g.players.length}`:`Round ${g.round} · turn #${g.turnNumber}`;
  frame(`<section class="panel dispatch"><div class="phase">${title}</div><h2>${headline}</h2><p class="muted">${progress}</p>${playerChips(g)}<p class="muted small">Started ${escapeHTML(started)}</p><p class="small">${body}</p><div class="actions"><button class="button" data-action="restore-backup">${go}</button><button class="button secondary" data-action="keep-current">Not now</button></div></section>`);
}
function renderTextWaiting() {
  ensureTurnLink();
  ensureInvites();
  const p=player(game.turn);
  const invites=textAccess()===0?`<section class="panel"><h2>Invite players to their own seats</h2><p class="small muted">Send each player only their named invite once. Invites bind their device to that seat, even before their first turn.</p>${game.players.map((q,i)=>i===0?'':`<p>${escapeHTML(q.name)} ${SUITS[i]}</p>${inviteLinks[i]?.url?`<div class="actions"><button class="button secondary" data-action="copy-invite" data-index="${i}">Copy invite</button><button class="button secondary" data-action="share-invite" data-index="${i}">Share…</button></div><textarea readonly rows="2">${escapeHTML(inviteLinks[i].url)}</textarea>`:'<p class="small muted">Preparing invite…</p>'}`).join('')}</section>`:'';
  const settingUp=game.phase==='setup';
  const summary=`<section class="waiting-summary"><div class="crown">${SUITS[game.turn]}</div><div><div class="phase">${settingUp?`Battle lines · ${game.setup+1} of ${game.players.length}`:`Text multiplayer · turn #${game.turnNumber}`}</div><h1>${escapeHTML(p.name)}’s ${settingUp?'battle lines':'turn'}</h1><p>Send the next link to ${escapeHTML(p.name)}. Your copy waits here.</p></div></section>`;
  const actions=turnLink?`<div class="actions"><button class="button" data-action="copy-turn">Copy message</button><button class="button secondary" data-action="share-turn">Share to app…</button></div><details class="share-detail"><summary>Show message and link</summary><textarea readonly rows="5" aria-label="Message and link">${escapeHTML(shareMessage(game,turnLink))}</textarea></details>`:'<p class="muted small">Preparing a private turn link…</p>';
  const dispatch=`<section class="panel waiting-panel"><h2>${settingUp?'Send the setup':'Send the turn'}</h2>${settingUp?'':`<p class="muted small">${escapeHTML(lastBattleSentence(game))}</p>`}${replayLastButton()}${turnLinkError?`<p class="status">${escapeHTML(turnLinkError)}</p>`:''}${actions}<p class="muted small">The link contains the whole match and a key. Keep it in your game group; it deters casual peeking but cannot prevent cheating.</p></section>`;
  frame(`${summary}${dispatch}${invites}${pastePanel()}`);
}
function renderStart() {
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone;
  const install=!standalone&&!installDismissed?`<section class="install-tip" aria-label="Install Regicidious"><div><strong>Add to Home Screen</strong><p>On iPhone, open in Safari, tap Share, then Add to Home Screen. For text games, paste a received link into the installed app if Messages opens Safari.</p></div><button class="tip-close" data-action="dismiss-install" aria-label="Dismiss install tip">×</button></section>`:'';
  frame(`<section class="launch"><div class="launch-crown">♛</div><h1>A battle in your pocket</h1><p>Two attacks. One surviving kingdom.</p><button class="button wide launch-start" data-action="setup-open">Start new game →</button>${gameSlots().length?'<button class="button secondary wide" data-action="games">Continue a saved game</button>':''}</section>${install}<details class="panel compact-rules"><summary>How to play</summary><p>Prepare your line, hire reinforcements, then make up to two attacks. Solo, pass the phone, or exchange turns by text link.</p></details>`);
}
function renderSetup() {
  const modes=[['solo','Solo vs computer'],['local','Pass the phone'],['text','Text-message multiplayer']];
  const layouts=[['expanded','Expanded · 4 across, 7 cards'],['classic','Classic · 3 across, 6 cards']];
  const royalRules=`<p class="small muted">A neighboring peasant lends the Queen a die when she attacks and falls in her place if she loses. When the King defends, a neighboring peasant takes a winning hit for him. The weakest adjacent peasant falls first.</p>`;
  frame(`<div class="setup-heading"><button class="button ghost" data-action="setup-back">‹ Back</button><h1>New game</h1></div><section class="panel setup-panel"><p class="flavor">M’lord, our enemies are at the gates. We must prepare for war!</p><div class="label">Mode</div><div class="actions mode-actions">${modes.map(([mode,title])=>`<button class="button ${draft.mode===mode?'':'ghost'}" data-action="mode" data-value="${mode}">${title}</button>`).join('')}</div><div class="label">Battle lines</div><div class="actions mode-actions">${layouts.map(([layout,title])=>`<button class="button ${draft.layout===layout?'':'ghost'}" data-action="layout" data-value="${layout}">${title}</button>`).join('')}</div>${royalRules}<div class="label">${draft.mode==='solo'?'Computer opponents':'Players'}</div><div class="actions">${[2,3,4].map(n=>`<button class="button ${draft.count===n?'':'ghost'}" data-action="count" data-value="${n}">${draft.mode==='solo'?n-1:n}</button>`).join('')}</div><div class="stack" style="margin-top:18px">${draft.names.slice(0,draft.mode==='solo'?1:draft.count).map((name,i)=>`<label class="field"><span>${SUITS[i]} ${draft.mode==='solo'?'Your name':NAMES[i]}</span><input data-name="${i}" maxlength="24" value="${escapeHTML(name)}" autocomplete="off"></label>`).join('')}</div>${draft.mode==='text'?`<p class="small muted">Name every player now. After setting your own lines, send each person their invite. Links discourage casual peeking but are not cheat-proof.</p>`:''}<button class="button wide begin-game" data-action="start">Begin the war →</button></section>`);
}
function renderVeil() {
  const index = game.phase === 'setup' ? game.setup : game.phase === 'refill' ? game.refill[game.refillIndex] : game.phase === 'queen' ? game.pending.defender : game.turn;
  const text = game.phase === 'setup' ? 'M’lord, our enemies are at the gates. We must prepare for war!' : game.phase === 'refill' ? 'Fill any front-line gaps in private.' : game.phase === 'queen' ? 'Your Queen sacrifices the weakest adjacent peasant.' : 'Your kingdom is waiting.';
  const solo=game.mode==='solo';
  frame(`<section class="veil"><div><div class="crown">${SUITS[index]}</div><div class="phase">${solo?'Your kingdom':'Pass the phone'}</div><h1>${escapeHTML(player(index).name)}</h1><p>${text}${solo?'':'<br>Make sure only this player can see the screen.'}</p><div class="actions"><button class="button wide" data-action="reveal">${game.phase==='setup'?'Set up battle lines →':solo?'Continue →':`I’m ${escapeHTML(player(index).name)} — reveal`}</button></div></div></section>`);
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
    if(own && ['setup','buy','arrange','refill'].includes(mode))action='slot';
    if(own && mode==='attack' && id && (row==='front'||rank(id)==='10'))action='attacker';
    if(!own && mode==='attack' && id)action='target';
    const source=visual?.source?.owner===owner&&visual.source.row===row&&visual.source.index===index;
    const target=visual?.target?.owner===owner&&visual.target.row===row&&visual.target.index===index;
    const loser=visual?.loser?.owner===owner&&visual.loser.row===row&&visual.loser.index===index;
    const winner=visual?.winner?.owner===owner&&visual.winner.row===row&&visual.winner.index===index;
    const reveal=source||target&&visual?.revealTarget||!own && mode==='battle' && game.pending?.defender===owner && game.pending.target.row===row && game.pending.target.index===index;
    const hidden=visual?.revealAll?false:visual?(!own||visual.hideOwnOthers||player(owner).cpu)&&!reveal:!own&&!reveal;
    const active=source||target&&visual?.showTarget;
    const className=visual?`${!active?'replay-dim':''} ${active?'replay-active':''} ${source&&visual.kind==='reveal'?'replay-flip':''} ${loser?'replay-loser':''} ${winner?'replay-winner':''}`:'';
    return cardHTML(id,action,own?row:`${owner}:${row}`,index,{hidden,owner,row,target:reveal,className,buyConfirm:own&&['buy','arrange'].includes(mode)&&buyPrompt?.location===row&&buyPrompt.index===index});
  });
  const wide=p[row].length>3?' cols-4':'';
  return `<div class="arena-row${wide}"><span class="arena-label">${row==='front'?'Front line':'Back line'}</span><div class="line">${cards.join('')}</div></div>`;
}
function arenaDetails() {
  if(!sheetOpen)return '';
  const share=game.mode==='text'?`<p class="small muted">Turn #${game.turnNumber}: ${escapeHTML(player(game.turn).name)}</p>${replayLastButton()}<p class="small muted">Finish your turn to create the next player's link.</p>`:'';
  const backup=`<button class="button secondary wide" data-action="backup">Make Backup</button>${backupForSlot===slotId&&backupText?`<textarea readonly rows="3">${escapeHTML(backupText)}</textarea><button class="button secondary" data-action="copy-backup">Copy backup link</button>`:''}`;
  return `<div class="sheet-scrim" data-action="toggle-sheet"></div><section class="arena-sheet" role="dialog" aria-label="Game details"><div class="row"><h3>Game details</h3><button class="button ghost" data-action="toggle-sheet">Close</button></div><p class="muted small">Round ${game.round} · ${escapeHTML(player(game.turn).name)} · ${escapeHTML(game.phase)}</p><p class="small">${escapeHTML(game.message||'Tap a card to select it. The highest individual die wins.')}</p>${game.log?.length?`<div class="small muted">${game.log.slice(-6).reverse().map(item=>`<p>${escapeHTML(item)}</p>`).join('')}</div>`:''}${share}${backup}<p class="small muted">Game by Shane Holmgren · Digital adaptation by Jamon Holmgren, <a href="https://jammin.games/" target="_blank" rel="noopener noreferrer">Jammin Games</a>.</p><p class="small muted">Last move: logic ${micro(timings.logic)} · save ${micro(timings.save)} · UI ${micro(timings.render)}.</p></section>`;
}
function arenaReserve(owner, visual) {
  const p=player(owner);
  if(visual?.revealAll){
    if(!p.reserve.length)return '';
    return `<div class="arena-row"><span class="arena-label">Reserve</span><div class="reserve">${p.reserve.map((id,i)=>cardHTML(id,'','reserve',i,{owner,row:'reserve'})).join('')}</div></div>`;
  }
  if(!p.reserve.length||!['setup','buy','arrange'].includes(game.phase))return '';
  return `<button class="reserve-trigger" data-action="reserve">Reserve ${p.reserve.length} ▴</button>${reserveOpen?`<div class="reserve-overlay"><div class="row"><strong>Reserve cards</strong><button class="button ghost" data-action="reserve">Close</button></div><p class="small muted">Select a card, then tap a board slot.</p><div class="reserve">${p.reserve.map((id,i)=>cardHTML(id,'slot','reserve',i,{owner,row:'reserve'})).join('')}</div></div>`:''}`;
}
function renderArena(owner,mode,intro,controls,visual) {
  const candidates=living().filter(i=>i!==owner);
  const opponent=visual?.opponent??(mode==='battle'&&game.pending?.defender!==owner?game.pending.defender:(candidates.includes(selectedOpponent)?selectedOpponent:candidates[0]));
  selectedOpponent=opponent;
  const target=opponent==null?null:player(opponent);
  const switcher=(!visual||visual.revealAll&&!visual.source)&&candidates.length>1?`<div class="opponent-switch"><button data-action="opponent-nav" data-step="-1" aria-label="Previous opponent">‹</button><strong>${escapeHTML(target.name)} ${SUITS[opponent]}</strong><button data-action="opponent-nav" data-step="1" aria-label="Next opponent">›</button></div>`:`<strong>${target?`${escapeHTML(target.name)} ${SUITS[opponent]}`:'Your opponent'}</strong>`;
  const prepareHint=(mode==='buy'||mode==='arrange')&&!visual?intro:null;
  const middleText=visual||mode==='refill'?intro:prepareHint?(game.message?`${game.message} ${intro}`:intro):(game.message||intro);
  let middle=`<div class="arena-instruction">${escapeHTML(middleText)}</div>`;
  if(mode==='battle'||visual?.showDice) {
    const b=game.pending;
    const analysis=mode==='battle'?`<div class="clash-analysis battle-result" data-outcome="${escapeHTML(middleText)}" aria-live="polite">The dice tumble…</div>`:`<div class="clash-analysis" aria-live="polite">${escapeHTML(middleText)}</div>`;
    middle=`<div class="clash-strip"><div class="clash-dice" data-dice-lane aria-live="off"><div class="clash-side"><span>${label(b.defendCard)}</span><div class="dice">${b.defendDice.map(()=>`<span class="die">?</span>`).join('')}</div></div><span class="clash-versus">vs</span><div class="clash-side"><span>${label(b.attackCard)}</span><div class="dice">${b.attackDice.map(()=>`<span class="die">?</span>`).join('')}</div></div></div>${analysis}</div>`;
  }
  const own=player(owner);
  const seenReserve=visual?.revealAll&&target?.reserve?.length?`<div class="arena-row"><span class="arena-label">Reserve</span><div class="reserve">${target.reserve.map((id,i)=>cardHTML(id,'','reserve',i,{owner:opponent,row:'reserve'})).join('')}</div></div>`:'';
  const last=visual? '':replayLastButton(true);
  frame(`<section class="arena" aria-label="Battlefield"><div class="arena-opponent"><div class="arena-hud">${switcher}<span>${target?`${target.front.filter(Boolean).length+target.back.filter(Boolean).length} cards`:''}</span></div>${target?arenaRow(opponent,'back',false,mode,visual):''}${target?arenaRow(opponent,'front',false,mode,visual):''}${seenReserve}</div><div class="arena-middle">${middle}</div><div class="arena-self"><div class="arena-hud"><strong>${escapeHTML(own.name)} ${SUITS[owner]}</strong><span>◉ ${own.coins} · ${game.attacks}/2 attacks</span></div>${arenaRow(owner,'front',true,mode,visual)}${arenaRow(owner,'back',true,mode,visual)}${arenaReserve(owner,visual)}</div><div class="arena-dock ${visual?'replay-dock':''}${last?' with-last':''}">${controls}${last}</div></section>${arenaDetails()}`,true);
}
function renderPlay() {
  const p = player(game.turn);
  let intro = '';
  let controls = '';
  if (game.phase === 'buy' || game.phase === 'arrange') {
    const canBolster=p.front.includes(null)&&p.back.some(Boolean);
    intro = buyPrompt?'Hark! Tap the gilded hollow again to hire a random card for 2 coins.':`Prepare!! Good sire, array thy vanguard ere the horns sound.${p.coins>=2&&p.deck.length?' Tap an empty hollow twice to hire a random card for 2 coins.':''}`;
    controls = `${canBolster?`<button class="button secondary" data-action="bolster">Bolster your lines</button>`:''}<button class="button wide" data-action="next">To arms!</button>`;
  } else if (game.phase === 'attack') {
    intro = `Attack!! Sally ${game.attacks+1}/2: tap thy front champion or rear Knight, then a foe.`;
    controls = `<button class="button secondary wide" data-action="finish-attacks">${retreatArmed===retreatKey()?'Confirm end attacks':game.attacks?'Sound the retreat':'Hold the line'} →</button>`;
  } else {
    const jack = hasCard(p,'J') ? 1 : 0;
    intro = `${game.kills} defeated ${game.kills===1?'card':'cards'} + ${jack} Jack bonus = ${game.kills+jack} ${game.kills+jack===1?'coin':'coins'}.`;
    controls = `<button class="button wide" data-action="income">Collect ${game.kills+jack} ◉ and end turn →</button>`;
  }
  renderArena(game.turn,game.phase,intro,controls);
}
function retreatKey(){return `${slotId}:${game?.round}:${game?.turn}:${game?.attacks}`;}
function clearRetreat(){retreatArmed=null;clearTimeout(retreatTimer);}
function renderRefill() {
  const index = game.refill[game.refillIndex], p = player(index);
  const gaps = p.front.filter(id => !id).length;
  renderArena(index,'refill',gaps?`Fill ${Math.min(gaps,p.back.filter(Boolean).length)} front gap: tap a back card, then an empty front slot.`:'Front line ready. Tap a newly moved card, then its old back slot to undo.',`<button class="button wide" data-action="refill-done" ${gaps && p.back.some(Boolean)?'disabled':''}>${gaps?'Fill front gap first':'Confirm front line →'}</button>`);
}
function adjacentPeasants(p, row, index) {
  const cols=p[row]?.length||3;
  return [index-1,index+1].filter(i => i>=0 && i<cols && isPeasant(p[row][i] || '')).map(i => ({row,index:i,id:p[row][i]}));
}
function reinforceFront(p) {
  if(!p||!Array.isArray(p.front)||!Array.isArray(p.back))return false;
  if(p.front.some(Boolean))return false;
  if(!p.back.some(Boolean))return false;
  p.front=p.back.map(id=>id||null);
  p.back=p.back.map(()=>null);
  return true;
}
function diceCount(attacker, defender, source, target) {
  let a = 1, d = 1;
  if (value(attacker) > value(defender)) a++;
  if (value(defender) > value(attacker)) d++;
  if (rank(attacker)==='10' && target.row==='front') a++;
  if (rank(attacker)==='Q' && adjacentPeasants(player(game.turn),source.row,source.index).length) a++;
  return [a,d];
}
function roll(count) { return Array.from({length:count}, () => random(6)+1); }
function renderBattle() {
  const b = game.pending;
  const rescue=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
  const outcome = b.result === 'tie' ? 'A draw. Both survive.' : rescue?royalSacrificeSentence(player(b.result==='attack'?b.defender:game.turn).name,b.result==='attack'?b.defendCard:b.attackCard,rescue.id):b.result === 'attack' ? `${player(b.defender).name} loses ${label(b.defendCard)}.` : `${player(game.turn).name} loses ${label(b.attackCard)}.`;
  renderArena(game.turn,'battle',outcome,`<button class="button" data-action="battle-next" disabled>Continue →</button>`);
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
    if(result)result.textContent=result.dataset.outcome;
    if(button)button.disabled=false;
    try { navigator.vibrate?.(18); } catch { /* iOS may not support vibration. */ }
  };
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){finish();return;}
  const delays=[160,200,260,340,420];
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
function royalSacrificeSentence(name,royal,soldier) {
  return rank(royal)==='K'?`${name}’s ${cardTitle(soldier)} throws himself in front of the lance! The King survives.`:`${name}’s Queen survives; ${cardTitle(soldier)} falls instead.`;
}
function weakestSacrifice(b) {
  return b.sacrifice.reduce((best,s,i,a)=>value(s.id)<value(a[best].id)?i:best,0);
}
function clonePlayState(state) {
  const {history,...play}=state;
  return structuredClone(play);
}
function recordComputer(kind,target) {
  if(computerRecording)computerRecording.push({kind,target,state:clonePlayState(game)});
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
    const fl=e.beforeActor.length>>1, dfl=e.beforeDefender.length>>1;
    const state=clonePlayState(saved);
    state.turn=e.actor;state.phase='attack';state.selection={location:e.source.row,index:e.source.index};state.pending=null;
    state.players[e.actor].front=e.beforeActor.slice(0,fl);state.players[e.actor].back=e.beforeActor.slice(fl);state.players[e.actor].alive=true;
    state.players[e.defender].front=e.beforeDefender.slice(0,dfl);state.players[e.defender].back=e.beforeDefender.slice(dfl);state.players[e.defender].alive=true;
    const target={owner:e.defender,row:e.target.row,index:e.target.index};
    frames.push({kind:'reveal',state:structuredClone(state),target});
    frames.push({kind:'target',state:structuredClone(state),target});
    const sacrificeBoard=e.result==='defend'?e.beforeActor:e.beforeDefender;
    const sacrifice=e.sacrifice?[{...e.sacrifice,id:sacrificeBoard[(e.sacrifice.row==='back'?dfl:0)+e.sacrifice.index]}]:[];
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
  const holdForContinue=step.kind==='result';
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
        narration=sacrifice>=0?royalSacrificeSentence(opponent,b.defendCard,b.sacrifice[sacrifice].id):`${actor} defeats ${opponent}’s ${cardTitle(b.defendCard)}!`;
      } else {
        const sacrifice=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
        loser=sacrifice?{owner:attacker,row:sacrifice.row,index:sacrifice.index}:source;winner=target;
        narration=sacrifice?royalSacrificeSentence(actor,b.attackCard,sacrifice.id):`${opponent}’s ${cardTitle(b.defendCard)} defeats ${actor}’s ${cardTitle(b.attackCard)}!`;
      }
    }
    const visual={kind:step.kind,opponent:attacker,source,target,showTarget:step.kind!=='reveal',revealTarget:['roll','result'].includes(step.kind),showDice:['roll','result'].includes(step.kind),hideOwnOthers:playback.textReplay,loser,winner};
    renderArena(owner,'replay',narration,`<button class="button secondary" data-action="replay-next">${holdForContinue?'Continue':'Next'} →</button>`,visual);
    if(step.kind==='roll')animateDice(b);
    if(step.kind==='result'){
      const faces=app.querySelectorAll('[data-dice-lane] .die');
      [...faces].forEach((face,i)=>{face.textContent=[...b.defendDice,...b.attackDice][i];});
    }
    clearTimeout(replayTimer);
    replayTimer=null;
    if(!holdForContinue)replayTimer=setTimeout(advanceReplay,{reveal:600,target:650,roll:900,result:700}[step.kind]);
  } finally {game=finalGame;}
}
function article(title) { return /^[AEIOU]/.test(title)?'an':'a'; }
function applyOrigin(state, origin) {
  state.turn=origin.turn;state.round=origin.round;state.phase=origin.phase;state.setup=origin.setup;
  state.view=origin.view;state.attacks=origin.attacks;state.kills=origin.kills;
  state.turnNumber=origin.turnNumber||1;state.selection=null;state.pending=null;
  state.refill=[];state.refillIndex=0;state.refillUndo=[];state.currentBattles=[];state.lastBattles=[];
  state.message='';state.log=[];
  state.players.forEach((p,i)=>{
    const s=origin.players[i];
    p.front=[...s.front];p.back=[...s.back];p.reserve=[...s.reserve];p.deck=[...s.deck];
    p.coins=s.coins;p.alive=s.alive;p.cpu=s.cpu;
  });
}
function stateFromOrigin(saved) {
  const g=clonePlayState(saved);
  applyOrigin(g,saved.history.origin);
  return g;
}
function applyHistoryEvent(event) {
  const t=event.t;
  if(t==='swap'){game.selection=null;moveSlot(event.owner,event.from.location,event.from.index);moveSlot(event.owner,event.to.location,event.to.index);return;}
  if(t==='setupDone'){
    if(game.setup+1<game.players.length && game.mode!=='solo'){
      game.setup++;game.selection=null;game.message='';
      if(game.mode==='text'){game.turn=game.setup;game.view=game.setup;}
      else game.view=null;
    } else {
      game.phase='arrange';game.turn=0;game.view=game.mode==='text'||game.mode==='solo'?0:null;game.selection=null;game.message='';
      if(game.mode==='text')game.turnNumber=1;
    }
    return;
  }
  if(t==='buy'){
    const owner=Number(event.card.split('-')[0]),p=player(Number.isInteger(owner)?owner:game.turn);
    p.coins-=2;
    const at=p.deck.indexOf(event.card);
    if(at>=0)p.deck.splice(at,1);
    p.reserve.push(event.card);
    return;
  }
  if(t==='phase'){game.phase=event.phase;game.selection=null;game.message='';return;}
  if(t==='attack'){
    if(event.actor!=null)game.turn=event.actor;
    const source=event.source,defender=event.defender,target={player:defender,...event.target};
    const attackCard=player(game.turn)[source.row][source.index],defendCard=player(defender)[target.row][target.index];
    const sacrifice=event.sacrifice||[];
    if(game.mode==='text'){
      const chosen=sacrifice.length?sacrifice[weakestSacrifice({sacrifice})]:null;
      game.currentBattles.push({actor:game.turn,defender,source,target:{row:target.row,index:target.index},attackCard,defendCard,attackDice:event.attackDice,defendDice:event.defendDice,result:event.result,sacrifice:chosen?{row:chosen.row,index:chosen.index}:null,beforeActor:[...player(game.turn).front,...player(game.turn).back],beforeDefender:[...player(defender).front,...player(defender).back]});
    }
    game.pending={defender,source,target,attackCard,defendCard,attackDice:event.attackDice,defendDice:event.defendDice,result:event.result,sacrifice};
    game.phase='battle';game.selection=null;game.message='';
    return;
  }
  if(t==='resolve'){resolveBattle();return;}
  if(t==='finish'){finishAttacks();return;}
  if(t==='refillDone'){completeRefill();return;}
  if(t==='income'){player(game.turn).coins+=game.kills+(hasCard(player(game.turn),'J')?1:0);advanceTurn();return;}
  if(t==='arrangeSet'){
    const p=player(event.owner);
    p.front=[...event.front];p.back=[...event.back];p.reserve=[...event.reserve];
    game.turn=event.owner;game.phase='attack';game.selection=null;game.message='';
    return;
  }
  if(t==='sync'){applyOrigin(game,event.origin);return;}
}
function replayFinalState(saved) {
  const prev=game,lock=historyLock;
  historyLock=true;
  game=stateFromOrigin(saved);
  try { for(const event of saved.history.events) applyHistoryEvent(event); return clonePlayState(game); }
  finally { game=prev; historyLock=lock; }
}
function matchReplayOwner() {
  if(game.phase==='setup')return game.setup;
  if(game.phase==='refill'&&game.refill.length)return game.refill[game.refillIndex];
  if(game.phase==='victory')return living()[0]??game.turn;
  return game.turn;
}
function battleVisual(kind,source,target,attacker) {
  return {revealAll:true,kind,opponent:attacker,source,target,showTarget:kind!=='reveal',revealTarget:['roll','result'].includes(kind),showDice:['roll','result'].includes(kind),hideOwnOthers:false};
}
function buildMatchReplay(saved) {
  const frames=[],prev=game,lock=historyLock;
  historyLock=true;
  game=stateFromOrigin(saved);
  const push=(narration,extra={})=>{
    frames.push({state:clonePlayState(game),narration,owner:extra.owner??matchReplayOwner(),visual:extra.visual||{revealAll:true},round:game.round,turn:game.turn,phase:game.phase});
  };
  try {
    push('The kingdoms take the field.');
    for(const event of saved.history.events){
      if(event.t==='attack'){
        applyHistoryEvent(event);
        const b=game.pending,attacker=game.turn;
        const source={owner:attacker,row:b.source.row,index:b.source.index};
        const target={owner:b.defender,row:b.target.row,index:b.target.index};
        const actor=player(attacker).name,opponent=player(b.defender).name;
        const attackTitle=cardTitle(b.attackCard);
        push(`${actor} shows ${article(attackTitle)} ${attackTitle}!`,{owner:b.defender,visual:battleVisual('reveal',source,target,attacker)});
        push(`${actor}’s ${cardTitle(b.attackCard)} attacks ${opponent}’s ${cardTitle(b.defendCard)}!`,{owner:b.defender,visual:battleVisual('target',source,target,attacker)});
        push('The dice tumble…',{owner:b.defender,visual:battleVisual('roll',source,target,attacker)});
        let loser=null,winner=null,narration='A draw! Both cards survive.';
        if(b.result==='attack'){
          const sacrifice=b.sacrifice.length?weakestSacrifice(b):-1;
          loser=sacrifice>=0?{owner:b.defender,row:b.sacrifice[sacrifice].row,index:b.sacrifice[sacrifice].index}:target;
          winner=source;
          narration=sacrifice>=0?royalSacrificeSentence(opponent,b.defendCard,b.sacrifice[sacrifice].id):`${actor} defeats ${opponent}’s ${cardTitle(b.defendCard)}!`;
        } else if(b.result==='defend'){
          const sacrifice=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
          loser=sacrifice?{owner:attacker,row:sacrifice.row,index:sacrifice.index}:source;winner=target;
          narration=sacrifice?royalSacrificeSentence(actor,b.attackCard,sacrifice.id):`${opponent}’s ${cardTitle(b.defendCard)} defeats ${actor}’s ${cardTitle(b.attackCard)}!`;
        }
        const resultVisual=battleVisual('result',source,target,attacker);
        resultVisual.loser=loser;resultVisual.winner=winner;
        push(narration,{owner:b.defender,visual:resultVisual});
        continue;
      }
      if(event.t==='buy'){
        const owner=Number(event.card.split('-')[0]);
        const name=player(Number.isInteger(owner)?owner:game.turn).name;
        applyHistoryEvent(event);
        push(`${name} buys ${cardTitle(event.card)}.`);
        continue;
      }
      if(event.t==='income'){
        const name=player(game.turn).name,n=game.kills+(hasCard(player(game.turn),'J')?1:0);
        applyHistoryEvent(event);
        push(`${name} collects ${n} ${n===1?'coin':'coins'}. ${game.phase==='victory'?`${player(living()[0]).name} wins.`:`${player(game.turn).name}’s turn.`}`);
        continue;
      }
      applyHistoryEvent(event);
      if(event.t==='swap'){
        const id=player(event.owner)[event.to.location]?.[event.to.index];
        push(`${player(event.owner).name} moves ${id?cardTitle(id):'a card'}.`);
      } else if(event.t==='setupDone'){const who=game.phase==='arrange'?(game.mode==='solo'?0:game.players.length-1):game.setup-1;push(`${player(Math.max(0,who)).name} locks a formation.`);}
      else if(event.t==='phase'&&event.phase==='arrange') push(`${player(game.turn).name} rearranges the line.`);
      else if(event.t==='phase'&&event.phase==='attack') push(`${player(game.turn).name} prepares to attack.`);
      else if(event.t==='resolve') push(game.phase==='victory'?`${player(living()[0]).name} wins.`:(game.message||'The clash is over.'));
      else if(event.t==='finish') push(game.phase==='refill'?'Front lines need filling.':'Attacks are over.');
      else if(event.t==='refillDone') push('The front line is confirmed.');
      else if(event.t==='arrangeSet') push(`${player(event.owner).name} sets a formation.`);
      else if(event.t==='sync') push('The kingdoms update the field.');
    }
    if(game.phase==='victory'&&frames.at(-1)?.phase!=='victory') push(`${player(living()[0]).name} wins.`);
  } finally { game=prev; historyLock=lock; }
  return frames;
}
function stopMatchReplay() {
  clearTimeout(matchReplayTimer);clearTimeout(matchHoldTimer);
  matchReplay=null;
}
function startMatchReplay(saved) {
  if(!canReplay(saved))return false;
  stopMatchReplay();
  computerPlayback=null;clearTimeout(replayTimer);
  const frames=buildMatchReplay(saved);
  if(!frames.length)return false;
  matchReplay={frames,index:0,autoplay:false,hold:false,suppressClick:false};
  render();
  return true;
}
function stepMatchReplay(dir) {
  if(!matchReplay)return;
  const next=matchReplay.index+dir;
  if(next<0||next>=matchReplay.frames.length){
    if(dir>0){matchReplay.autoplay=false;clearTimeout(matchReplayTimer);}
    render();
    return;
  }
  matchReplay.index=next;
  render();
}
function toggleMatchReplayAuto() {
  if(!matchReplay)return;
  matchReplay.autoplay=!matchReplay.autoplay;
  clearTimeout(matchReplayTimer);
  if(matchReplay.autoplay) scheduleMatchReplayAuto();
  render();
}
function scheduleMatchReplayAuto() {
  clearTimeout(matchReplayTimer);
  if(!matchReplay?.autoplay)return;
  matchReplayTimer=setTimeout(()=>{
    if(!matchReplay?.autoplay)return;
    if(matchReplay.index>=matchReplay.frames.length-1){matchReplay.autoplay=false;render();return;}
    stepMatchReplay(1);
    scheduleMatchReplayAuto();
  }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?280:700);
}
function renderMatchReplay() {
  const step=matchReplay.frames[matchReplay.index],finalGame=game;
  game=step.state;
  try {
    const actor=player(step.turn||game.turn);
    const intro=`Round ${step.round} · ${actor.name} · ${step.phase} · ${matchReplay.index+1}/${matchReplay.frames.length}`;
    const atStart=matchReplay.index===0,atEnd=matchReplay.index===matchReplay.frames.length-1;
    const controls=`<div class="replay-meta">${escapeHTML(intro)}</div><div class="replay-nav"><button class="button ghost" data-action="match-replay-exit">Exit</button><button class="button secondary" data-action="match-replay-prev" data-hold="prev" ${atStart?'disabled':''} aria-label="Previous step">‹</button><button class="button secondary" data-action="match-replay-next" data-hold="next" ${atEnd?'disabled':''} aria-label="Next step">›</button><button class="button ${matchReplay.autoplay?'':'ghost'}" data-action="match-replay-auto">${matchReplay.autoplay?'Pause':'Auto'}</button></div>`;
    renderArena(step.owner,'replay',step.narration,controls,step.visual);
    const b=game.pending;
    if(step.visual?.kind==='roll'&&b)animateDice(b);
    if(step.visual?.kind==='result'&&b){
      const faces=app.querySelectorAll('[data-dice-lane] .die');
      [...faces].forEach((face,i)=>{face.textContent=[...b.defendDice,...b.attackDice][i];});
    }
  } finally { game=finalGame; }
}
function renderQueen() {
  const b = game.pending, owner=b.result==='attack'?b.defender:game.turn;
  frame(`<section class="panel"><h2>Royal sacrifice</h2><p class="muted">${escapeHTML(player(owner).name)}’s ${cardTitle(b.result==='attack'?b.defendCard:b.attackCard)} is saved by the weakest adjacent peasant.</p><button class="button wide" data-action="sacrifice">Continue →</button></section>`);
}
function renderVictory() {
  const winner = player(living()[0]);
  if(game.mode==='text')ensureTurnLink();
  frame(`<section class="hero"><div class="crown">♛</div><div class="phase">The kingdom stands</div><h1>${escapeHTML(winner.name)} wins.</h1><p>${SUITS[winner.suit]} ${NAMES[winner.suit]} is the last kingdom standing.</p></section>${canReplayLast()||canReplay(game)?`<section class="panel"><h2>Watch it again</h2><p class="muted small">${canReplay(game)?'Replay every turn with all cards visible. The saved game is not changed.':'Watch the last fights again. Cards return to their hidden live faces afterward.'}</p>${replayLastButton()}${canReplay(game)?`<button class="button wide" data-action="replay-game">Replay game</button>`:''}</section>`:''}${game.mode==='text'?`<section class="panel"><h2>Tell the group</h2>${turnLink?`<div class="actions"><button class="button" data-action="copy-turn">Copy result</button><button class="button secondary" data-action="share-turn">Share to app…</button></div>`:'<p class="muted">Preparing result link…</p>'}</section>`:''}<section class="panel"><h2>Another game?</h2><p class="muted small">Starting another game leaves this one in your Games list.</p><button class="button secondary wide" data-action="new-after-win">New game</button></section>`);
}
function renderStalemate() {
  frame(`<section class="hero"><div class="crown">♛</div><h1>No winner yet.</h1><p>This match reached the computer-play safety limit. Its full state is saved in your Games list.</p></section><section class="panel"><button class="button secondary wide" data-action="new-game">Start another game</button></section>`);
}
function render() {
  if(linkLoading)return frame(`<section class="panel"><h2>Opening game link…</h2><p class="muted">Checking and decrypting the match.</p></section>`);
  if(incomingBackup) return renderImport();
  if(hubOpen) return renderHub();
  if(matchReplay)return renderMatchReplay();
  if(computerPlayback)return renderPlayback();
  if (!game) return setupOpen?renderSetup():renderStart();
  if(game.mode==='text'&&textAccess()!==game.turn&&game.phase!=='victory')return renderTextWaiting();
  if (game.phase === 'victory') return renderVictory();
  if (game.phase === 'stalemate') return renderStalemate();
  if (game.view === null) {
    const idx=game.phase==='setup'?game.setup:game.turn;
    if(['setup','arrange','buy'].includes(game.phase) && player(idx) && !player(idx).cpu && (game.mode!=='solo'||game.phase==='setup')) return renderVeil();
    game.view=idx;
  }
  if (game.phase === 'setup') {
    const p=player(game.setup), canBolster=p.front.includes(null)&&p.back.some(Boolean);
    renderArena(game.setup,'setup',game.message || 'Good sire, array thy lines: let no rear rank outnumber the vanguard. Tap two cards to trade places.',`${canBolster?`<button class="button secondary" data-action="bolster">Bolster your lines</button>`:''}<button class="button wide" data-action="setup-done">Lock formation →</button>`);
  } else if (game.phase === 'refill') renderRefill();
  else if (game.phase === 'queen') renderQueen();
  else if (game.phase === 'battle') renderBattle();
  else renderPlay();
}

function slotAt(p, loc) { return p[loc]; }
function clearBuyPrompt(){buyPrompt=null;clearTimeout(buyPromptTimer);}
function prepareSlot(owner,location,index){
  const p=player(owner),empty=location!=='reserve'&&p[location]?.[index]==null;
  if(empty&&!game.selection&&p.coins>=2&&p.deck.length){
    if(buyPrompt?.location===location&&buyPrompt.index===index){
      clearBuyPrompt();
      p.coins-=2;
      const drawn=drawCard(p);
      p.reserve.push(drawn);
      record({t:'buy',card:drawn});
      game.selection={location:'reserve',index:p.reserve.length-1};
      moveSlot(owner,location,index);
      return;
    }
    clearBuyPrompt();buyPrompt={location,index};
    buyPromptTimer=setTimeout(()=>{buyPrompt=null;if(game&&['buy','arrange'].includes(game.phase))render();},5000);
    return;
  }
  clearBuyPrompt();moveSlot(owner,location,index);
}
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
  record({t:'swap',owner,from:{location:from.location,index:from.index},to:{location,index}});
}
function completeRefill() {
  game.selection=null; game.refillUndo=[]; game.refillIndex++;
  if (game.refillIndex < game.refill.length) game.view=null;
  else { game.phase='income'; game.view=game.turn; game.message=''; }
  record({t:'refillDone'});
}
function finishAttacks() {
  game.refill=[];game.refillIndex=0;game.refillUndo=[];game.selection=null;
  game.phase='income';game.view=game.turn;game.message='';
  record({t:'finish'});
}
function bolsterLines(owner) {
  const p=player(owner);
  if(!p||!['setup','buy','arrange'].includes(game.phase))return;
  for(let i=0;i<p.front.length;i++){
    if(p.front[i])continue;
    let from=p.back.findIndex(id=>id && rank(id)!=='K');
    if(from<0)from=p.back.findIndex(Boolean);
    if(from<0)break;
    game.selection=null;
    moveSlot(owner,'back',from);
    moveSlot(owner,'front',i);
  }
  game.message='The vanguard is bolstered.';
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
  const sacrificeIndex=b.sacrifice.length?weakestSacrifice(b):-1;
  const defeated=b.result==='attack' ? sacrificeIndex>=0?b.sacrifice[sacrificeIndex].id:b.defendCard : b.result==='defend'?sacrificeIndex>=0?b.sacrifice[sacrificeIndex].id:b.attackCard:null;
  game.log ??=[];
  game.log.push(`${player(game.turn).name} ${label(b.attackCard)} [${b.attackDice.join(',')}] vs ${player(b.defender).name} ${label(b.defendCard)} [${b.defendDice.join(',')}]: ${defeated?`${label(defeated)} defeated`:'draw'}.`);
  if (game.log.length>24) game.log.shift();
  if (b.result==='attack') {
    if (sacrificeIndex>=0) { const slot=b.sacrifice[sacrificeIndex]; defeat(b.defender,slot.row,slot.index); }
    else defeat(b.defender,b.target.row,b.target.index);
    game.kills++;
  } else if (b.result==='defend') {
    if(sacrificeIndex>=0){const slot=b.sacrifice[sacrificeIndex];defeat(game.turn,slot.row,slot.index);}
    else defeat(game.turn,b.source.row,b.source.index);
  }
  reinforceFront(player(b.defender));
  if(b.result==='defend')reinforceFront(player(game.turn));
  game.attacks++;
  game.pending=null; game.selection=null;
  record({t:'resolve'});
  if (living().length<=1) {
    if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
    game.phase='victory'; game.view=null; return;
  }
  if (!player(game.turn).alive) { advanceTurn(); return; }
  game.phase='attack'; game.view=player(game.turn).cpu?null:game.turn; game.message='';
  if (game.attacks>=2 || !player(game.turn).front.some(Boolean) && !player(game.turn).back.some(id=>id&&rank(id)==='10')) finishAttacks();
}

function cardPriority(id) {
  const r=rank(id);
  return r==='Q'?18:r==='10'?17:r==='A'?15:r==='J'?13:r==='9'?12:r==='8'?11:r==='K'?-100:value(id);
}
function arrangeAI(p) {
  const frontLen=p.front?.length||3, backLen=p.back?.length||3;
  const cards=[...p.front,...p.back,...p.reserve].filter(Boolean);
  const king=cards.find(id=>rank(id)==='K');
  if(king && cards.length===1){p.front=[king,...Array(frontLen-1).fill(null)];p.back=Array(backLen).fill(null);p.reserve=[];return;}
  const queen=cards.find(id=>rank(id)==='Q');
  let front=[];
  if (queen) {
    const neighbor=cards.filter(id=>isPeasant(id)).sort((a,b)=>cardPriority(b)-cardPriority(a))[0];
    front=[queen,...(neighbor?[neighbor]:[])];
  }
  front.push(...cards.filter(id=>id!==king&&!front.includes(id)).sort((a,b)=>cardPriority(b)-cardPriority(a)));
  front=front.slice(0,frontLen);
  const rest=cards.filter(id=>!front.includes(id)).sort((a,b)=>cardPriority(b)-cardPriority(a));
  p.front=[...front,...Array(frontLen-front.length).fill(null)];
  p.back=[king,...rest.filter(id=>id!==king).slice(0,backLen-1)];
  while(p.back.length<backLen) p.back.push(null);
  p.reserve=rest.filter(id=>id!==king).slice(backLen-1);
}
function refillAI(p) {
  for(let i=0;i<p.front.length;i++) if(!p.front[i]) {
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
    for(const row of ['front','back']) for(let index=0;index<player(enemy)[row].length;index++) if(player(enemy)[row][index]) targets.push({enemy,row,index});
  }
  const choices=[];
  for(const sourceRow of ['front','back']) for(let index=0;index<self[sourceRow].length;index++) {
    const id=self[sourceRow][index]; if(!id || sourceRow==='back' && rank(id)!=='10') continue;
    for(const t of targets) {
      if(t.row==='back' && (rank(id)!=='10' || sourceRow==='back')) continue;
      // Evaluate a probability model for a face-down card, never its actual rank.
      const guesses=t.row==='back'?[['K',.48],['Q',.12],['J',.12],['10',.08],['8',.2]]:[['Q',.23],['J',.18],['10',.14],['A',.12],['8',.33]];
      let score=0;
      for(const [r,probability] of guesses) {
        const imagined=`${t.enemy}-${r}`;
        const attackCount=1+(value(id)>value(imagined)?1:0)+(rank(id)==='10'&&t.row==='front'?1:0)+(rank(id)==='Q'&&adjacentPeasants(self,sourceRow,index).length?1:0);
        const defendCount=1+(value(imagined)>value(id)?1:0);
        const ordinary=diceOdds(attackCount,defendCount);
        const odds=ordinary;
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
      while(p.coins>=2 && p.deck.length && p.reserve.length<3) { p.coins-=2; const drawn=drawCard(p); p.reserve.push(drawn); record({t:'buy',card:drawn}); }
      game.phase='arrange';
      record({t:'phase',phase:'arrange'});
    } else if(game.phase==='arrange') { arrangeAI(p); record({t:'arrangeSet',owner:game.turn,front:[...p.front],back:[...p.back],reserve:[...p.reserve]}); game.phase='attack'; }
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
      record({t:'income'});
      advanceTurn();
    } else return;
  }
}
function attack(targetPlayer,row,index) {
  const source=game.selection;
  if(game.phase!=='attack'||!player(game.turn).alive||game.attacks>=2)return;
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
  const sacrifice=result==='attack' && rank(defendCard)==='K' ? adjacentPeasants(player(targetPlayer),row,index) : result==='defend' && rank(attackCard)==='Q' ? adjacentPeasants(player(game.turn),sourceSlot.row,sourceSlot.index) : [];
  if(game.mode==='text') {
    const chosen=sacrifice.length?sacrifice[weakestSacrifice({sacrifice})]:null;
    game.currentBattles.push({actor:game.turn,defender:targetPlayer,source:sourceSlot,target:{row,index},attackCard,defendCard,attackDice,defendDice,result,sacrifice:chosen?{row:chosen.row,index:chosen.index}:null,beforeActor:[...player(game.turn).front,...player(game.turn).back],beforeDefender:[...player(targetPlayer).front,...player(targetPlayer).back]});
  }
  game.pending={defender:targetPlayer,source:sourceSlot,target,attackCard,defendCard,attackDice,defendDice,result,sacrifice};
  game.phase='battle'; game.selection=null; game.message='';
  record({t:'attack',actor:game.turn,source:sourceSlot,defender:targetPlayer,target:{row,index},attackDice,defendDice,result,sacrifice});
}

app.addEventListener('input', event => {
  if (event.target.matches('[data-name]')) {
    const index=Number(event.target.dataset.name);
    draft.names[index]=event.target.value;
    if(index===0)rememberPlayerName(event.target.value);
  }
});
app.addEventListener('click', event => {
  const button=event.target.closest('[data-action]');
  if(matchReplay) {
    const action=button?.dataset.action;
    if(matchReplay.suppressClick){matchReplay.suppressClick=false;if(action==='match-replay-prev'||action==='match-replay-next')return;}
    if(action==='games'){stopMatchReplay();hubOpen=true;render();return;}
    if(action==='match-replay-exit'){stopMatchReplay();render();return;}
    if(action==='match-replay-prev'){matchReplay.autoplay=false;clearTimeout(matchReplayTimer);stepMatchReplay(-1);return;}
    if(action==='match-replay-next'){matchReplay.autoplay=false;clearTimeout(matchReplayTimer);stepMatchReplay(1);return;}
    if(action==='match-replay-auto'){toggleMatchReplayAuto();return;}
    if(action==='opponent-nav' && game){
      const step=matchReplay.frames[matchReplay.index];
      const owner=step.owner;
      const prevGame=game;game=step.state;
      try {
        const candidates=living().filter(i=>i!==owner);
        if(candidates.length>1){const current=Math.max(0,candidates.indexOf(selectedOpponent));selectedOpponent=candidates[(current+Number(button.dataset.step)+candidates.length)%candidates.length];}
      } finally {game=prevGame;}
      render();
      return;
    }
    return;
  }
  if(computerPlayback) {
    const playing=button?.dataset.action;
    if(playing==='games') { clearTimeout(replayTimer);computerPlayback=null;hubOpen=true;render(); return; }
    if(playing==='keep-current'||playing==='restore-backup') { clearTimeout(replayTimer);computerPlayback=null; }
    else if(computerPlayback.frames[computerPlayback.index]?.kind==='result'&&playing!=='replay-next')return;
    else { advanceReplay(); return; }
  }
  if (!button) return;
  const action=button.dataset.action, index=Number(button.dataset.index);
  if(action==='replay-last'&&game?.mode==='text'&&game.lastBattles?.length){
    sheetOpen=false;startTextReplay(game);render();return;
  }
  if(action==='open-link'){pasteOpen=true;render();return;}
  if(action==='close-link'){pasteOpen=false;render();return;}
  if(action==='setup-open'){setupOpen=true;clearLinkError();render();return;}
  if(action==='setup-back'){setupOpen=false;render();return;}
  if(action==='dismiss-install'){
    installDismissed=true;
    try {localStorage.setItem('regicidious.install-tip.dismissed','1');} catch { /* The app remains usable without preference storage. */ }
    render();return;
  }
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
    const message=`${game.players[index].name}, join Regicidious as ${SUITS[index]}: ${inviteLinks[index].url}`;
    if(navigator.share)navigator.share({text:message}).catch(error=>{if(error.name!=='AbortError')console.error(error);});
    return;
  }
  if(action==='copy-turn'&&game?.mode==='text'&&turnLink) { navigator.clipboard?.writeText(shareMessage(game,turnLink)).catch(()=>{});return; }
  if(action==='share-turn'&&game?.mode==='text'&&turnLink) {
    if(navigator.share)navigator.share({text:shareMessage(game,turnLink)}).catch(error=>{if(error.name!=='AbortError'){turnLinkError='Sharing failed. Copy the message instead.';console.error(error);render();}});
    else {turnLinkError='Sharing is unavailable here. Copy the message instead.';render();}
    return;
  }
  if(action==='toggle-game-date'&&hubOpen){
    const kind=button.dataset.kind;
    if(kind!=='last'&&kind!=='started')return;
    const key=`${button.dataset.id}:${kind}`;
    if(expandedGameDates.has(key))expandedGameDates.delete(key);
    else expandedGameDates.add(key);
    render();return;
  }
  if(action==='delete-game'){
    if(deleteCandidate!==button.dataset.id){
      deleteCandidate=button.dataset.id;
      clearTimeout(deleteTimer);
      deleteTimer=setTimeout(()=>{deleteCandidate=null;if(hubOpen)render();},5000);
      render();return;
    }
    clearTimeout(deleteTimer);
    const id=deleteCandidate;
    try {
      const doomed=readSlot(id);if(!doomed)throw Error('Match missing');
      localStorage.removeItem(SLOT_PREFIX+id);
      localStorage.removeItem(META_PREFIX+id);
      if(doomed.mode==='text'){
        const owned=recallSeat(doomed.matchId);
        if(owned!=null)persistSeat(doomed.matchId,owned);
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
  if(action==='games') { stopMatchReplay();hubOpen=true;completedOpen=false;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='completed-games') { stopMatchReplay();hubOpen=true;completedOpen=true;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='new-game' || action==='new-after-win') { stopMatchReplay();clearLinkError();game=null;slotId=null;hubOpen=false;completedOpen=false;setupOpen=true;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='replay-game') {
    try {
      const id=button.dataset.id||slotId;
      const saved=id&&id===slotId&&game?game:readSlot(id);
      if(!saved||!canReplay(saved))throw Error('No replay');
      game=saved;slotId=id;hubOpen=false;completedOpen=false;sheetOpen=false;reserveOpen=false;backupText='';
      localStorage.setItem(ACTIVE_KEY,slotId);storageError='';clearLinkError();
      if(!startMatchReplay(saved))throw Error('No frames');
    } catch(error) { storageError='This finished game cannot be replayed.';render();console.error(error); }
    return;
  }
  if(action==='open-game') {
    try { const chosen=readSlot(button.dataset.id);if(!chosen)throw Error('Missing match');game=chosen;slotId=button.dataset.id;hubOpen=false;completedOpen=false;sheetOpen=false;reserveOpen=false;backupText='';localStorage.setItem(ACTIVE_KEY,slotId);storageError='';clearLinkError();render(); }
    catch(error) { storageError='This game could not be opened. Its saved data was not changed.';render();console.error(error); }
    return;
  }
  if(action==='keep-current') { incomingBackup=null;incomingKind=null;incomingSeat=null;hubOpen=!game;history.replaceState(null,'',location.pathname+location.search);render();return; }
  if(action==='restore-backup' && incomingBackup) {
    const restored=incomingBackup,kind=incomingKind,seat=incomingSeat;
    const existing=restored.mode==='text'?gameSlots().find(s=>s.game.matchId===restored.matchId):null;
    if(restored.mode==='text'){
      const bound=recallSeat(restored.matchId);
      const victoryView=kind==='turn'&&restored.phase==='victory';
      if(kind==='turn'&&bound==null&&!victoryView){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This browser has no seat in that match. Open your own invite first, or paste the turn link into the Home Screen app where you joined.';
        hubOpen=true;render();return;
      }
      if(kind==='backup'&&(seat==null||bound!=null&&Number(bound)!==seat)){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This link belongs to a different seat in a match already known on this device.';
        hubOpen=true;render();return;
      }
    }
    if(existing){
      const same=StateCodec.encode(existing.game,{history:false})===StateCodec.encode(restored,{history:false});
      const setupForward=restored.turnNumber===1&&existing.game.turnNumber===1&&existing.game.phase==='setup'&&
        (restored.phase==='setup'&&restored.setup>existing.game.setup||restored.phase==='arrange'&&restored.turn===0);
      if(restored.turnNumber<existing.game.turnNumber||restored.turnNumber===existing.game.turnNumber&&!same&&!setupForward){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This link is older than your saved match or conflicts with it. Your saved game was kept.';
        history.replaceState(null,'',location.pathname+location.search);hubOpen=true;render();return;
      }
    }
    if(commit(()=>{
      const keep=(!restored.history?.origin && existing?.game.history?.origin)?existing.game.history:null;
      game=restored;slotId=existing?.id??makeSlotId();backupText='';hubOpen=false;
      if(keep){
        game.history=keep;
        if(kind==='turn' && existing && restored.turnNumber>existing.game.turnNumber) record({t:'sync',origin:captureOrigin(restored)});
      }
    })) {
      if(restored.mode==='text'&&seat!=null&&kind==='backup'&&(recallSeat(restored.matchId)==null||Number(recallSeat(restored.matchId))===seat)){
        persistSeat(restored.matchId,seat);
        localStorage.removeItem(DELETED_PREFIX+restored.matchId);
      }
      if(restored.mode==='text'&&kind==='turn'&&(restored.phase==='victory'||!existing||existing.game.turnNumber<restored.turnNumber))startTextReplay(restored);
      incomingBackup=null;incomingKind=null;incomingSeat=null;clearLinkError();
      history.replaceState(null,'',location.pathname+location.search);render();
    }
    return;
  }
  if(storageError) return;
  if (action==='count') { draft.count=Number(button.dataset.value); render(); return; }
  if (action==='mode') { draft.mode=button.dataset.value; render(); return; }
  if (action==='layout') { draft.layout=button.dataset.value==='classic'?'classic':'expanded'; render(); return; }
  if (action==='start') { rememberPlayerName(draft.names[0]);clearLinkError(); return commit(newGame); }
  if (action==='bolster' && game && ['setup','buy','arrange'].includes(game.phase)) {
    const owner=game.phase==='setup'?game.setup:game.turn;
    return commit(()=>bolsterLines(owner));
  }
  if (!game) return;
  if(game.mode==='text'&&textAccess()!==game.turn)return;
  commit(() => {
    if (action==='reveal') { game.view=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.phase==='queen'?game.pending.defender:game.turn; return; }
    if (action==='slot') {
      const owner=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.turn;
      if (['setup','buy','arrange','refill'].includes(game.phase)) {
        if(['buy','arrange'].includes(game.phase))prepareSlot(owner,button.dataset.location,index);
        else moveSlot(owner,button.dataset.location,index);
        if(button.dataset.location==='reserve')reserveOpen=false;
      }
      return;
    }
    if (action==='setup-done' && game.phase==='setup') {
      const p=player(game.setup);
      if (p.back.filter(Boolean).length>p.front.filter(Boolean).length) { game.message='Your back line cannot outnumber your front line.'; return; }
      if (game.setup+1<game.players.length && game.mode!=='solo') {
        game.setup++;game.selection=null;game.message='';
        if(game.mode==='text'){game.turn=game.setup;game.view=game.setup;}
        else game.view=null;
      } else {
        game.phase='arrange';game.turn=0;game.view=game.mode==='text'||game.mode==='solo'?0:null;game.selection=null;
        game.message='';
        if(game.mode==='text')game.turnNumber=1;
      }
      record({t:'setupDone'});
      return;
    }
    if (action==='buy' && game.phase==='buy') { const p=player(game.turn); if (p.coins>=2 && p.deck.length) { p.coins-=2; const drawn=drawCard(p); p.reserve.push(drawn); record({t:'buy',card:drawn}); } return; }
    if (action==='next') {
      if (game.phase==='arrange' && player(game.turn).back.filter(Boolean).length>player(game.turn).front.filter(Boolean).length) { game.message='Move cards forward: your back line cannot outnumber your front line.'; return; }
      if (game.phase==='buy'||game.phase==='arrange') game.phase='attack';
      clearBuyPrompt();
      game.selection=null; game.message=''; record({t:'phase',phase:game.phase}); return;
    }
    if (action==='attacker' && game.phase==='attack') {
      clearRetreat();
      const row=button.dataset.location,id=player(game.turn)[row]?.[index];
      if (id && (row==='front' || row==='back' && rank(id)==='10')) game.selection=game.selection?.location===row&&game.selection.index===index?null:{location:row,index};
      return;
    }
    if (action==='target' && game.phase==='attack') { clearRetreat();const [owner,row]=button.dataset.location.split(':'); attack(Number(owner),row,index); return; }
    if (action==='battle-next' && game.phase==='battle') { resolveBattle(); return; }
    if (action==='sacrifice' && game.phase==='queen') { resolveBattle(); if(player(game.turn).cpu) runAIWithReplay(); return; }
    if (action==='finish-attacks' && game.phase==='attack') {
      const key=retreatKey();
      if(retreatArmed!==key){
        retreatArmed=key;clearTimeout(retreatTimer);
        retreatTimer=setTimeout(()=>{if(retreatArmed===key){retreatArmed=null;if(game?.phase==='attack')render();}},5000);
        render();return;
      }
      clearRetreat();finishAttacks();return;
    }
    if (action==='refill-done' && game.phase==='refill') { const p=player(game.refill[game.refillIndex]); if (!p.front.includes(null) || !p.back.some(Boolean)) { completeRefill(); if(player(game.turn).cpu) runAIWithReplay(); } return; }
    if (action==='income' && game.phase==='income') { player(game.turn).coins+=game.kills+(hasCard(player(game.turn),'J')?1:0); record({t:'income'}); advanceTurn(); runAIWithReplay(); }
  });
});
function endMatchHold() {
  clearTimeout(matchHoldTimer);
  if(matchReplay)matchReplay.hold=false;
}
app.addEventListener('pointerdown', event => {
  const button=event.target.closest('[data-hold]');
  if(!matchReplay||!button||button.disabled)return;
  const dir=button.dataset.hold==='next'?1:-1;
  clearTimeout(matchHoldTimer);
  matchHoldTimer=setTimeout(()=>{
    if(!matchReplay)return;
    matchReplay.hold=true;matchReplay.autoplay=false;matchReplay.suppressClick=true;clearTimeout(matchReplayTimer);
    const tick=()=>{
      if(!matchReplay?.hold)return;
      stepMatchReplay(dir);
      matchHoldTimer=setTimeout(tick,140);
    };
    tick();
  },380);
});
app.addEventListener('pointerup', endMatchHold);
app.addEventListener('pointercancel', endMatchHold);
window.addEventListener('keydown', event => {
  if(!matchReplay)return;
  if(event.key==='ArrowLeft'){event.preventDefault();matchReplay.autoplay=false;clearTimeout(matchReplayTimer);stepMatchReplay(-1);}
  if(event.key==='ArrowRight'){event.preventDefault();matchReplay.autoplay=false;clearTimeout(matchReplayTimer);stepMatchReplay(1);}
  if(event.key==='Escape'){event.preventDefault();stopMatchReplay();render();}
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
if(!/^#(?:turn|backup)=/.test(location.hash) && gameSlots().length)hubOpen=true;
render();
async function openIncomingHash(hash){
  computerPlayback=null;clearTimeout(replayTimer);stopMatchReplay();
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
