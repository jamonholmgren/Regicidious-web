/* Regicidious — framework-free, offline-first card game. */
const KEY = 'regicidious.game.v1';
const SLOT_PREFIX = 'regicidious.match.';
const META_PREFIX = 'regicidious.meta.';
const ACCESS_PREFIX = 'regicidious.access.';
const DELETED_PREFIX = 'regicidious.deleted.';
const ACTIVE_KEY = 'regicidious.active';
const PLAYER_NAME_KEY = 'regicidious.player-name';
const PLAYER_EMOJI_KEY = 'regicidious.player-emoji';
const SCORES_KEY = 'regicidious.scores.v1';
const RATING_KEY = 'regicidious.ratings.v1';
const MIGRATED_KEY = 'regicidious.legacy-imported';
const SUITS = ['♠', '♥', '♣', '♦'];
const NAMES = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const EMOJIS = StateCodec.emojis;
const PERSONA_NAMES={serf:'Serf',squire:'Squire',knight:'Knight'};
const app = document.querySelector('#app');
let game = null;
let slotId=null,hubOpen=false;
let storageError = '';
let draft = { mode:'solo',count:2, layout:'expanded',difficulty:'squire', names: ['You','Crimson Court','Iron Court','Ember Court'],emojis:EMOJIS.slice(0,4) };
try {
  const rememberedName=localStorage.getItem(PLAYER_NAME_KEY);
  if(rememberedName!=null&&rememberedName.trim())draft.names[0]=rememberedName.slice(0,24);
  const rememberedEmoji=localStorage.getItem(PLAYER_EMOJI_KEY);
  if(EMOJIS.includes(rememberedEmoji))draft.emojis[0]=rememberedEmoji;
} catch { /* The game remains usable if preferences cannot be read. */ }
function rememberPlayerName(name) {
  try { localStorage.setItem(PLAYER_NAME_KEY,String(name).slice(0,24)); }
  catch { /* Saving a preference must not block a game move. */ }
}
function rememberPlayerEmoji(emoji) {
  try { localStorage.setItem(PLAYER_EMOJI_KEY,emoji); }
  catch { /* Saving a preference must not block a game move. */ }
}
let timings = {logic:null,save:null,render:null};
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
let scoresOpen=false,scoreLayout='expanded',scoreLink='',scoreLinkSource='',scoreLinkBusy=false,scoreLinkError='',incomingScores=null,incomingRatings=null,scoreImportNotice='';
let ratingError='',ratingReconciled=false;
let tutorialOpen=false,tutorialStep=0,tutorialRolling=false,tutorialDice=null,tutorialTimer=null;
const SEAT_COOKIE='rgseat_';
const IDENTITY_PREFIX='regicidious.identity.';
try { installDismissed=localStorage.getItem('regicidious.install-tip.dismissed')==='1'; } catch { /* Storage warning appears elsewhere. */ }
try { tutorialOpen=localStorage.getItem('regicidious.tutorial.open')==='1';tutorialStep=Math.min(8,Math.max(0,Number(localStorage.getItem('regicidious.tutorial.step'))||0)); } catch { /* The lesson can restart if preferences are unavailable. */ }
const milliseconds=n=>`${n.toFixed(2)} ms`;
const timingLine=()=>timings.render===null?'':`Last move: logic ${milliseconds(timings.logic)} · save ${milliseconds(timings.save)} · render ${milliseconds(timings.render)}`;
const creditLine='Original game by Shane Holmgren<br>Digital adaptation by Jamon Holmgren, <a href="https://jammin.games/" target="_blank" rel="noopener noreferrer">Jammin Games</a>';
const BUILD=44;
const buildLine=BUILD>0?`Build ${BUILD}`:'Build local';

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
if(location.hash.startsWith('#turn=')||location.hash.startsWith('#scores='))linkLoading=true;

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
function identityKey(matchId,seat){return `${IDENTITY_PREFIX}${matchId}.${seat}`;}
function needsFirstIdentity(){
  if(!game||!['text','local'].includes(game.mode)||game.phase!=='setup'||game.setup===0)return false;
  if(game.mode==='text'&&textAccess()!==game.setup)return false;
  try{return localStorage.getItem(identityKey(game.matchId,game.setup))!=='1';}
  catch{return true;}
}
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
    players:state.players.map(p=>({front:[...p.front],back:[...p.back],reserve:[...p.reserve],deck:[...p.deck],coins:p.coins,alive:p.alive,cpu:p.cpu,persona:p.persona||null}))
  };
}
function record(event) {
  if(historyLock||!game?.history?.events||game.history.truncated)return;
  if(game.history.events.length>=8192){game.history.truncated=true;return;}
  game.history.events.push(event);
}
function recordFormation(owner) {
  const p=player(owner);
  record({t:'arrangeSet',owner,front:[...p.front],back:[...p.back],reserve:[...p.reserve]});
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
  if(!['invite','setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'].includes(saved.phase)||saved.view!=null&&!validIndex(saved.view,count))bad();
  if(saved.phase==='invite'&&(saved.mode!=='text'||saved.turn!==0||saved.setup!==0||saved.attacks!==0))bad();
  if(!Number.isInteger(saved.attacks)||saved.attacks>2||saved.attacks<0||!Number.isInteger(saved.kills)||saved.kills<0||saved.kills>2)bad();
  saved.usedAttacker??=saved.pending?.attackCard||saved.currentBattles?.at(-1)?.attackCard||null;
  if(saved.usedAttacker!=null&&!validCard(saved.usedAttacker,saved.turn))bad();
  saved.scout??=null;
  if(saved.scout!=null&&(!validIndex(saved.scout.player,count)||saved.scout.player===saved.turn||!['front','back'].includes(saved.scout.row)||!validIndex(saved.scout.index,saved.layout==='expanded'?4:3)||!validCard(saved.scout.id,saved.scout.player)))bad();
  saved.refillUndo??=[];
  if(!Array.isArray(saved.refill)||saved.refill.length>count||new Set(saved.refill).size!==saved.refill.length||saved.refill.some(i=>!validIndex(i,count)))bad();
  if(!Array.isArray(saved.refillUndo)||saved.refillUndo.length>3||saved.refillUndo.some(m=>!validIndex(m.owner,count)||!validIndex(m.from,cols)||!validIndex(m.to,cols)||!validCard(m.card,m.owner)))bad();
  if(!Number.isInteger(saved.refillIndex)||saved.refillIndex<0||saved.refillIndex>saved.refill.length||saved.phase==='refill'&&saved.refillIndex>=saved.refill.length)bad();
  if(typeof saved.message!=='string'||saved.message.length>2048||!Array.isArray(saved.log)||saved.log.length>1000||saved.log.some(s=>typeof s!=='string'||s.length>2048))bad();
  saved.matchId??='';saved.turnNumber??=1;saved.currentBattles??=[];saved.lastBattles??=[];saved.history??=null;saved.startedAt??=0;
  saved.finishedAt??=0;saved.scoreVersion??=0;
  if(!Number.isInteger(saved.finishedAt)||saved.finishedAt<0||saved.finishedAt>4e12||![0,1].includes(saved.scoreVersion))bad();
  saved.restoreNotices??=[];
  // Early versions marked ordinary invitation claims as suspicious. Those
  // claims are normal, so old invite notices are deliberately discarded.
  if(Array.isArray(saved.restoreNotices))saved.restoreNotices=saved.restoreNotices.filter(alert=>alert?.kind!=='invite');
  if(!Array.isArray(saved.restoreNotices)||saved.restoreNotices.length>count||saved.restoreNotices.length&&saved.mode!=='text'||
    new Set(saved.restoreNotices.map(n=>n.seat)).size!==saved.restoreNotices.length||
    saved.restoreNotices.some(n=>!validIndex(n.seat,count)||n.kind!=='backup'||
      !Number.isInteger(n.turnNumber)||n.turnNumber<1||n.turnNumber>saved.turnNumber))bad();
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
    p.persona??=p.cpu?'squire':null;
    p.emoji??=EMOJIS[i];
    if(!EMOJIS.includes(p.emoji))bad();
    if(p.persona!=null&&!['serf','squire','knight'].includes(p.persona))bad();
    if(p?.suit!==i||typeof p.name!=='string'||p.name.length>128||typeof p.alive!=='boolean'||typeof p.cpu!=='boolean'||!Number.isInteger(p.coins)||p.coins<0||p.coins>10000)bad();
    if(!Array.isArray(p.front)||p.front.length!==cols||!Array.isArray(p.back)||p.back.length!==cols||!Array.isArray(p.reserve)||!Array.isArray(p.deck))bad();
    const cards=[...p.front,...p.back,...p.reserve,...p.deck].filter(id=>id!=null);
    if(cards.length>13||new Set(cards).size!==cards.length||cards.some(id=>!validCard(id,i)))bad();
  });
  if(saved.scoreVersion===1&&(saved.mode!=='solo'||count!==2))bad();
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
  if(e.result==='tie')return `${actor}’s ${cardTitle(e.attackCard)} clashed with ${defender}’s ${cardTitle(e.defendCard)}, but neither yielded.`;
  if(e.sacrifice){const owner=e.result==='attack'?e.defender:e.actor;const board=e.result==='attack'?e.beforeDefender:e.beforeActor;const fl=board.length>>1;const id=board[(e.sacrifice.row==='back'?fl:0)+e.sacrifice.index];return royalSacrificeSentence(saved.players[owner].name,e.result==='attack'?e.defendCard:e.attackCard,id);}
  if(e.result==='defend')return `${defender}’s ${cardTitle(e.defendCard)} held the line and felled ${actor}’s ${cardTitle(e.attackCard)}.`;
  return `${actor}’s ${cardTitle(e.attackCard)} cut down ${defender}’s ${cardTitle(e.defendCard)}.`;
}
function lastBattleSentence(saved) {
  const events=saved.lastBattles||[];
  if(!events.length)return 'The last turn ended without a battle.';
  if(events.length===2){
    const [first,second]=events;
    if(first.result==='defend'&&second.result==='attack'&&first.defender===second.defender&&first.defendCard===second.defendCard){
      const defender=saved.players[first.defender].name;
      const victor=saved.players[second.actor].name;
      const fallen=saved.players[first.actor].name;
      return `${defender}’s valiant ${cardTitle(first.defendCard).toLowerCase()} was overwhelmed by ${victor}’s ${cardTitle(second.attackCard)}, but managed to take down ${fallen}’s ${cardTitle(first.attackCard)}.`;
    }
    const bridges=['Elsewhere on the field,','On another flank,','Amid the turmoil,','Before the dust settled,'];
    const bridge=bridges[(saved.turnNumber+first.actor+second.defender)%bridges.length];
    return `${battleSentence(saved,first)} ${bridge} ${battleSentence(saved,second)}`;
  }
  return battleSentence(saved,events[0]);
}
function restoreNoticeText(saved,viewer=saved.turn) {
  return (saved.restoreNotices||[]).filter(alert=>alert.seat!==viewer).map(alert=>
    `${saved.players[alert.seat].name} restored a known seat from a backup before their last move. This is a heads-up, not proof of cheating.`).join(' ');
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
function readScoreTable() {
  const raw=localStorage.getItem(SCORES_KEY);
  return raw?ScoreCodec.decode(raw):[];
}
function recordSoloScore(saved) {
  const entry=ScoreCodec.entryFromGame(saved);
  if(!entry)return;
  const prior=readScoreTable();
  const merged=ScoreCodec.merge(prior,[entry]);
  if(merged.conflicts)scoreImportNotice='This game already had a recorded score, which was kept.';
  const encoded=ScoreCodec.encode(merged.entries);
  if(localStorage.getItem(SCORES_KEY)!==encoded)localStorage.setItem(SCORES_KEY,encoded);
}
function readRatingLedger(){
  const raw=localStorage.getItem(RATING_KEY);
  return raw?RatingCodec.decode(raw):[];
}
function recordSoloRating(saved){
  const event=RatingCodec.fromGame(saved);
  if(!event)return;
  const prior=readRatingLedger(),merged=RatingCodec.merge(prior,[event]);
  const encoded=RatingCodec.encode(merged.events);
  if(localStorage.getItem(RATING_KEY)!==encoded)localStorage.setItem(RATING_KEY,encoded);
}
function reconcileRatings(){
  if(ratingReconciled)return;
  const prior=readRatingLedger();
  const recovered=gameSlots().map(slot=>RatingCodec.fromGame(slot.game)).filter(Boolean);
  const merged=RatingCodec.merge(prior,recovered);
  if(merged.events.length!==prior.length)localStorage.setItem(RATING_KEY,RatingCodec.encode(merged.events));
  ratingReconciled=true;
}
function ratingStandings(){
  try{reconcileRatings();return RatingCodec.standings(readRatingLedger());}
  catch(error){ratingError='Could not read your saved ratings. Your games and score table were kept.';console.error(error);return null;}
}
function scoreDate(seconds) {
  return new Date(seconds*1000).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'});
}
function ensureScoreLink() {
  let source;
  try { source=ScoreCodec.encode(readScoreTable())+';'+RatingCodec.encode(readRatingLedger()); }
  catch(error){scoreLink='';scoreLinkError='Could not read the score table backup.';console.error(error);return;}
  if(source.length>48000){scoreLink='';scoreLinkError='The records are too large for one link. Your local records remain saved; back up completed games individually.';return;}
  if(scoreLinkSource===source&&(scoreLink||scoreLinkBusy))return;
  scoreLinkSource=source;scoreLink='';scoreLinkBusy=true;scoreLinkError='';
  LinkCodec.seal(source).then(token=>{
    if(scoreLinkSource!==source)return;
    scoreLink=location.href.split('#')[0]+'#scores='+token;scoreLinkBusy=false;render();
  }).catch(error=>{scoreLinkBusy=false;scoreLinkError='Could not make a score backup.';console.error(error);render();});
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
    if(game.phase==='victory'&&game.scoreVersion===1&&!game.finishedAt)game.finishedAt=Math.floor(Date.now()/1000)*1000;
    timings.logic=performance.now()-started;
    const saving=performance.now();
    localStorage.setItem(SLOT_PREFIX+slotId, encodeForBackup(game));
    timings.save=performance.now()-saving;
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
  if(game.phase==='victory')try { recordSoloScore(game); } catch(error){scoreLinkError='Victory saved, but the score table could not be updated.';console.error(error);}
  if(game.phase==='victory')try { recordSoloRating(game); } catch(error){ratingError='Match saved, but the rating ledger could not be updated.';console.error(error);}
  try {
    const now=Date.now(),dates=previousSlot===slotId?readDates(slotId):{started:now,last:now};
    localStorage.setItem(META_PREFIX+slotId,`${dates.started};${now}`);
  } catch { /* Match data remains saved even if date metadata cannot be written. */ }
  storageError = '';
  try {
    const painting=performance.now();
    render();
    timings.render=performance.now()-painting;
    const indicator=app.querySelector('.perf');
    if(indicator) indicator.textContent=timingLine();
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
      const p={ name:draft.names[i].trim() || `Player ${i+1}`, emoji:draft.emojis[i], suit:i, cpu:draft.mode==='solo' && i!==0, persona:draft.mode==='solo'&&i!==0?draft.difficulty:null, front:[six[1],six[2],six[3]], back:[six[0],six[4],six[5]], reserve:[], deck:pool, coins:0, alive:true };
      if (p.cpu) arrangeAI(p);
      return p;
    }
    const seven = [`${i}-K`,`${i}-Q`,`${i}-J`,...pool.splice(0,4)];
    pool.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b)));
    const p={ name:draft.names[i].trim() || `Player ${i+1}`, emoji:draft.emojis[i], suit:i, cpu:draft.mode==='solo' && i!==0, persona:draft.mode==='solo'&&i!==0?draft.difficulty:null, front:[seven[1],seven[2],seven[3],seven[4]], back:[seven[0],seven[5],seven[6],null], reserve:[], deck:pool, coins:0, alive:true };
    if (p.cpu) arrangeAI(p);
    return p;
  });
  game = {version:1,layout,queenRule:'cedric',mode:draft.mode,players,turn:0,round:1,phase:'setup',setup:0,view:draft.mode==='text'?0:null,selection:null,attacks:0,usedAttacker:null,scout:null,kills:0,pending:null,refill:[],refillIndex:0,refillUndo:[],matchId:makeMatchId(),turnNumber:1,currentBattles:[],lastBattles:[],message:'',log:[],history:null,startedAt:Math.floor(Date.now()/1000)*1000,restoreNotices:[],finishedAt:0,scoreVersion:draft.mode==='solo'&&count===2?1:0};
  game.history={origin:captureOrigin(game),events:[]};
  if(draft.mode==='text')game.phase='invite';
  if(draft.mode==='text') persistSeat(game.matchId,0);
  navigator.storage?.persist?.().catch(() => {});
}
function advanceTurn() {
  game.restoreNotices=game.restoreNotices.filter(alert=>alert.seat===game.turn);
  const alive = living();
  if (alive.length <= 1) { game.phase = 'victory'; game.view = null; return; }
  const next = alive.find(i => i > game.turn) ?? alive[0];
  if (next <= game.turn) game.round++;
  if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
  game.turn = next; game.phase = player(next).cpu?'buy':'arrange'; game.view = game.mode==='text'?next:null; game.selection = null;
  game.attacks = 0; game.usedAttacker=null; game.scout=null; game.kills = 0; game.pending = null;
  game.message = player(next).cpu?`${player(next).name} is thinking…`:'';
}
function attackLimit(){return game.turn===0&&game.round===1?1:2;}
function cardHTML(id, action, location, index, opts={}) {
  const selected = game?.selection && game.selection.location === location && game.selection.index === index;
  const attrs = action ? `data-action="${action}" data-location="${location}" data-index="${index}"` : 'disabled';
  const place=opts.owner!=null?`${player(opts.owner).name}, ${opts.row} slot ${index+1}, `:'';
  const queenLink=opts.className?.includes('queen-linked')?' style="border-color:#e9be74;outline:1px solid #f6d899;outline-offset:1px;box-shadow:0 4px 0 #10251e,0 0 12px #e9be7470"':opts.className?.includes('queen-attendant')?' style="border-color:#e9be74;box-shadow:0 4px 0 #10251e,0 0 9px #e9be7455"':'';
  if (!id) return `<button class="card empty ${opts.buyConfirm?'buy-armed':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}${opts.buyConfirm?'tap again to hire for two coins':'empty slot'}">${opts.buyConfirm?'2 ◉':'+'}</button>`;
  if (opts.hidden) return `<button class="card back ${opts.target?'target':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}face-down card"><span class="center">♛</span></button>`;
  const r=rank(id),role={A:'ASSASSIN','10':'KNIGHT',J:'JACK',Q:'QUEEN',K:'KING'}[r]||'';
  return `<button class="card ${['♥','♦'].includes(suit(id))?'red':''} ${selected?'selected':''} ${opts.className||''}"${queenLink} ${attrs} aria-label="${escapeHTML(place)}${label(id)}${role?`, ${role.toLowerCase()}`:''}" aria-pressed="${Boolean(selected)}"><span class="rank">${r}<small>${suit(id)}</small></span><span class="center">${suit(id)}</span>${role?`<span class="card-role">${role}</span>`:''}<span class="rank foot">${r}<small>${suit(id)}</small></span></button>`;
}
function lineHTML(cards, action, location, hidden=false) { return `<div class="line">${cards.map((id,i) => cardHTML(id,action,location,i,{hidden})).join('')}</div>`; }
function syncGameHash(){
  const inMatch=!!game&&slotId&&!hubOpen&&!incomingBackup&&!incomingScores&&!tutorialOpen&&!scoresOpen&&!linkLoading;
  const current=location.hash;
  if(!(current===''||current.startsWith('#game=')))return;
  const wanted=inMatch?`#game=${slotId}`:'';
  if(current===wanted)return;
  if(typeof history==='undefined'||typeof history.replaceState!=='function')return;
  try{history.replaceState(null,'',location.pathname+location.search+wanted);}catch(error){console.error(error);}
}
function frame(content,compact=false) {
  const inMatch=!!game&&!hubOpen&&!incomingBackup&&!incomingScores&&!tutorialOpen&&!scoresOpen;
  const ladder=!inMatch&&!hubOpen?ratingStandings():null;
  const eloPill=ladder?`<button class="pill" data-action="scores-open" title="Solo Elo and records">Elo: ${Math.round(ladder.ratings.human).toLocaleString()}</button>`:'';
  const gamesPill=`<button class="pill" data-action="games">Games</button>`;
  const topAction=inMatch?matchReplay||computerPlayback?'':`<button class="pill" data-action="toggle-sheet" aria-label="Match details">Details</button>${gamesPill}`:hubOpen?'':`${eloPill}${gamesPill}`;
  const credit=`<p class="notice">${creditLine}<br><span class="build-number">${buildLine}</span><br><span class="perf">${timingLine()}</span></p>`;
  app.innerHTML = `<main class="app ${compact?'compact-app':''}"><header class="top ${compact?'compact-top':''}"><button type="button" class="brand" data-action="reload" aria-label="Reload Regicidious" title="Reload page">♛ Regicidious</button><div class="top-actions">${topAction}</div></header>${storageError?`<div class="status" role="alert">${storageError}</div>`:''}${backupError?`<div class="status" role="alert">${backupError}</div>`:''}${content}${!compact&&!game&&!hubOpen&&!incomingBackup&&!incomingScores&&!scoresOpen&&!tutorialOpen?pastePanel():''}${!compact&&inMatch?arenaDetails():''}${compact?'':credit}</main>`;
  syncGameHash();
}
function shortTileName(name,count){
  const chars=Array.from(name.trim()),max=count>2?10:13;
  return chars.length>max?chars.slice(0,max-1).join('')+'…':chars.join('');
}
function compactAge(time){
  if(!time)return 'No moves yet';
  const elapsed=Math.max(0,Date.now()-time);
  if(elapsed<60000)return 'just now';
  if(elapsed<3600000)return `${Math.floor(elapsed/60000)}m ago`;
  if(elapsed<86400000)return `${Math.floor(elapsed/3600000)}h ago`;
  if(elapsed<604800000)return `${Math.floor(elapsed/86400000)}d ago`;
  if(elapsed<2592000000)return `${Math.floor(elapsed/604800000)}w ago`;
  return `${Math.floor(elapsed/2592000000)}mo ago`;
}
function slotCard({id,game:g,dates}, finished) {
  const current=g.phase==='setup'?g.setup:g.turn;
  const ownSeat=g.mode==='text'?Number(recallSeat(g.matchId)??-1):0;
  const ownKingdomFallen=!finished&&ownSeat>=0&&!g.players[ownSeat]?.alive;
  const roster=g.players.map((p,i)=>`<span class="tile-player${!p.alive?' tile-fallen':''}${!finished&&i===current?' tile-current':''}"><span class="tile-emoji">${escapeHTML(p.emoji)}</span><span class="tile-name">${escapeHTML(shortTileName(p.name,g.players.length))}</span></span>`).join('');
  const full=g.players.map(p=>`${p.emoji} ${p.name}`).join(' versus ');
  const age=compactAge(dates.last),status=finished?'finished':slotIsMine(g)?'game-ready':'game-waiting';
  return `<button type="button" class="game-tile ${status}${ownKingdomFallen?' game-fallen':''}" data-action="open-game" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(full)}. ${ownKingdomFallen?'Your kingdom has fallen. ':''}${finished?'Finished match.':'Current turn: '+g.players[current].name+'.'} Last move ${escapeHTML(relativeText(dates.last)||'not recorded')}." title="${escapeHTML(full)}"><span class="tile-roster">${roster}</span><span class="tile-last">${finished?'Finished · ':'Last move · '}${escapeHTML(age)}</span></button>`;
}
function renderHub() {
  const slots=gameSlots();
  const active=slots.filter(s=>s.game.phase!=='victory'&&s.game.phase!=='stalemate').sort((a,b)=>Number(slotIsMine(b.game))-Number(slotIsMine(a.game))||(b.dates.last||0)-(a.dates.last||0));
  const done=slots.filter(s=>s.game.phase==='victory'||s.game.phase==='stalemate').sort((a,b)=>(b.dates.last||0)-(a.dates.last||0));
  if(completedOpen){
    frame(`<section class="games-heading"><h1>Completed games</h1></section>${hubNotice?`<p class="status">${escapeHTML(hubNotice)}</p>`:''}<div class="game-grid">${done.map(s=>slotCard(s,true)).join('')}</div>${done.length?'':'<p class="muted">No completed games on this device.</p>'}<div class="game-tools"><button class="button secondary" data-action="games">Back to games</button></div>`);
    return;
  }
  frame(`<section class="games-heading"><h1>Games</h1><p>${active.length} in progress</p></section>${hubNotice?`<p class="status">${escapeHTML(hubNotice)}</p>`:''}<div class="game-grid">${active.map(s=>slotCard(s,false)).join('')}<button type="button" class="game-tile game-new" data-action="new-game"><span aria-hidden="true">＋</span><strong>New Game</strong></button></div><div class="game-tools">${done.length?`<button class="button secondary" data-action="completed-games">Completed games (${done.length})</button>`:''}<button class="button secondary" data-action="tutorial-open">Tutorial</button><button class="button secondary" data-action="scores-open">Solo records</button></div>${pastePanel()}`);
}
function renderScores() {
  let entries=[];
  try { entries=readScoreTable(); } catch(error){scoreLinkError='This score table could not be read. Its saved data was kept.';console.error(error);}
  const ladder=ratingStandings();
  const elo=ladder?`<section class="panel rating-panel"><div class="phase">Personal Elo · vs computer</div><h2>You · ${Math.round(ladder.ratings.human).toLocaleString()}</h2><p class="muted small">${ladder.records.human.wins} wins · ${ladder.records.human.losses} losses</p><div class="rating-opponents">${Object.entries(PERSONA_NAMES).map(([id,name])=>`<div><strong>${name}</strong><span>${Math.round(ladder.ratings[id]).toLocaleString()} · ${ladder.records[id].wins}W ${ladder.records[id].losses}L</span></div>`).join('')}</div><p class="muted small">Beat a commander to take rating from them; lose and they take yours. Repeated wins over the same foe earn less each time.</p></section>`:'';
  ensureScoreLink();
  const slots=new Map(gameSlots().filter(s=>s.game.phase==='victory').map(s=>[s.game.matchId,s]));
  const rows=entries.filter(e=>e.layout===scoreLayout).map((e,i)=>{
    const saved=slots.get(e.id),replay=saved&&canReplay(saved.game);
    return `<section class="panel score-row"><div class="score-top"><strong>#${i+1} · ${e.score.toLocaleString()} points</strong><span>${scoreDate(e.date)}</span></div><p>${e.emoji} ${escapeHTML(e.name)} · ${PERSONA_NAMES[e.difficulty]} · ${e.turns} ${e.turns===1?'turn':'turns'}</p><p class="muted small">Match ${e.id.slice(0,8)}</p><div class="actions">${replay?`<button class="button secondary" data-action="replay-game" data-id="${saved.id}">Replay</button>`:`<span class="muted small">Replay unavailable${saved?'':' · restore the game backup'}</span>`}${saved?`<button class="button ghost" data-action="backup-slot" data-id="${saved.id}">Make game backup</button>`:''}</div>${saved&&backupForSlot===saved.id&&backupText?`<textarea readonly rows="3">${escapeHTML(backupText)}</textarea><button class="button secondary" data-action="copy-backup">Copy game link</button>`:''}</section>`;
  }).join('');
  frame(`<section class="score-heading"><div class="phase">Personal records · solo 1v1</div><h1>High scores</h1><p>Victory earns 1,000 points, plus up to 1,000 for speed. Each extra commander turn costs 50 speed points. Serf ×1, Squire ×1.25, Knight ×1.5.</p></section>${scoreImportNotice?`<p class="status">${escapeHTML(scoreImportNotice)}</p>`:''}<div class="score-tabs"><button class="button ${scoreLayout==='expanded'?'':'secondary'}" data-action="score-layout" data-value="expanded">Expanded</button><button class="button ${scoreLayout==='classic'?'':'secondary'}" data-action="score-layout" data-value="classic">Classic</button></div>${ratingError?`<p class="status">${escapeHTML(ratingError)}</p>`:''}${elo}${rows||'<p class="muted">No solo 1v1 victories on this board yet.</p>'}<section class="panel"><h2>Keep your records</h2><p class="muted small">This link carries your scores and ratings, not the games themselves. Back up games separately if you want to replay them.</p>${scoreLinkError?`<p class="status">${escapeHTML(scoreLinkError)}</p>`:''}<div class="actions"><button class="button secondary" data-action="copy-scores" ${scoreLink?'':'disabled'}>Copy table link</button><button class="button secondary" data-action="share-scores" ${scoreLink?'':'disabled'}>Send table link</button></div><details><summary>Show score table link</summary><textarea readonly rows="3">${escapeHTML(scoreLink||'Preparing link…')}</textarea></details></section>${pastePanel()}`);
}
function setTutorialStep(step) {
  tutorialStep=step;tutorialDice=null;
  try { localStorage.setItem('regicidious.tutorial.step',String(step)); }
  catch { /* The lesson remains usable if storage is blocked. */ }
  render();
}
function closeTutorial() {
  clearTimeout(tutorialTimer);tutorialRolling=false;tutorialDice=null;tutorialOpen=false;
  try { localStorage.setItem('regicidious.tutorial.open','0'); }
  catch { /* The saved match is unaffected. */ }
}
function rollTutorial() {
  if(tutorialRolling||![3,6].includes(tutorialStep))return;
  tutorialRolling=true;let tick=0;
  const enemyTurn=tutorialStep===6;
  const tumble=()=>{
    if(!tutorialOpen){tutorialRolling=false;return;}
    if(++tick>=10){tutorialRolling=false;setTutorialStep(enemyTurn?7:4);return;}
    tutorialDice={own:Array.from({length:enemyTurn?1:2},()=>1+Math.floor(Math.random()*6)),enemy:Array.from({length:enemyTurn?3:1},()=>1+Math.floor(Math.random()*6))};
    render();tutorialTimer=setTimeout(tumble,110);
  };
  tumble();
}
function renderTutorial() {
  const step=tutorialStep;
  const headings=['The training grounds','Array thy lines','Choose a foe','The odds of battle','Your first victory','Collect thy spoils','The counterattack','A fallen champion','Ready for war'];
  const words=[
    'Meet Sir Strawhelm, master of the practice yard. This short 1v1 lesson uses scripted dice. No real game or score is changed.',
    'Your front line faces his front line. Your King rests behind it. Tap your Peasant (8) to attack.',
    'An attacker strikes a card in the enemy front line. Tap Sir Strawhelm’s leftmost hidden card.',
    'It is a Peasant (4). Your 8 outranks the 4, so you roll two dice and Sir Strawhelm rolls one. The highest single die wins.',
    'Your highest die is 5; his is 4. His Peasant falls. The unused 2 is dimmed. A draw would have spared both cards.',
    'A defeated card earns one coin. Your Jack earns another at turn’s end: collect two. The opening commander gets only one attack; later turns allow two with different cards.',
    'Sir Strawhelm swaps his Knight (10) to the front before his turn. Against your Peasant (8), his front-line Knight gets three dice. Watch the counterattack.',
    'His 6 beats your 3, so your Peasant falls. Defenders can kill attackers, too. Your Queen and King still stand.',
    'You have seen setup, attack, dice, income, and defense. In a real match, prepare your lines before fighting, spend two coins to hire a card, and keep your King alive.'
  ];
  if(step===0){frame(`<section class="panel tutorial-intro"><div class="crown">🪵</div><div class="phase">Guided 1v1 skirmish</div><h1>Sir Strawhelm awaits</h1><p>${words[0]}</p><button class="button wide" data-action="tutorial-next">Enter the yard →</button></section>`);return;}
  const enemyTurn=step>=6;
  const enemyFront=enemyTurn?[null,'1-10','1-A']:step>=5?[null,'1-7','1-A']:['1-4','1-7','1-A'];
  const enemyBack=enemyTurn?['1-K','1-7','1-J']:['1-K','1-10','1-J'];
  const ownFront=[step>=8?null:'0-8','0-Q','0-4'];
  const ownBack=['0-K','0-J','0-10'];
  const card=(id,owner,row,i)=>cardHTML(id,step===1&&owner===0&&row==='front'&&i===0?'tutorial-attacker':step===2&&owner===1&&row==='front'&&i===0?'tutorial-target':'',`tutorial-${owner}-${row}`,i,{hidden:owner===1&&!(row==='front'&&i===0&&step>=3&&step<=4)&&!(row==='front'&&i===1&&enemyTurn),className:step===4&&owner===1&&row==='front'&&i===0||step===7&&owner===0&&row==='front'&&i===0?'tutorial-fallen':''});
  const row=(ids,owner,kind)=>`<div class="arena-row"><span class="arena-label">${kind} line</span><div class="line">${ids.map((id,i)=>card(id,owner,kind,i)).join('')}</div></div>`;
  const dice=tutorialDice||(step===4?{own:[2,5],enemy:[4]}:step===7?{own:[3],enemy:[1,4,6]}:null);
  const diceHTML=dice?`<div class="tutorial-dice"><div>${enemyTurn?'Sir Strawhelm':'You'} ${diceFaces(enemyTurn?dice.enemy:dice.own,!tutorialRolling)}</div><span>vs</span><div>${enemyTurn?'You':'Sir Strawhelm'} ${diceFaces(enemyTurn?dice.own:dice.enemy,!tutorialRolling)}</div></div>`:'';
  const action=step===3||step===6?`<button class="button wide" data-action="tutorial-roll" ${tutorialRolling?'disabled':''}>${tutorialRolling?'The dice tumble…':'Roll the dice →'}</button>`:step===1||step===2?'':step===8?'<div class="actions"><button class="button" data-action="tutorial-finish">Play a real game →</button><button class="button secondary" data-action="tutorial-restart">Practice again</button></div>':`<button class="button wide" data-action="tutorial-next">${step===5?'Collect 2 coins →':'Continue →'}</button>`;
  frame(`<section class="tutorial-page"><div class="phase">Training grounds · ${step}/8</div><h1>${headings[step]}</h1><p class="tutorial-guidance">${words[step]}</p><div class="tutorial-board"><div class="tutorial-side"><strong>🪵 Sir Strawhelm ♥</strong>${row(enemyBack,1,'back')}${row(enemyFront,1,'front')}</div>${diceHTML}<div class="tutorial-side"><strong>${draft.emojis[0]} You ♠ · ◉ ${step>=6?2:0}</strong>${row(ownFront,0,'front')}${row(ownBack,0,'back')}</div></div>${action}</section>`);
}
function renderScoreImport() {
  const classic=incomingScores.filter(e=>e.layout==='classic').length;
  const expanded=incomingScores.length-classic;
  frame(`<section class="panel dispatch"><div class="phase">Personal score backup</div><h1>Restore high scores?</h1><p>${expanded} Expanded and ${classic} Classic scores${incomingRatings?`, plus ${incomingRatings.length} rating results`:''}.</p><p>Your current scores and games stay here. Results you already have are kept once.</p><button class="button wide" data-action="restore-scores">Merge score table</button></section>`);
}
function playerChips(saved) {
  return `<div class="dispatch-seats">${saved.players.map((p,i)=>`<span class="suit-chip${p.alive?'':' fallen-kingdom'}"${p.alive?'':' title="Fallen kingdom"'}>${p.emoji} ${SUITS[i]} ${escapeHTML(p.name)}</span>`).join('')}</div>`;
}
function renderImport() {
  const g=incomingBackup, victory=g.phase==='victory', invitation=g.phase==='invite', turn=incomingKind==='turn';
  const winner=g.players.find(p=>p.alive);
  const focus=incomingSeat!=null&&g.players[incomingSeat]?g.players[incomingSeat]:g.players[g.turn];
  const title=victory?'The final dispatch':invitation?'A royal invitation':turn?'A royal dispatch':'A private backup';
  const headline=victory?`${escapeHTML(winner?.name||'A kingdom')} takes the crown`:invitation?`${escapeHTML(focus.name)}, you are summoned`:`${escapeHTML(focus.name)}, your move`;
  const started=g.startedAt>0?dateText(g.startedAt):'unknown';
  const body=victory?'Open to watch the final clash and the result. Your other saved games stay on this device.':invitation?'Claim your kingdom now. Your battle lines open when the host declares war and sends the next link.':turn?'Open to replay the last fights and continue if this seat is yours. Your other saved games stay on this device.':'Restoring adds another saved game. Your current games remain untouched.';
  const go=victory?'View final clash':invitation?'Claim my seat':turn?'Open turn & replay':'Add backup';
  const progress=invitation?`${g.players.length} kingdoms gather`:g.phase==='setup'?`Battle lines · ${g.setup+1} of ${g.players.length}`:`Round ${g.round} · turn #${g.turnNumber}`;
  const notice=restoreNoticeText(g);
  frame(`<section class="panel dispatch"><div class="phase">${title}</div><h2>${headline}</h2><p class="muted">${progress}</p>${playerChips(g)}<p class="muted small">Started ${escapeHTML(started)}</p><p class="small">${body}</p>${notice?`<p class="status">${escapeHTML(notice)}</p>`:''}<div class="actions"><button class="button" data-action="restore-backup">${go}</button></div></section>`);
}
function renderTextWaiting() {
  ensureTurnLink();
  ensureInvites();
  const p=player(game.turn);
  const invites=textAccess()===0?`<section class="panel"><h2>Invite players to their own seats</h2><p class="small muted">Send each player their own invite once. Opening it claims that seat on their device.</p>${game.players.map((q,i)=>i===0?'':`<p>${escapeHTML(q.name)} ${SUITS[i]}</p>${inviteLinks[i]?.url?`<div class="actions"><button class="button secondary" data-action="copy-invite" data-index="${i}">Copy invite</button><button class="button secondary" data-action="share-invite" data-index="${i}">Share…</button></div><textarea readonly rows="2">${escapeHTML(inviteLinks[i].url)}</textarea>`:'<p class="small muted">Preparing invite…</p>'}`).join('')}</section>`:'';
  const settingUp=game.phase==='setup';
  const summary=`<section class="waiting-summary"><div class="crown">${p.emoji}</div><div><div class="phase">${settingUp?`Battle lines · ${game.setup+1} of ${game.players.length}`:`Text multiplayer · turn #${game.turnNumber}`}</div><h1>${escapeHTML(p.name)}’s ${settingUp?'battle lines':'turn'}</h1><p>Send the next link to ${escapeHTML(p.name)}. Your copy waits here.</p></div></section>`;
  const actions=turnLink?`<div class="actions"><button class="button" data-action="copy-turn">Copy message</button><button class="button secondary" data-action="share-turn">Send text to ${escapeHTML(p.name)}</button></div><details class="share-detail"><summary>Show message and link</summary><textarea readonly rows="5" aria-label="Message and link">${escapeHTML(shareMessage(game,turnLink))}</textarea></details>`:'<p class="muted small">Preparing a private turn link…</p>';
  const dispatch=`<section class="panel waiting-panel"><h2>${settingUp?'Send the setup':'Send the turn'}</h2>${settingUp?'':`<p class="muted small">${escapeHTML(lastBattleSentence(game))}</p>`}${replayLastButton()}${turnLinkError?`<p class="status">${escapeHTML(turnLinkError)}</p>`:''}${actions}<p class="muted small">The link contains the whole match and a key. Keep it in your game group; it deters casual peeking but cannot prevent cheating.</p></section>`;
  frame(`${summary}${dispatch}${invites}${pastePanel()}`);
}
function renderTextInvites() {
  if(textAccess()!==0){
    frame(`<section class="panel dispatch"><div class="phase">The call to arms</div><h1>Await the declaration</h1><p>${escapeHTML(player(0).name)} is gathering the kingdoms. Your invitation has been saved; your battle lines will open when the host sends the first turn.</p></section>`);
    return;
  }
  ensureInvites();
  const seats=game.players.slice(1).map((p,i)=>{
    const seat=i+1,link=inviteLinks[seat]?.url;
    return `<div class="invite-seat"><h3>${p.emoji} ${SUITS[seat]} ${escapeHTML(p.name)}</h3>${link?`<div class="actions"><button class="button secondary" data-action="copy-invite" data-index="${seat}">Copy invite</button><button class="button secondary" data-action="share-invite" data-index="${seat}">Share invite</button></div>`:'<p class="muted small">Preparing a private invitation…</p>'}</div>`;
  }).join('');
  frame(`<section class="panel dispatch"><div class="phase">Gather your kingdoms</div><h1>Send the royal invitations</h1><p>Each player needs their own named invite to claim a seat. Send these before declaring war.</p>${seats}<p class="flavor">The gauntlet has been thrown down.</p><button class="button wide" data-action="declare-war">Declare war!</button></section>`);
}
function renderStart() {
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone;
  const install=!standalone&&!installDismissed?`<section class="install-tip" aria-label="Install Regicidious"><div><strong>Add to Home Screen</strong><p>On iPhone, open in Safari, tap Share, then Add to Home Screen. For text games, paste a received link into the installed app if Messages opens Safari.</p></div><button class="tip-close" data-action="dismiss-install" aria-label="Dismiss install tip">×</button></section>`:'';
  frame(`<section class="launch"><div class="launch-crown">♛</div><h1>A battle in your pocket</h1><p>Raise your banner. Guard your king. Take the crown.</p><button class="button wide launch-start" data-action="setup-open">Start new game →</button><button class="button secondary wide" data-action="tutorial-open">Training grounds · tutorial</button><button class="button secondary wide" data-action="scores-open">Solo high scores</button>${gameSlots().length?'<button class="button secondary wide" data-action="games">Continue a saved game</button>':''}</section>${install}<details class="panel compact-rules"><summary>How to play</summary><p>Prepare your line, hire reinforcements, then attack once on the opening turn and up to twice thereafter with different cards. Solo, pass the phone, or exchange turns by text link.</p></details>`);
}
function renderSetup() {
  const modes=[['solo','Solo vs computer'],['local','Pass the phone'],['text','Text-message multiplayer']];
  const layouts=[['expanded','Expanded · 4 across, 7 cards'],['classic','Classic · 3 across, 6 cards']];
  const difficulty=draft.mode==='solo'?`<div class="label">Enemy commander</div><div class="actions mode-actions">${[['serf','Serf · easy'],['squire','Squire · normal'],['knight','Knight · hard']].map(([id,title])=>`<button class="button ${draft.difficulty===id?'':'ghost'}" data-action="difficulty" data-value="${id}">${title}</button>`).join('')}</div><p class="small muted">Serf charges recklessly. Squire weighs the odds. Knight guards the crown and picks fights carefully.</p>`:'';
  const identityInput=i=>`<div class="player-identity"><label class="field"><span>${i===0?'Your name · tap to change':`${NAMES[i]} · suggested name`}</span><input data-name="${i}" maxlength="24" value="${escapeHTML(draft.names[i])}" autocomplete="off"></label><label class="field emoji-field"><span>Emoji</span><select data-emoji="${i}" aria-label="${escapeHTML(draft.names[i])} emoji">${EMOJIS.map(emoji=>`<option value="${emoji}"${draft.emojis[i]===emoji?' selected':''}>${emoji}</option>`).join('')}</select></label></div>`;
  const otherInputs=draft.mode==='solo'?'':draft.names.slice(1,draft.count).map((_,i)=>identityInput(i+1)).join('');
  frame(`<div class="setup-heading"><button class="button ghost" data-action="setup-back">‹ Back</button><h1>New game</h1></div><section class="panel setup-panel"><p class="flavor">M’lord, our enemies are at the gates. We must prepare for war!</p><div class="label">Your banner</div>${identityInput(0)}<div class="label">Mode</div><div class="actions mode-actions">${modes.map(([mode,title])=>`<button class="button ${draft.mode===mode?'':'ghost'}" data-action="mode" data-value="${mode}">${title}</button>`).join('')}</div><div class="label">Battle lines</div><div class="actions mode-actions">${layouts.map(([layout,title])=>`<button class="button ${draft.layout===layout?'':'ghost'}" data-action="layout" data-value="${layout}">${title}</button>`).join('')}</div>${difficulty}<div class="label">${draft.mode==='solo'?'Computer opponents':'Players'}</div><div class="actions">${[2,3,4].map(n=>`<button class="button ${draft.count===n?'':'ghost'}" data-action="count" data-value="${n}">${draft.mode==='solo'?n-1:n}</button>`).join('')}</div>${otherInputs?`<div class="stack" style="margin-top:18px">${otherInputs}</div><p class="small muted">These are suggestions. Each player chooses their own name and emoji before setting up their lines.</p>`:''}${draft.mode==='text'?`<p class="small muted">Send each player their private invite on the next screen, then declare war. Links discourage casual peeking but are not cheat-proof.</p>`:''}<button class="button wide begin-game" data-action="start">${draft.mode==='text'?'Prepare invitations →':'Begin the war →'}</button></section>`);
}
function renderFirstIdentity(){
  const p=player(game.setup);
  frame(`<section class="panel identity-gate"><div class="phase">Your first turn · ${SUITS[game.setup]} kingdom</div><h1>Choose your banner</h1><p class="muted">${game.mode==='text'?'The host suggested a name and emoji. Make them yours before you set your lines. Your choice travels with the next game link.':'Make this kingdom your own before setting your lines. Pass the phone in private.'}</p><div class="player-identity"><label class="field"><span>Your name</span><input data-claim-name maxlength="24" value="${escapeHTML(p.name)}" autocomplete="off"></label><label class="field emoji-field"><span>Emoji</span><select data-claim-emoji aria-label="Your emoji">${EMOJIS.map(emoji=>`<option value="${emoji}"${p.emoji===emoji?' selected':''}>${emoji}</option>`).join('')}</select></label></div><button class="button wide" data-action="claim-identity">Set up battle lines →</button></section>`);
}
function renderVeil() {
  const index = game.phase === 'setup' ? game.setup : game.phase === 'refill' ? game.refill[game.refillIndex] : game.phase === 'queen' ? game.pending.defender : game.turn;
  const text = game.phase === 'setup' ? 'M’lord, our enemies are at the gates. We must prepare for war!' : game.phase === 'refill' ? 'Fill any front-line gaps in private.' : game.phase === 'queen' ? 'Your Queen sacrifices the weakest adjacent peasant.' : 'Your kingdom is waiting.';
  const solo=game.mode==='solo';
  frame(`<section class="veil"><div><div class="crown">${player(index).emoji}</div><div class="phase">${solo?'Your kingdom':'Pass the phone'}</div><h1>${escapeHTML(player(index).name)}</h1><p>${text}${solo?'':'<br>Make sure only this player can see the screen.'}</p><div class="actions"><button class="button wide" data-action="reveal">${game.phase==='setup'?'Set up battle lines →':solo?'Continue →':`I’m ${escapeHTML(player(index).name)} — reveal`}</button></div></div></section>`);
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
  // The Queen draws her extra die from one adjacent peasant. Mark that pair
  // while the player is choosing an attack, rather than adding more UI text.
  const queenIndex=own&&mode==='attack'&&!visual?p[row].findIndex(id=>id&&rank(id)==='Q'):-1;
  const attendant=queenIndex<0?null:adjacentPeasants(p,row,queenIndex)
    .sort((a,b)=>value(a.id)-value(b.id)||a.index-b.index)[0];
  const cards=p[row].map((id,index)=>{
    let action='';
    if(own && ['setup','buy','arrange','refill'].includes(mode))action='slot';
    if(own && mode==='attack' && id && id!==game.usedAttacker && (row==='front'||rank(id)==='10'))action='attacker';
    if(!own && mode==='attack' && id)action='target';
    const source=visual?.source?.owner===owner&&visual.source.row===row&&visual.source.index===index;
    const target=visual?.target?.owner===owner&&visual.target.row===row&&visual.target.index===index;
    const loser=visual?.loser?.owner===owner&&visual.loser.row===row&&visual.loser.index===index;
    const winner=visual?.winner?.owner===owner&&visual.winner.row===row&&visual.winner.index===index;
    const reveal=source||target&&visual?.revealTarget||!own && mode==='battle' && game.pending?.defender===owner && game.pending.target.row===row && game.pending.target.index===index;
    const hidden=visual?.revealAll?false:visual?(!own||visual.hideOwnOthers||player(owner).cpu)&&!reveal:!own&&!reveal;
    const active=source||target&&visual?.showTarget;
    const linkClass=!visual&&index===queenIndex?'queen-linked':!visual&&index===attendant?.index?'queen-attendant':'';
    const className=visual?`${!active?'replay-dim':''} ${active?'replay-active':''} ${source&&visual.kind==='reveal'?'replay-flip':''} ${loser?'replay-loser':''} ${winner?'replay-winner':''}`:linkClass;
    return cardHTML(id,action,own?row:`${owner}:${row}`,index,{hidden,owner,row,target:reveal,className,buyConfirm:own&&['buy','arrange'].includes(mode)&&buyPrompt?.location===row&&buyPrompt.index===index});
  });
  const wide=p[row].length>3?' cols-4':'';
  return `<div class="arena-row${wide}"><span class="arena-label">${row==='front'?'Front line':'Back line'}</span><div class="line">${cards.join('')}</div></div>`;
}
function arenaDetails() {
  if(!sheetOpen)return '';
  const share=game.mode==='text'?`<p class="small muted">Turn #${game.turnNumber}: ${escapeHTML(player(game.turn).name)}</p>${replayLastButton()}<p class="small muted">${game.phase==='invite'?'Send each player their private invitation.':textAccess()===game.turn?'Finish your turn to create the next player’s link.':'Waiting for the next turn link.'}</p>`:'';
  const notice=game.mode==='text'?restoreNoticeText(game,textAccess()):'';
  const backup=`<p class="small muted">Back up this match before removing it if you may want to restore it later.</p><button class="button secondary wide" data-action="backup">Make Backup</button>${backupForSlot===slotId&&backupText?`<textarea readonly rows="3">${escapeHTML(backupText)}</textarea><button class="button secondary" data-action="copy-backup">Copy backup link</button>`:''}`;
  const dates=slotId?readDates(slotId):{started:0,last:0};
  return `<div class="sheet-scrim" data-action="toggle-sheet"></div><section class="arena-sheet" role="dialog" aria-label="Game details"><div class="row"><h3>Match details</h3><button class="button ghost" data-action="toggle-sheet">Close</button></div><p class="muted small">Round ${game.round} · ${escapeHTML(player(game.turn).name)} · ${escapeHTML(game.phase)}</p><p class="muted small">Started ${escapeHTML(dateText(dates.started||game.startedAt))}<br>Last move ${escapeHTML(dateText(dates.last))}${dates.last?` · ${escapeHTML(relativeText(dates.last))}`:''}</p>${notice?`<p class="status">${escapeHTML(notice)}</p>`:''}<p class="small">${escapeHTML(game.message||'Tap a card to select it. The highest individual die wins.')}</p>${game.log?.length?`<div class="small muted">${game.log.slice(-6).reverse().map(item=>`<p>${escapeHTML(item)}</p>`).join('')}</div>`:''}${share}${backup}<div class="details-actions"><button class="button secondary wide" data-action="games">All games</button><button class="button ${deleteCandidate===slotId?'danger':'ghost'} wide" data-action="delete-game" data-id="${escapeHTML(slotId)}">${deleteCandidate===slotId?'Confirm delete':'Delete from this device'}</button></div><p class="small muted">${creditLine}</p>${timings.render===null?'':`<p class="small muted perf">${timingLine()}</p>`}</section>`;
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
  const chooseOpponent=!visual||visual.revealAll&&!visual.source&&visual.opponent==null;
  const heading=`<strong>${target?`${target.emoji} ${escapeHTML(target.name)} ${SUITS[opponent]}`:'Your opponent'}</strong>`;
  const chips=chooseOpponent&&candidates.length>1?`<div class="opponent-chips" aria-label="Choose an opponent">${candidates.map(i=>`<button class="opponent-chip${i===opponent?' active':''}" data-action="opponent" data-index="${i}" aria-label="View ${escapeHTML(player(i).name)}" aria-pressed="${i===opponent}"><span class="chip-emoji">${player(i).emoji}</span><span class="chip-name">${escapeHTML(player(i).name)}</span></button>`).join('')}</div>`:'';
  const prepareHint=(mode==='buy'||mode==='arrange')&&!visual?intro:null;
  const middleText=visual||mode==='refill'?intro:prepareHint?(game.message?`${game.message} ${intro}`:intro):(game.message||intro);
  let middle=`<div class="arena-instruction">${escapeHTML(middleText)}</div>`;
  if(mode==='battle'||visual?.showDice) {
    const b=game.pending;
    const analysis=mode==='battle'?`<div class="clash-analysis battle-result" data-outcome="${escapeHTML(middleText)}" aria-live="polite">The dice tumble…</div>`:`<div class="clash-analysis" aria-live="polite">${escapeHTML(middleText)}</div>`;
    const settled=visual?.kind==='result';
    middle=`<div class="clash-strip"><div class="clash-dice" data-dice-lane aria-live="off"><div class="clash-side"><span>${label(b.defendCard)}</span><div class="dice">${diceFaces(b.defendDice,settled)}</div></div><span class="clash-versus">vs</span><div class="clash-side"><span>${label(b.attackCard)}</span><div class="dice">${diceFaces(b.attackDice,settled)}</div></div></div>${analysis}</div>`;
  }
  const own=player(owner);
  const seenReserve=visual?.revealAll&&target?.reserve?.length?`<div class="arena-row"><span class="arena-label">Reserve</span><div class="reserve">${target.reserve.map((id,i)=>cardHTML(id,'','reserve',i,{owner:opponent,row:'reserve'})).join('')}</div></div>`:'';
  const last=visual? '':replayLastButton(true);
  const attackStatus=['attack','battle','replay'].includes(mode)?` · ${game.attacks}/${attackLimit()} attacks`:'';
  frame(`<section class="arena" aria-label="Battlefield"><div class="arena-opponent">${chips}<div class="arena-hud">${heading}<span>${target?`${target.front.filter(Boolean).length+target.back.filter(Boolean).length} cards`:''}</span></div>${target?arenaRow(opponent,'back',false,mode,visual):''}${target?arenaRow(opponent,'front',false,mode,visual):''}${seenReserve}</div><div class="arena-middle">${middle}</div><div class="arena-self"><div class="arena-hud"><strong>${own.emoji} ${escapeHTML(own.name)} ${SUITS[owner]}</strong><span>◉ ${own.coins}${attackStatus}</span></div>${arenaRow(owner,'front',true,mode,visual)}${arenaRow(owner,'back',true,mode,visual)}${arenaReserve(owner,visual)}</div><div class="arena-dock ${visual?'replay-dock':''}${last?' with-last':''}">${controls}${last}</div></section>${arenaDetails()}`,true);
}
function renderPlay() {
  const p = player(game.turn);
  let intro = '';
  let controls = '';
  if (game.phase === 'buy' || game.phase === 'arrange') {
    const canBolster=p.front.includes(null)&&p.back.some(Boolean);
    intro = buyPrompt?'Hark! Tap the gilded hollow again to hire a random card for 2 coins.':`Prepare!! Good sire, array thy vanguard ere the horns sound.${p.coins>=2&&p.deck.length?' Tap an empty hollow twice to hire a random card for 2 coins.':''}`;
    controls = `${canBolster?`<button class="button secondary" data-action="bolster">Bolster your lines</button>`:''}<button class="button wide" data-action="next">Battle lines ready for battle!</button>`;
  } else if (game.phase === 'attack') {
    intro = `Attack!! Sally ${game.attacks+1}/${attackLimit()}: tap thy front champion or rear Knight, then a foe.${game.attacks?' A different champion must lead this charge.':''}`;
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
function diceFaces(values,settled=false) {
  const best=values.indexOf(Math.max(...values));
  return values.map((value,i)=>`<span class="die${settled&&i!==best?' die-unused':''}">${settled?value:'?'}</span>`).join('');
}
function renderBattle() {
  const b = game.pending;
  const rescue=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
  const outcome = b.result === 'tie' ? 'A draw. Both survive.' : rescue?royalSacrificeSentence(player(b.result==='attack'?b.defender:game.turn).name,b.result==='attack'?b.defendCard:b.attackCard,rescue.id):b.result === 'attack' ? `${player(game.turn).name}’s ${cardTitle(b.attackCard)} defeats ${player(b.defender).name}’s ${cardTitle(b.defendCard)}.` : `${player(b.defender).name}’s ${cardTitle(b.defendCard)} defeats ${player(game.turn).name}’s ${cardTitle(b.attackCard)}.`;
  renderArena(game.turn,'battle',outcome,`<button class="button" data-action="battle-next" disabled>Continue →</button>`);
  animateDice(b);
}
function animateDice(b) {
  const lane=app.querySelector('[data-dice-lane]');
  if(!lane)return;
  const faces=[...lane.querySelectorAll('.die')],numbers=[...b.defendDice,...b.attackDice];
  const finish=()=>{
    if(!lane.isConnected)return;
    const bestDefender=b.defendDice.indexOf(Math.max(...b.defendDice));
    const bestAttacker=b.attackDice.indexOf(Math.max(...b.attackDice))+b.defendDice.length;
    faces.forEach((face,i)=>{face.textContent=numbers[i];face.classList.toggle('die-unused',i!==bestDefender&&i!==bestAttacker);});
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
    clearTimeout(replayTimer);
    replayTimer=null;
    if(!holdForContinue)replayTimer=setTimeout(advanceReplay,{reveal:600,target:650,roll:900,result:700}[step.kind]);
  } finally {game=finalGame;}
}
function article(title) { return /^[AEIOU]/.test(title)?'an':'a'; }
function applyOrigin(state, origin) {
  state.turn=origin.turn;state.round=origin.round;state.phase=origin.phase;state.setup=origin.setup;
  state.view=origin.view;state.attacks=origin.attacks;state.usedAttacker=null;state.scout=null;state.kills=origin.kills;
  state.turnNumber=origin.turnNumber||1;state.selection=null;state.pending=null;
  state.refill=[];state.refillIndex=0;state.refillUndo=[];state.currentBattles=[];state.lastBattles=[];
  state.message='';state.log=[];
  state.players.forEach((p,i)=>{
    const s=origin.players[i];
    p.front=[...s.front];p.back=[...s.back];p.reserve=[...s.reserve];p.deck=[...s.deck];
    p.coins=s.coins;p.alive=s.alive;p.cpu=s.cpu;p.persona=s.persona||null;
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
    game.usedAttacker=attackCard;
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
    if(!['setup','refill'].includes(game.phase)){game.turn=event.owner;game.phase='attack';}
    game.selection=null;game.message='';
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
    for(let eventIndex=0;eventIndex<saved.history.events.length;eventIndex++){
      const event=saved.history.events[eventIndex];
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
      } else if(event.t==='setupDone'){
        if(saved.history.events[eventIndex-1]?.t!=='arrangeSet'){
          const who=game.phase==='arrange'?(game.mode==='solo'?0:game.players.length-1):game.setup-1;
          push(`${player(Math.max(0,who)).name} locks a formation.`);
        }
      }
      else if(event.t==='phase'&&event.phase==='arrange') push(`${player(game.turn).name} rearranges the line.`);
      else if(event.t==='phase'&&event.phase==='attack') push(`${player(game.turn).name} prepares to attack.`);
      else if(event.t==='resolve') push(game.phase==='victory'?`${player(living()[0]).name} wins.`:(game.message||'The clash is over.'));
      else if(event.t==='finish') push(game.phase==='refill'?'Front lines need filling.':'Attacks are over.');
      else if(event.t==='refillDone'&&saved.history.events[eventIndex-1]?.t!=='arrangeSet') push('The front line is confirmed.');
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
  } finally { game=finalGame; }
}
function renderQueen() {
  const b = game.pending, owner=b.result==='attack'?b.defender:game.turn;
  frame(`<section class="panel"><h2>Royal sacrifice</h2><p class="muted">${escapeHTML(player(owner).name)}’s ${cardTitle(b.result==='attack'?b.defendCard:b.attackCard)} is saved by the weakest adjacent peasant.</p><button class="button wide" data-action="sacrifice">Continue →</button></section>`);
}
function renderVictory() {
  const winner = player(living()[0]);
  if(game.mode==='text')ensureTurnLink();
  const score=ScoreCodec.entryFromGame(game);
  const rated=RatingCodec.fromGame(game),ladder=rated?ratingStandings():null,change=rated&&ladder?.changes[rated.id];
  const ratingPanel=change?`<section class="panel"><h2>Your Elo · ${Math.round(change.after).toLocaleString()}</h2><p class="muted">${change.delta>=0?'+':''}${Math.round(change.delta)} against ${escapeHTML(player(1).name)}.</p><button class="button secondary wide" data-action="scores-open">See ratings & high scores</button></section>`:'';
  const scorePanel=score?`<section class="panel"><h2>${score.score.toLocaleString()} points</h2><p class="muted">${score.turns} commander ${score.turns===1?'turn':'turns'} against ${PERSONA_NAMES[score.difficulty]}.</p><button class="button secondary wide" data-action="scores-open">See high scores</button></section>`:'';
  frame(`<section class="hero"><div class="crown">♛</div><div class="phase">The kingdom stands</div><h1>${escapeHTML(winner.name)} wins.</h1><p>${SUITS[winner.suit]} ${NAMES[winner.suit]} is the last kingdom standing.</p></section>${ratingPanel}${scorePanel}${canReplayLast()||canReplay(game)?`<section class="panel"><h2>Watch it again</h2><p class="muted small">${canReplay(game)?'Replay every turn with all cards face up.':'Watch the last fights again.'}</p>${replayLastButton()}${canReplay(game)?`<button class="button wide" data-action="replay-game">Replay game</button>`:''}</section>`:''}${game.mode==='text'?`<section class="panel"><h2>Tell the group</h2>${turnLink?`<div class="actions"><button class="button" data-action="copy-turn">Copy result</button><button class="button secondary" data-action="share-turn">Send result to group</button></div>`:'<p class="muted">Preparing result link…</p>'}</section>`:''}<section class="panel"><h2>Another game?</h2><p class="muted small">Starting another game leaves this one in your Games list.</p><button class="button secondary wide" data-action="new-after-win">New game</button></section>`);
}
function renderStalemate() {
  frame(`<section class="hero"><div class="crown">♛</div><h1>No winner yet.</h1><p>The computer could not bring this war to an end. The match is saved in your Games list.</p></section><section class="panel"><button class="button secondary wide" data-action="new-game">Start another game</button></section>`);
}
function render() {
  if(linkLoading)return frame(`<section class="panel"><h2>Opening game link…</h2><p class="muted">Checking and decrypting the match.</p></section>`);
  if(incomingScores)return renderScoreImport();
  if(incomingBackup) return renderImport();
  if(tutorialOpen)return renderTutorial();
  if(scoresOpen)return renderScores();
  if(hubOpen) return renderHub();
  if(matchReplay)return renderMatchReplay();
  if(computerPlayback)return renderPlayback();
  if (!game) return setupOpen?renderSetup():renderStart();
  if(game.phase==='invite')return renderTextInvites();
  if(game.mode==='text'&&textAccess()!==game.turn&&game.phase!=='victory')return renderTextWaiting();
  if(needsFirstIdentity())return renderFirstIdentity();
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
}
function completeRefill() {
  if(game.refill[game.refillIndex]!=null)recordFormation(game.refill[game.refillIndex]);
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
  game.log.push(`${player(game.turn).name} ${label(b.attackCard)} [${b.attackDice.join(',')}] vs ${player(b.defender).name} ${label(b.defendCard)} [${b.defendDice.join(',')}]: ${defeated?`${b.result==='attack'?label(b.attackCard):label(b.defendCard)} defeated ${label(defeated)}`:'draw'}.`);
  if (game.log.length>24) game.log.shift();
  if (b.result==='attack') {
    if (sacrificeIndex>=0) { const slot=b.sacrifice[sacrificeIndex]; defeat(b.defender,slot.row,slot.index); }
    else defeat(b.defender,b.target.row,b.target.index);
    game.kills++;
  } else if (b.result==='defend') {
    if(sacrificeIndex>=0){const slot=b.sacrifice[sacrificeIndex];defeat(game.turn,slot.row,slot.index);}
    else defeat(game.turn,b.source.row,b.source.index);
  }
  game.scout=player(b.defender)[b.target.row][b.target.index]===b.defendCard?{player:b.defender,row:b.target.row,index:b.target.index,id:b.defendCard}:null;
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
  if (game.attacks>=attackLimit() || !player(game.turn).front.some(id=>id&&id!==game.usedAttacker) && !player(game.turn).back.some(id=>id&&id!==game.usedAttacker&&rank(id)==='10')) finishAttacks();
}

function cardPriority(id) {
  const r=rank(id);
  return r==='Q'?18:r==='10'?17:r==='A'?15:r==='J'?13:r==='9'?12:r==='8'?11:r==='K'?-100:value(id);
}
const AI_TACTICS={
  serf:{risk:0,jitter:16,guardedKing:[7,7]},
  squire:{risk:1,jitter:.025,guardedKing:[7,7]},
  knight:{risk:1,jitter:.025,guardedKing:[3.8,2.2],queenTarget:4,knightTarget:2.5,jackTarget:2,assassinTarget:3,queenGuardAware:true},
};
function arrangeAI(p) {
  const frontLen=p.front?.length||3, backLen=p.back?.length||3;
  const cards=[...p.front,...p.back,...p.reserve].filter(Boolean);
  const king=cards.find(id=>rank(id)==='K');
  if(king && cards.length===1){p.front=[king,...Array(frontLen-1).fill(null)];p.back=Array(backLen).fill(null);p.reserve=[];return;}
  if(p.persona==='serf'){
    const field=shuffle(cards.filter(id=>id!==king));
    p.front=[...field.slice(0,frontLen),...Array(Math.max(0,frontLen-field.length)).fill(null)];
    const rear=[king,...field.slice(frontLen)];
    p.back=[...rear.slice(0,backLen),...Array(Math.max(0,backLen-rear.length)).fill(null)];
    p.reserve=rear.slice(backLen);
    return;
  }
  if(p.persona==='knight' && king){
    const field=cards.filter(id=>id!==king),queen=field.find(id=>rank(id)==='Q');
    const peasants=field.filter(isPeasant).sort((a,b)=>value(b)-value(a));
    const queenAlly=queen?peasants[0]:null;
    const guard=field.length>frontLen?peasants.findLast(id=>id!==queenAlly):null;
    const front=[...(queen?[queen]:[]),...(queenAlly?[queenAlly]:[])];
    front.push(...field.filter(id=>id!==guard&&!front.includes(id)).sort((a,b)=>cardPriority(b)-cardPriority(a)));
    p.front=[...front.slice(0,frontLen),...Array(Math.max(0,frontLen-front.length)).fill(null)];
    const rest=field.filter(id=>!p.front.includes(id));
    const rear=[...Array(backLen).fill(null)];
    rear[1]=king;
    for(const id of rest.slice(0,backLen-1))rear[rear[0]==null?0:rear.findIndex((slot,i)=>i!==1&&!slot)]=id;
    p.back=rear;p.reserve=rest.slice(backLen-1);
    return;
  }
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
  const persona=self.persona||'squire';
  const tactics=AI_TACTICS[persona]||AI_TACTICS.squire;
  const targets=[];
  for(const enemy of living()) if(enemy!==game.turn) {
    for(const row of ['front','back']) for(let index=0;index<player(enemy)[row].length;index++) if(player(enemy)[row][index]) targets.push({enemy,row,index});
  }
  const choices=[];
  for(const sourceRow of ['front','back']) for(let index=0;index<self[sourceRow].length;index++) {
    const id=self[sourceRow][index]; if(!id || id===game.usedAttacker || sourceRow==='back' && rank(id)!=='10') continue;
    for(const t of targets) {
      if(t.row==='back' && (rank(id)!=='10' || sourceRow==='back')) continue;
      // Evaluate a probability model for a face-down card, never its actual rank.
      const seen=persona==='knight'&&game.scout?.player===t.enemy&&game.scout.row===t.row&&game.scout.index===t.index?game.scout.id:null;
      const guesses=seen?[[rank(seen),1]]:t.row==='back'?[['K',.48],['Q',.12],['J',.12],['10',.08],['8',.2]]:[['Q',.23],['J',.18],['10',.14],['A',.12],['8',.33]];
      let score=0;
      const occupiedGuard=[t.index-1,t.index+1].filter(i=>i>=0&&i<player(t.enemy)[t.row].length&&player(t.enemy)[t.row][i]).length;
      for(const [r,probability] of guesses) {
        const imagined=`${t.enemy}-${r}`;
        const attackCount=1+(value(id)>value(imagined)?1:0)+(rank(id)==='10'&&t.row==='front'?1:0)+(rank(id)==='Q'&&adjacentPeasants(self,sourceRow,index).length?1:0);
        const defendCount=1+(value(imagined)>value(id)?1:0);
        const ordinary=diceOdds(attackCount,defendCount);
        const odds=ordinary;
        const targetValue=r==='K'?occupiedGuard?tactics.guardedKing[occupiedGuard-1]:7:r==='Q'?tactics.queenTarget||2.4:r==='10'?tactics.knightTarget||1.7:r==='J'?tactics.jackTarget||1:r==='A'?tactics.assassinTarget||1:1;
        const ownValue=rank(id)==='K'?7:rank(id)==='Q'?tactics.queenGuardAware&&adjacentPeasants(self,sourceRow,index).length?1:2.6:rank(id)==='10'?1.8:1;
        score+=probability*(odds.win*(1+targetValue)-tactics.risk*odds.lose*(rank(id)==='A'?0:ownValue));
      }
      if(t.row==='front' && player(t.enemy).front.filter(Boolean).length===1) score+=.15;
      score+=(random(1000)/1000)*tactics.jitter;
      choices.push({sourceRow,sourceIndex:index,...t,score});
    }
  }
  return choices.reduce((best,choice)=>!best||choice.score>best.score?choice:best,null);
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
    if(++steps>maxSteps) { game.phase='stalemate';game.message='The computer could not bring this war to an end.';return; }
    const p=player(game.turn);
    if(game.phase==='buy') {
      while(p.coins>=2 && p.deck.length && p.reserve.length<3) { p.coins-=2; const drawn=drawCard(p); p.reserve.push(drawn); record({t:'buy',card:drawn}); }
      game.phase='arrange';
    } else if(game.phase==='arrange') { arrangeAI(p); recordFormation(game.turn); game.phase='attack'; }
    else if(game.phase==='attack') {
      const choice=game.attacks<attackLimit() && chooseAIAttack();
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
  if(game.phase!=='attack'||!player(game.turn).alive||game.attacks>=attackLimit())return;
  if (!source || !['front','back'].includes(source.location) || !player(game.turn)[source.location][source.index]) return;
  if (targetPlayer===game.turn || !player(targetPlayer)?.alive || !player(targetPlayer)[row]?.[index]) return;
  const attackCard=player(game.turn)[source.location][source.index], defendCard=player(targetPlayer)[row][index];
  if(attackCard===game.usedAttacker){game.message='This champion has already attacked. Choose another for thy second charge.';game.selection=null;return;}
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
  game.usedAttacker=attackCard;
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
app.addEventListener('change', event => {
  const index=Number(event.target?.dataset?.emoji);
  if(event.target?.dataset?.emoji!=null&&index>=0&&index<4&&EMOJIS.includes(event.target.value)){
    draft.emojis[index]=event.target.value;
    if(index===0)rememberPlayerEmoji(event.target.value);
  }
});
app.addEventListener('click', event => {
  const button=event.target.closest('[data-action]');
  if(button?.dataset.action==='reload'){location.reload();return;}
  if(matchReplay) {
    const action=button?.dataset.action;
    if(matchReplay.suppressClick){matchReplay.suppressClick=false;if(action==='match-replay-prev'||action==='match-replay-next')return;}
    if(action==='games'){stopMatchReplay();hubOpen=true;render();return;}
    if(action==='match-replay-exit'){stopMatchReplay();render();return;}
    if(action==='match-replay-prev'){matchReplay.autoplay=false;clearTimeout(matchReplayTimer);stepMatchReplay(-1);return;}
    if(action==='match-replay-next'){matchReplay.autoplay=false;clearTimeout(matchReplayTimer);stepMatchReplay(1);return;}
    if(action==='match-replay-auto'){toggleMatchReplayAuto();return;}
    if(action==='opponent' && game){
      const step=matchReplay.frames[matchReplay.index];
      const owner=step.owner;
      const prevGame=game;game=step.state;
      try {
        const candidate=Number(button.dataset.index);
        if(candidate!==owner&&living().includes(candidate))selectedOpponent=candidate;
      } finally {game=prevGame;}
      render();
      return;
    }
    return;
  }
  if(computerPlayback) {
    const playing=button?.dataset.action;
    if(playing==='games') { clearTimeout(replayTimer);computerPlayback=null;hubOpen=true;render(); return; }
    if(playing==='restore-backup') { clearTimeout(replayTimer);computerPlayback=null; }
    else if(computerPlayback.frames[computerPlayback.index]?.kind==='result'&&playing!=='replay-next')return;
    else { advanceReplay(); return; }
  }
  if (!button) return;
  const action=button.dataset.action, index=Number(button.dataset.index);
  if(action==='tutorial-open') { stopMatchReplay();tutorialOpen=true;scoresOpen=false;hubOpen=false;try{localStorage.setItem('regicidious.tutorial.open','1');}catch{}render();return; }
  if(action==='tutorial-restart'){setTutorialStep(0);return;}
  if(action==='tutorial-next'&&tutorialOpen&&[0,4,5,7].includes(tutorialStep)){setTutorialStep(tutorialStep+1);return;}
  if(action==='tutorial-attacker'&&tutorialOpen&&tutorialStep===1){setTutorialStep(2);return;}
  if(action==='tutorial-target'&&tutorialOpen&&tutorialStep===2){setTutorialStep(3);return;}
  if(action==='tutorial-roll'&&tutorialOpen){rollTutorial();return;}
  if(action==='tutorial-finish'&&tutorialOpen){closeTutorial();game=null;slotId=null;setupOpen=true;render();return;}
  if(action==='scores-open'){scoresOpen=true;tutorialOpen=false;hubOpen=false;render();return;}
  if(action==='score-layout'){scoreLayout=button.dataset.value==='classic'?'classic':'expanded';render();return;}
  if(action==='copy-scores'&&scoreLink){navigator.clipboard?.writeText(scoreLink).catch(()=>{});return;}
  if(action==='share-scores'&&scoreLink){if(navigator.share)navigator.share({text:`My Regicidious high scores: ${scoreLink}`}).catch(()=>{});else navigator.clipboard?.writeText(scoreLink).catch(()=>{});return;}
  if(action==='restore-scores'&&incomingScores){
    try{
      const merged=ScoreCodec.merge(readScoreTable(),incomingScores);
      const ratings=incomingRatings?RatingCodec.merge(readRatingLedger(),incomingRatings):null;
      if(ratings)localStorage.setItem(RATING_KEY,RatingCodec.encode(ratings.events));
      localStorage.setItem(SCORES_KEY,ScoreCodec.encode(merged.entries));
      scoreImportNotice=merged.conflicts||ratings?.conflicts.length?'Records merged. Where they disagreed, the results already on this device were kept.':'Records merged with your existing games and scores.';
      incomingScores=null;incomingRatings=null;scoresOpen=true;hubOpen=false;history.replaceState(null,'',location.pathname+location.search);render();
    }catch(error){backupError='Could not save the score table. Your existing records were kept.';console.error(error);render();}
    return;
  }
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
    if(!/^#(?:turn|backup|scores)=/.test(hash)){backupError='Paste a Regicidious turn, game backup, or score link.';render();return;}
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
  if(action==='delete-game'){
    if(deleteCandidate!==button.dataset.id){
      deleteCandidate=button.dataset.id;
      clearTimeout(deleteTimer);
      deleteTimer=setTimeout(()=>{deleteCandidate=null;if(hubOpen||sheetOpen)render();},5000);
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
      deleteCandidate=null;sheetOpen=false;hubOpen=true;completedOpen=false;backupText='';backupForSlot=null;
      hubNotice='Game removed from this device. A saved backup link can restore it.';
      render();
    }catch(error){storageError='Could not delete this game. Its remaining data was not cleared.';console.error(error);render();}
    return;
  }
  if(action==='backup' && game) {
    prepareBackupFor(game,slotId).catch(error=>{backupError='Could not prepare a backup link.';console.error(error);render();});return;
  }
  if(action==='toggle-sheet') { sheetOpen=!sheetOpen;render();return; }
  if(action==='reserve') { reserveOpen=!reserveOpen;render();return; }
  if(action==='opponent') {
    const owner=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.turn;
    if(index!==owner&&living().includes(index)){selectedOpponent=index;render();}
    return;
  }
  if(action==='games') { stopMatchReplay();closeTutorial();scoresOpen=false;incomingRequest++;lastIncomingLocationHash='';incomingBackup=null;incomingScores=null;incomingRatings=null;incomingKind=null;incomingSeat=null;linkLoading=false;backupError='';history.replaceState(null,'',location.pathname+location.search);hubOpen=true;completedOpen=false;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='completed-games') { stopMatchReplay();hubOpen=true;completedOpen=true;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='new-game' || action==='new-after-win') { stopMatchReplay();closeTutorial();scoresOpen=false;clearLinkError();game=null;slotId=null;hubOpen=false;completedOpen=false;setupOpen=true;sheetOpen=false;reserveOpen=false;backupText='';render();return; }
  if(action==='replay-game') {
    try {
      const id=button.dataset.id||slotId;
      const saved=id&&id===slotId&&game?game:readSlot(id);
      if(!saved||!canReplay(saved))throw Error('No replay');
      game=saved;slotId=id;hubOpen=false;scoresOpen=false;completedOpen=false;sheetOpen=false;reserveOpen=false;backupText='';
      localStorage.setItem(ACTIVE_KEY,slotId);storageError='';clearLinkError();
      if(!startMatchReplay(saved))throw Error('No frames');
    } catch(error) { storageError='This finished game cannot be replayed.';render();console.error(error); }
    return;
  }
  if(action==='open-game') {
    try { const chosen=readSlot(button.dataset.id);if(!chosen)throw Error('Missing match');game=chosen;slotId=button.dataset.id;hubOpen=false;scoresOpen=false;completedOpen=false;sheetOpen=false;reserveOpen=false;backupText='';localStorage.setItem(ACTIVE_KEY,slotId);storageError='';clearLinkError();render(); }
    catch(error) { storageError='This game could not be opened. Its saved data was not changed.';render();console.error(error); }
    return;
  }
  if(action==='restore-backup' && incomingBackup) {
    const restored=incomingBackup,kind=incomingKind,seat=incomingSeat;
    const existing=restored.mode==='text'?gameSlots().find(s=>s.game.matchId===restored.matchId):null;
    const knownSeat=restored.mode==='text'?recallSeat(restored.matchId):null;
    if(restored.mode==='text'){
      const victoryView=kind==='turn'&&restored.phase==='victory';
      if(kind==='turn'&&knownSeat==null&&!victoryView){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This browser has no seat in that match. Open your own invite first, or paste the turn link into the Home Screen app where you joined.';
        hubOpen=true;render();return;
      }
      if(kind==='backup'&&(seat==null||knownSeat!=null&&Number(knownSeat)!==seat)){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This link belongs to a different seat in a match already known on this device.';
        hubOpen=true;render();return;
      }
    }
    if(existing){
      const same=StateCodec.encode({...existing.game,restoreNotices:[]},{history:false})===StateCodec.encode({...restored,restoreNotices:[]},{history:false});
      const setupForward=restored.turnNumber===1&&existing.game.turnNumber===1&&
        (existing.game.phase==='invite'&&(restored.phase==='setup'||restored.phase==='arrange')||
        existing.game.phase==='setup'&&(restored.phase==='setup'&&restored.setup>existing.game.setup||restored.phase==='arrange'&&restored.turn===0));
      if(restored.turnNumber<existing.game.turnNumber||restored.turnNumber===existing.game.turnNumber&&!same&&!setupForward){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This link is older than your saved match or conflicts with it. Your saved game was kept.';
        history.replaceState(null,'',location.pathname+location.search);hubOpen=true;render();return;
      }
    }
    if(commit(()=>{
      const keep=(!restored.history?.origin && existing?.game.history?.origin)?existing.game.history:null;
      const localNotices=kind==='turn'?existing?.game.restoreNotices?.filter(n=>n.seat===Number(recallSeat(restored.matchId)))||[]:[];
      game=restored;slotId=existing?.id??makeSlotId();backupText='';hubOpen=false;scoresOpen=false;
      if(localNotices.length)game.restoreNotices=[...game.restoreNotices.filter(n=>n.seat!==localNotices[0].seat),...localNotices];
      if(restored.mode==='text'&&kind==='backup'&&seat!=null&&knownSeat!=null&&Number(knownSeat)===seat&&restored.turnNumber>1&&restored.phase!=='victory'){
        game.restoreNotices=[...game.restoreNotices.filter(n=>n.seat!==seat),{seat,kind:'backup',turnNumber:restored.turnNumber}];
      }
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
  if (action==='difficulty') { if(['serf','squire','knight'].includes(button.dataset.value))draft.difficulty=button.dataset.value; render(); return; }
  if (action==='mode') { draft.mode=button.dataset.value; render(); return; }
  if (action==='layout') { draft.layout=button.dataset.value==='classic'?'classic':'expanded'; render(); return; }
  if (action==='start') { rememberPlayerName(draft.names[0]);rememberPlayerEmoji(draft.emojis[0]);clearLinkError(); return commit(newGame); }
  if (action==='declare-war'&&game?.mode==='text'&&game.phase==='invite'&&textAccess()===0) return commit(()=>{game.phase='setup';game.view=0;});
  if(action==='claim-identity'&&needsFirstIdentity()){
    const seat=game.setup;
    const name=(app.querySelector('[data-claim-name]')?.value??player(seat).name).trim().slice(0,24)||`Player ${seat+1}`;
    const proposed=app.querySelector('[data-claim-emoji]')?.value??player(seat).emoji;
    const emoji=EMOJIS.includes(proposed)?proposed:player(seat).emoji;
    if(commit(()=>{player(seat).name=name;player(seat).emoji=emoji;game.view=seat;})){
      try{localStorage.setItem(identityKey(game.matchId,seat),'1');}catch{}
      rememberPlayerName(name);rememberPlayerEmoji(emoji);draft.names[0]=name;draft.emojis[0]=emoji;render();
    }
    return;
  }
  if(needsFirstIdentity())return;
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
      recordFormation(game.setup);
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
      if (game.phase==='buy'||game.phase==='arrange') {recordFormation(game.turn);game.phase='attack';}
      clearBuyPrompt();
      game.selection=null; game.message=''; return;
    }
    if (action==='attacker' && game.phase==='attack') {
      clearRetreat();
      const row=button.dataset.location,id=player(game.turn)[row]?.[index];
      if (id && id!==game.usedAttacker && (row==='front' || row==='back' && rank(id)==='10')) game.selection=game.selection?.location===row&&game.selection.index===index?null:{location:row,index};
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
const gameHash=/^#game=([a-f0-9]{16})$/.exec(location.hash);
if(gameHash){
  let chosen=null;
  try{chosen=readSlot(gameHash[1]);}catch(error){console.error(error);}
  if(chosen){if(tutorialOpen)closeTutorial();game=chosen;slotId=gameHash[1];hubOpen=false;try{localStorage.setItem(ACTIVE_KEY,slotId);}catch{}}
  else{hubNotice='That game is no longer on this device. A saved backup link can restore it.';hubOpen=true;history.replaceState(null,'',location.pathname+location.search);}
} else if(location.hash.startsWith('#game=')){
  hubNotice='That game is no longer on this device. A saved backup link can restore it.';hubOpen=true;history.replaceState(null,'',location.pathname+location.search);
} else if(!/^#(?:turn|backup|scores)=/.test(location.hash) && gameSlots().length&&!tutorialOpen)hubOpen=true;
render();
let incomingRequest=0;
let lastIncomingLocationHash='';
async function openIncomingHash(hash){
  const request=++incomingRequest;
  computerPlayback=null;clearTimeout(replayTimer);stopMatchReplay();
  linkLoading=true;backupError='';incomingBackup=null;incomingScores=null;incomingRatings=null;incomingKind=null;incomingSeat=null;render();
  try {
    const kind=hash.startsWith('#turn=')?'turn':hash.startsWith('#scores=')?'scores':'backup';
    const token=hash.slice(kind==='turn'?6:kind==='scores'?8:8);
    let decoded=token.startsWith('E1.')?await LinkCodec.open(token):token;
    if(request!==incomingRequest)return;
    if(kind==='scores'){
      const parts=decoded.split(';');
      if(parts.length>2||!parts[0]?.startsWith('S1.')||parts.length===2&&!parts[1]?.startsWith('R1.'))throw Error('Invalid records backup');
      incomingScores=ScoreCodec.decode(parts[0]);incomingRatings=parts.length===2?RatingCodec.decode(parts[1]):null;
      linkLoading=false;render();return;
    }
    if(kind==='backup'&&decoded.startsWith('P1:')){
      const match=/^P1:([0-3]):(B1\..+)$/.exec(decoded);
      if(!match)throw Error('Invalid seat backup');
      incomingSeat=Number(match[1]);decoded=match[2];
    }
    const saved=validateState(StateCodec.decode(decoded));
    if(kind==='turn'&&saved.mode!=='text')throw Error('Not a text match');
    if(incomingSeat!=null&&(saved.mode!=='text'||incomingSeat>=saved.players.length))throw Error('Invalid seat backup');
    incomingBackup=saved;incomingKind=kind;
  } catch(error) { if(request!==incomingRequest)return;backupError='This game link is damaged, stale, or cannot be opened.';console.error(error); }
  if(request!==incomingRequest)return;
  linkLoading=false;render();
}
function readIncomingLocation(){
  const hash=location.hash;
  if(!/^#(?:turn|backup|scores)=/.test(hash)){lastIncomingLocationHash='';return;}
  if(hash===lastIncomingLocationHash&&(linkLoading||incomingBackup||incomingScores||backupError))return;
  lastIncomingLocationHash=hash;
  openIncomingHash(hash);
}
window.addEventListener('hashchange',readIncomingLocation);
window.addEventListener('pageshow',readIncomingLocation);
if(linkLoading)readIncomingLocation();
