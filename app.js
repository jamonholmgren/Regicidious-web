/* Regicidious — framework-free, offline-first card game. */
const KEY = 'regicidious.game.v1';
const SLOT_PREFIX = 'regicidious.match.';
const META_PREFIX = 'regicidious.meta.';
const ACCESS_PREFIX = 'regicidious.access.';
const DELETED_PREFIX = 'regicidious.deleted.';
const ACTIVE_KEY = 'regicidious.active';
const PLAYER_NAME_KEY = 'regicidious.player-name';
const PLAYER_EMOJI_KEY = 'regicidious.player-emoji';
const LAYOUT_KEY = 'regicidious.layout';
const SCORES_KEY = 'regicidious.scores.v1';
const RATING_KEY = 'regicidious.ratings.v1';
const LEADERBOARD_KEY = 'regicidious.leaderboard.v1';
const MIGRATED_KEY = 'regicidious.legacy-imported';
const SUITS = ['♠', '♥', '♣', '♦'];
const NAMES = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
const BANNER_NAMES = ['Aldric','Ansel','Baldwin','Cedric','Edric','Godric','Hawthorne','Leofric','Merrick','Osric','Percival','Rowan','Theobald','Ulric'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const EMOJIS = StateCodec.emojis;
const PERSONA_NAMES={serf:'Serf',squire:'Squire',captain:'Captain',warlord:'Warlord',knight:'Knight'};
const app = document.querySelector('#app');
let game = null;
let slotId=null,hubOpen=false;
let storageError = '';
const defaultBannerName=BANNER_NAMES[Math.floor(Math.random()*BANNER_NAMES.length)];
let preferredLayout='classic';
let draft = { mode:'solo',count:2, layout:preferredLayout,difficulty:'squire', names: [defaultBannerName,'Crimson Court','Iron Court','Ember Court'],emojis:EMOJIS.slice(0,4) };
try {
  const rememberedLayout=localStorage.getItem(LAYOUT_KEY);
  if(['classic','expanded'].includes(rememberedLayout)){preferredLayout=rememberedLayout;draft.layout=rememberedLayout;}
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
function rememberLayout(layout){
  preferredLayout=layout==='expanded'?'expanded':'classic';draft.layout=preferredLayout;scoreLayout=preferredLayout;
  try { localStorage.setItem(LAYOUT_KEY,preferredLayout); } catch { /* The board can still be chosen without preference storage. */ }
}
let timings = {logic:null,save:null,render:null};
let backupText='',incomingBackup=null,incomingKind=null,incomingSeat=null,backupError='',linkLoading=false,dispatchNotice=null;
let selectedOpponent=null,sheetOpen=false,reserveOpen=false;
let computerRecording=null,computerPlayback=null,replayTimer=null;
let historyLock=false,matchReplay=null,matchReplayTimer=null,matchHoldTimer=null;
let backupForSlot=null,deleteCandidate=null,hubNotice='';
let turnLink='',turnLinkSource='',turnLinkBusy=false,turnLinkError='';
let pasteOpen=false;
let inviteLinks={};
let setupOpen=false,installDismissed=false,deleteTimer=null,buyPrompt=null,buyPromptTimer=null,completedOpen=false;
let scoresOpen=false,scoreLayout=preferredLayout,scoreLink='',scoreLinkSource='',scoreLinkBusy=false,scoreLinkError='',incomingScores=null,incomingRatings=null,scoreImportNotice='';
let ratingError='',ratingReconciled=false;
let tutorialOpen=false,tutorialStep=0,tutorialRolling=false,tutorialDice=null,tutorialTimer=null;
const SEAT_COOKIE='rgseat_';
const IDENTITY_PREFIX='regicidious.identity.';
try { installDismissed=localStorage.getItem('regicidious.install-tip.dismissed')==='1'; } catch { /* Storage warning appears elsewhere. */ }
try { tutorialOpen=localStorage.getItem('regicidious.tutorial.open')==='1';tutorialStep=Math.min(8,Math.max(0,Number(localStorage.getItem('regicidious.tutorial.step'))||0)); } catch { /* The lesson can restart if preferences are unavailable. */ }
const milliseconds=n=>`${n.toFixed(2)} ms`;
const timingLine=()=>timings.render===null?'':`Last move: logic ${milliseconds(timings.logic)} · save ${milliseconds(timings.save)} · render ${milliseconds(timings.render)}`;
const creditLine='Original game by Shane Holmgren<br>Digital adaptation by Jamon Holmgren, <a href="https://jammin.games/" target="_blank" rel="noopener noreferrer">Jammin Games</a>';
const BUILD=57;
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
function knownSeat(saved) {
  if(saved.mode!=='text')return 0;
  const stored=Number(recallSeat(saved.matchId)??-1);
  if(stored>=0&&stored<saved.players.length)return stored;
  for(let seat=0;seat<saved.players.length;seat++){
    if(localStorage.getItem(identityKey(saved.matchId,seat))==='1')return seat;
  }
  return -1;
}
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
  // Turn links ride in a single text message: no replay history, no text log.
  return StateCodec.encode({...state,log:[]},{history:false});
}
function captureOrigin(state) {
  return {
    turn:state.turn,round:state.round,phase:state.phase,setup:state.setup,view:state.view,
    actions:state.actions,kills:state.kills,turnNumber:state.turnNumber||1,first:state.first??0,
    // The replay origin is always the opening deployment, before any card can
    // enter a graveyard. Keeping it lean also preserves compact replay links.
    players:state.players.map(p=>({front:[...p.front],back:[...p.back],reserve:[...p.reserve],deck:[...p.deck],coins:p.coins,alive:p.alive,cpu:p.cpu,persona:p.persona||null,miner:p.miner||null}))
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
  saved.actions??=saved.attacks;
  if(!validIndex(saved.turn,count)||!validIndex(saved.setup,count)||!Number.isInteger(saved.round)||saved.round<1||saved.round>1000000)bad();
  if(!['invite','setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'].includes(saved.phase)||saved.view!=null&&!validIndex(saved.view,count))bad();
  if(saved.phase==='invite'&&(saved.mode!=='text'||saved.turn!==0||saved.setup!==0||saved.actions!==0))bad();
  if(!Number.isInteger(saved.actions)||saved.actions>3||saved.actions<0||!Number.isInteger(saved.kills)||saved.kills<0||saved.kills>3)bad();
  saved.usedAttacker??=saved.pending?.attackCard||saved.currentBattles?.at(-1)?.attackCard||null;
  if(saved.usedAttacker!=null&&!validCard(saved.usedAttacker,saved.turn))bad();
  saved.usedAttackers??=saved.usedAttacker?[saved.usedAttacker]:[];
  if(!Array.isArray(saved.usedAttackers)||saved.usedAttackers.length>3||new Set(saved.usedAttackers).size!==saved.usedAttackers.length||saved.usedAttackers.some(id=>!validCard(id,saved.turn)))bad();
  saved.scout??=null;
  if(saved.scout!=null&&(!validIndex(saved.scout.player,count)||saved.scout.player===saved.turn||!['front','back'].includes(saved.scout.row)||!validIndex(saved.scout.index,saved.layout==='expanded'?4:3)||!validCard(saved.scout.id,saved.scout.player)))bad();
  saved.memory??=[];
  if(!Array.isArray(saved.memory)||saved.memory.length>24||saved.memory.some(m=>!validIndex(m.player,count)||!['front','back'].includes(m.row)||!validIndex(m.index,cols)||!validCard(m.id,m.player)||!Number.isInteger(m.round)||m.round<1))bad();
  saved.refillUndo??=[];
  if(!Array.isArray(saved.refill)||saved.refill.length>count||new Set(saved.refill).size!==saved.refill.length||saved.refill.some(i=>!validIndex(i,count)))bad();
  if(!Array.isArray(saved.refillUndo)||saved.refillUndo.length>3||saved.refillUndo.some(m=>!validIndex(m.owner,count)||!validIndex(m.from,cols)||!validIndex(m.to,cols)||!validCard(m.card,m.owner)))bad();
  if(!Number.isInteger(saved.refillIndex)||saved.refillIndex<0||saved.refillIndex>saved.refill.length||saved.phase==='refill'&&saved.refillIndex>=saved.refill.length)bad();
  if(typeof saved.message!=='string'||saved.message.length>2048||!Array.isArray(saved.log)||saved.log.length>1000||saved.log.some(s=>typeof s!=='string'||s.length>2048))bad();
  saved.matchId??='';saved.turnNumber??=1;saved.first??=0;saved.currentBattles??=[];saved.lastBattles??=[];saved.history??=null;saved.startedAt??=0;
  if(!validIndex(saved.first,count))bad();
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
    if(!Array.isArray(events)||events.length>3)bad();
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
    if(p.persona!=null&&!['serf','squire','captain','warlord','knight'].includes(p.persona))bad();
    if(p?.suit!==i||typeof p.name!=='string'||p.name.length>128||typeof p.alive!=='boolean'||typeof p.cpu!=='boolean'||!Number.isInteger(p.coins)||p.coins<0||p.coins>10000)bad();
    if(!Array.isArray(p.front)||p.front.length!==cols||!Array.isArray(p.back)||p.back.length!==cols||!Array.isArray(p.reserve)||!Array.isArray(p.deck))bad();
    p.graveyard??=[];p.hades??=[];
    if(!Array.isArray(p.graveyard)||!Array.isArray(p.hades))bad();
    const cards=[...p.front,...p.back,...p.reserve,...p.deck,...p.graveyard,...p.hades].filter(id=>id!=null);
    if(cards.length>13||new Set(cards).size!==cards.length||cards.some(id=>!validCard(id,i)))bad();
    // Mining was retired in the current ruleset. Old links may carry a miner
    // marker, but it has no ongoing effect.
    p.miner=null;
    if(p.alive&&['attack','battle','queen','income','victory','stalemate'].includes(saved.phase)&&!covered(p))bad();
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
      if((e.t==='buy'||e.t==='hire')&&!validCard(e.card,saved.turn)&&!(typeof e.card==='string'&&/^[0-3]-(?:A|[2-9]|10|J|Q|K)$/.test(e.card)))bad();
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
function isGenuineDraw(e){return e.result==='tie'&&Math.max(...e.attackDice)===Math.max(...e.defendDice);}
function battleSentence(saved,e) {
  const actor=saved.players[e.actor].name,defender=saved.players[e.defender].name;
  if(e.result==='tie')return isGenuineDraw(e)?`${actor}’s ${cardTitle(e.attackCard)} and ${defender}’s ${cardTitle(e.defendCard)} fell together in a bloody draw.`:`${actor}’s ${cardTitle(e.attackCard)} slipped away from ${defender}’s ${cardTitle(e.defendCard)}.`;
  if(e.sacrifice){const owner=e.result==='attack'?e.defender:e.actor;const board=e.result==='attack'?e.beforeDefender:e.beforeActor;const fl=board.length>>1;const id=board[(e.sacrifice.row==='back'?fl:0)+e.sacrifice.index];return royalSacrificeSentence(saved.players[owner].name,e.result==='attack'?e.defendCard:e.attackCard,id);}
  if(e.result==='defend')return `${defender}’s ${cardTitle(e.defendCard)} held the line and felled ${actor}’s ${cardTitle(e.attackCard)}.`;
  return `${actor}’s ${cardTitle(e.attackCard)} cut down ${defender}’s ${cardTitle(e.defendCard)}.`;
}
function lastBattleSentence(saved) {
  const events=saved.lastBattles||[];
  if(!events.length)return 'The last watch passed without steel drawn.';
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
  if(saved.phase==='victory')return `News from the battlefront, m’lords! A crown has changed hands in Regicidious. Open this royal dispatch to learn whose banner still flies. ${url}`;
  if(saved.phase==='setup')return `${saved.players[saved.turn].name}, the enemy is at the gates! Set your battle lines in Regicidious. ${url}`;
  return `${lastBattleSentence(saved)} ${saved.players[saved.turn].name}, it’s your turn #${saved.turnNumber}. To arms! ${url}`;
}
const TURN_TOKEN_LIMIT=1500,TURN_MESSAGE_LIMIT=2000;
function ensureTurnLink() {
  if(!game||game.mode!=='text')return;
  const source=encodeForTurn(game);
  if(source===turnLinkSource&&(turnLink||turnLinkBusy))return;
  turnLinkSource=source;turnLink='';turnLinkBusy=true;turnLinkError='';
  LinkCodec.seal(source).then(token=>{
    if(turnLinkSource!==source)return;
    turnLinkBusy=false;
    if(token.length>TURN_TOKEN_LIMIT){turnLinkError='Turn link is unusually large; send a backup link instead.';render();return;}
    turnLink=location.href.split('#')[0]+'#turn='+token;render();
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
function ownRatings(){
  try { const ratings=RatingCodec.standings(readRatingLedger()).ratings;return {humanElo:Math.round(ratings.human),computerElo:Math.round(ratings.computer)}; }
  catch { return {humanElo:1000,computerElo:1000}; }
}
function leaderboardKey(p){return `${String(p.name||'').trim().toLowerCase()}|${p.emoji||''}`;}
function readLeaderboard(){
  try {
    const list=JSON.parse(localStorage.getItem(LEADERBOARD_KEY)||'[]');
    return Array.isArray(list)?list.filter(e=>e&&typeof e.name==='string'&&typeof e.emoji==='string'&&Number.isFinite(e.humanElo)&&Number.isFinite(e.computerElo)).slice(0,200):[];
  } catch { return []; }
}
function updateLeaderboard(saved){
  if(!saved?.players)return;
  const byKey=new Map(readLeaderboard().map(e=>[leaderboardKey(e),e]));
  for(const p of saved.players)if(!p.cpu){
    const key=leaderboardKey(p);if(!key)continue;
    byKey.set(key,{name:p.name.slice(0,24),emoji:p.emoji||'♛',humanElo:Math.round(p.humanElo??1000),computerElo:Math.round(p.computerElo??1000),updated:Date.now()});
  }
  try { localStorage.setItem(LEADERBOARD_KEY,JSON.stringify([...byKey.values()].sort((a,b)=>b.updated-a.updated).slice(0,200))); } catch { /* Auxiliary data must not block a match. */ }
}
function applyOwnRatings(saved,seat=saved?.mode==='text'?recallSeat(saved.matchId):0){
  if(!saved?.players?.[seat]||saved.players[seat].cpu)return;
  Object.assign(saved.players[seat],ownRatings());
}
function leaderboardPanel(){
  const entries=readLeaderboard();
  const rows=(key,label)=>[...entries].sort((a,b)=>b[key]-a[key]||a.name.localeCompare(b.name)).slice(0,20).map((p,i)=>`<div><strong>${i+1}. ${escapeHTML(p.emoji)} ${escapeHTML(p.name)}</strong><span>${Math.round(p[key]).toLocaleString()}</span></div>`).join('')||'<p class="muted small">Open a game update to begin your local roll of the realm.</p>';
  return `<section class="panel rating-panel"><div class="phase">Local campaign leaderboard</div><h2>Human Elo</h2><div class="rating-opponents">${rows('humanElo','Human')}</div><h2 style="margin-top:20px">Computer Elo</h2><div class="rating-opponents">${rows('computerElo','Computer')}</div><p class="muted small">Players from every game update you open appear here. It is shared by links among your group, not a public server leaderboard.</p></section>`;
}
function recordRating(saved){
  const seat=saved.mode==='text'?recallSeat(saved.matchId):0;
  const event=RatingCodec.fromGame(saved,seat);
  if(!event)return;
  const prior=readRatingLedger(),merged=RatingCodec.merge(prior,[event]);
  const encoded=RatingCodec.encode(merged.events);
  if(localStorage.getItem(RATING_KEY)!==encoded)localStorage.setItem(RATING_KEY,encoded);
  applyOwnRatings(saved,seat);
}
function reconcileRatings(){
  if(ratingReconciled)return;
  const prior=readRatingLedger();
  const recovered=gameSlots().map(slot=>RatingCodec.fromGame(slot.game,slot.game.mode==='text'?recallSeat(slot.game.matchId):0)).filter(Boolean);
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
  const seat=knownSeat(saved);
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
    if(game.phase==='victory'&&!game.finishedAt)game.finishedAt=Math.floor(Date.now()/1000)*1000;
    if(game.phase==='victory')recordRating(game);
    updateLeaderboard(game);
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
  buyPrompt=null;clearTimeout(buyPromptTimer);setupOpen=false;turnAdjusted=false;minePick=false;
  slotId=makeSlotId();
  const count = draft.count, layout=draft.layout==='classic'?'classic':'expanded', own=ownRatings(), known=new Map(readLeaderboard().map(e=>[leaderboardKey(e),e]));
  const players = Array.from({length:count}, (_,i) => {
    const pool = shuffle(RANKS.filter(r => !['J','Q','K'].includes(r)).map(r => `${i}-${r}`));
    if(layout==='classic'){
      const six = [`${i}-K`,`${i}-Q`,`${i}-J`,...pool.splice(0,3)];
      pool.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b)));
      const identity={name:draft.names[i].trim() || `Player ${i+1}`,emoji:draft.emojis[i]},profile=i===0?own:known.get(leaderboardKey(identity))||{humanElo:1000,computerElo:1000};
      const p={ ...identity,humanElo:profile.humanElo,computerElo:profile.computerElo,suit:i, cpu:draft.mode==='solo' && i!==0, persona:draft.mode==='solo'&&i!==0?draft.difficulty:null, front:[six[1],six[2],six[3]], back:[six[0],six[4],six[5]], reserve:[], deck:pool, graveyard:[], hades:[], coins:0, alive:true, miner:null };
      if (p.cpu) arrangeAI(p);
      return p;
    }
    const seven = [`${i}-K`,`${i}-Q`,`${i}-J`,...pool.splice(0,4)];
    pool.sort((a,b)=>RANKS.indexOf(rank(a))-RANKS.indexOf(rank(b)));
    const identity={name:draft.names[i].trim() || `Player ${i+1}`,emoji:draft.emojis[i]},profile=i===0?own:known.get(leaderboardKey(identity))||{humanElo:1000,computerElo:1000};
    const p={ ...identity,humanElo:profile.humanElo,computerElo:profile.computerElo,suit:i, cpu:draft.mode==='solo' && i!==0, persona:draft.mode==='solo'&&i!==0?draft.difficulty:null, front:[seven[1],seven[2],seven[3],seven[4]], back:[seven[0],seven[5],seven[6],null], reserve:[], deck:pool, graveyard:[], hades:[], coins:0, alive:true, miner:null };
    if (p.cpu) arrangeAI(p);
    return p;
  });
  game = {version:1,layout,queenRule:'cedric',mode:draft.mode,players,turn:0,round:1,phase:'setup',setup:0,view:draft.mode==='text'?0:null,selection:null,actions:0,usedAttacker:null,usedAttackers:[],scout:null,memory:[],kills:0,pending:null,refill:[],refillIndex:0,refillUndo:[],matchId:makeMatchId(),turnNumber:1,first:random(count),currentBattles:[],lastBattles:[],message:'',log:[],history:null,startedAt:Math.floor(Date.now()/1000)*1000,restoreNotices:[],finishedAt:0,scoreVersion:draft.mode==='solo'&&count===2?1:0};
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
  const first=game.first??0,n=game.players.length,rel=i=>(i-first+n)%n;
  if (rel(next) <= rel(game.turn)) game.round++;
  if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
  game.turn = next;
  const nextPlayer=player(next);
  game.phase = 'attack'; game.view = game.mode==='text'?next:null; game.selection = null; minePick=false;
  game.actions = 0; game.usedAttacker=null; game.usedAttackers=[]; game.scout=null; game.kills = 0; game.pending = null; turnAdjusted=false;
  if(game.memory){game.memory=game.memory.filter(m=>game.round-m.round<3);pruneMemory();}
  game.message = player(next).cpu?`${player(next).name} is thinking…`:'';
}
function actionLimit(){return game.round===2&&game.players.length===2&&game.turn===(game.first??0)?2:3;}
function cardHTML(id, action, location, index, opts={}) {
  const selected = game?.selection && game.selection.location === location && game.selection.index === index;
  const attrs = `data-slot="${location}:${index}" ${action ? `data-action="${action}" data-location="${location}" data-index="${index}"` : 'disabled'}`;
  const place=opts.owner!=null?`${player(opts.owner).name}, ${opts.row} slot ${index+1}, `:'';
  const queenLink=opts.className?.includes('queen-linked')?' style="border-color:#e9be74;outline:1px solid #f6d899;outline-offset:1px;box-shadow:0 4px 0 #10251e,0 0 12px #e9be7470"':opts.className?.includes('queen-attendant')?' style="border-color:#e9be74;box-shadow:0 4px 0 #10251e,0 0 9px #e9be7455"':'';
  const levyText=opts.buyVerb?`${opts.buyVerb.toLowerCase()} for ${opts.buyCost} coins`:'hire for two coins';
  if (!id) return `<button class="card empty ${opts.buyConfirm?'buy-armed':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}${opts.buyConfirm?`tap again to ${levyText}`:'empty slot'}">${opts.buyConfirm?`${opts.buyCost||HIRE_COST} ◉`:'+'}</button>`;
  if (opts.hidden) return `<button class="card back ${opts.target?'target':''} ${opts.className||''}" ${attrs} aria-label="${escapeHTML(place)}face-down card"><span class="center">♛</span></button>`;
  const r=rank(id),role={A:'ASSASSIN','10':'KNIGHT',J:'JACK',Q:'QUEEN',K:'KING'}[r]||'';
  const mining=opts.className?.includes('mining');
  return `<button class="card ${['♥','♦'].includes(suit(id))?'red':''} ${selected?'selected':''} ${opts.className||''}"${queenLink} ${attrs} aria-label="${escapeHTML(place)}${label(id)}${role?`, ${role.toLowerCase()}`:''}${mining?', mining':''}" aria-pressed="${Boolean(selected)}"><span class="rank">${r}<small>${suit(id)}</small></span><span class="center">${suit(id)}</span>${role?`<span class="card-role">${role}</span>`:''}${mining?'<span class="mine-badge">⛏</span>':''}<span class="rank foot">${r}<small>${suit(id)}</small></span></button>`;
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
  const ladder=!inMatch?ratingStandings():null;
  const eloPill=ladder?`<button class="pill" data-action="scores-open" title="Your computer and human Elo">CPU ${Math.round(ladder.ratings.computer).toLocaleString()} · Human ${Math.round(ladder.ratings.human).toLocaleString()}</button>`:'';
  const gamesPill=`<button class="pill${hubOpen?' selected-pill':''}" data-action="games">Games</button>`;
  const topAction=inMatch?matchReplay||computerPlayback?'':`<button class="pill" data-action="toggle-sheet" aria-label="Match details">Details</button>${gamesPill}`:`${eloPill}${gamesPill}`;
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
  const ownSeat=knownSeat(g);
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
  const elo=ladder?`<section class="panel rating-panel"><div class="phase">Personal Elo</div><h2>Computer · ${Math.round(ladder.ratings.computer).toLocaleString()}</h2><p class="muted small">${ladder.records.computer.wins} wins · ${ladder.records.computer.losses} losses</p><div class="rating-opponents">${Object.entries(PERSONA_NAMES).map(([id,name])=>`<div><strong>${name}</strong><span>${Math.round(ladder.ratings[id]).toLocaleString()} · ${ladder.records[id].wins}W ${ladder.records[id].losses}L</span></div>`).join('')}</div><h2 style="margin-top:20px">Human · ${Math.round(ladder.ratings.human).toLocaleString()}</h2><p class="muted small">${ladder.records.human.wins} wins · ${ladder.records.human.losses} losses in 1v1 human matches. Each ladder transfers rating within its own pool, so repeated wins earn less.</p></section>`:'';
  ensureScoreLink();
  const slots=new Map(gameSlots().filter(s=>s.game.phase==='victory').map(s=>[s.game.matchId,s]));
  const rows=entries.filter(e=>e.layout===scoreLayout).map((e,i)=>{
    const saved=slots.get(e.id),replay=saved&&canReplay(saved.game);
    return `<section class="panel score-row"><div class="score-top"><strong>#${i+1} · ${e.score.toLocaleString()} points</strong><span>${scoreDate(e.date)}</span></div><p>${e.emoji} ${escapeHTML(e.name)} · ${PERSONA_NAMES[e.difficulty]} · ${e.turns} ${e.turns===1?'turn':'turns'}</p><p class="muted small">Match ${e.id.slice(0,8)}</p><div class="actions">${replay?`<button class="button secondary" data-action="replay-game" data-id="${saved.id}">Replay</button>`:`<span class="muted small">Replay unavailable${saved?'':' · restore the game backup'}</span>`}${saved?`<button class="button ghost" data-action="backup-slot" data-id="${saved.id}">Make game backup</button>`:''}</div>${saved&&backupForSlot===saved.id&&backupText?`<textarea readonly rows="3">${escapeHTML(backupText)}</textarea><button class="button secondary" data-action="copy-backup">Copy game link</button>`:''}</section>`;
  }).join('');
  frame(`<section class="score-heading"><div class="phase">Personal records · solo 1v1</div><h1>High scores</h1><p>Victory earns 1,000 points, plus up to 1,000 for speed. Each extra commander turn costs 50 speed points. Higher courts earn a larger multiplier.</p></section>${scoreImportNotice?`<p class="status">${escapeHTML(scoreImportNotice)}</p>`:''}<div class="score-tabs"><button class="button ${scoreLayout==='expanded'?'':'secondary'}" data-action="score-layout" data-value="expanded">Expanded</button><button class="button ${scoreLayout==='classic'?'':'secondary'}" data-action="score-layout" data-value="classic">Classic</button></div>${ratingError?`<p class="status">${escapeHTML(ratingError)}</p>`:''}${elo}${leaderboardPanel()}${rows||'<p class="muted">No solo 1v1 victories on this board yet.</p>'}<section class="panel"><h2>Keep your records</h2><p class="muted small">This link carries your scores and ratings, not the games themselves. Back up games separately if you want to replay them.</p>${scoreLinkError?`<p class="status">${escapeHTML(scoreLinkError)}</p>`:''}<div class="actions"><button class="button secondary" data-action="copy-scores" ${scoreLink?'':'disabled'}>Copy table link</button><button class="button secondary" data-action="share-scores" ${scoreLink?'':'disabled'}>Send table link</button></div><details><summary>Show score table link</summary><textarea readonly rows="3">${escapeHTML(scoreLink||'Preparing link…')}</textarea></details></section>${pastePanel()}`);
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
    'Meet Sir Strawhelm, master of the practice yard. This brief skirmish uses fated dice; no true match or score is touched.',
    'Your vanguard faces his. Your King waits behind the shield wall. Tap your Peasant (8) to sound the charge.',
    'A champion may strike an enemy in the vanguard. Tap Sir Strawhelm’s leftmost hidden card.',
    'It is a Peasant (4). Your 8 outranks the 4, so you cast two dice to Sir Strawhelm’s one. The highest single die carries the clash.',
    'Your highest die is 5; his is 4. His Peasant falls. The spent 2 is dimmed. In a true draw, both champions fall.',
    'A fallen foe yields one coin. Your Jack brings another at turn’s end: claim two. Each turn grants up to three actions: charge or adjust your lines; each charge needs a different champion.',
    'Before his turn, Sir Strawhelm moves his Knight (10) into the vanguard. Against your Peasant (8), a front-line Knight casts three dice. Watch the answering charge.',
    'His 6 bests your 3, and your Peasant falls. A steadfast defender may strike down an attacker. Your Queen and King still hold the realm.',
    'You have seen the muster, the charge, the dice, the spoils, and the defense. In a true match, prepare your lines before steel is drawn, spend two coins to levy a card, and keep your King alive.'
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
  const action=step===3||step===6?`<button class="button wide" data-action="tutorial-roll" ${tutorialRolling?'disabled':''}>${tutorialRolling?'The dice tumble…':'Cast the dice →'}</button>`:step===1||step===2?'':step===8?'<div class="actions"><button class="button" data-action="tutorial-finish">Begin a true war →</button><button class="button secondary" data-action="tutorial-restart">Drill again</button></div>':`<button class="button wide" data-action="tutorial-next">${step===5?'Claim 2 coins →':'Continue →'}</button>`;
  frame(`<section class="tutorial-page"><div class="phase">Training grounds · ${step}/8</div><h1>${headings[step]}</h1><p class="tutorial-guidance">${words[step]}</p><div class="tutorial-board"><div class="tutorial-side"><strong>🪵 Sir Strawhelm ♥</strong>${row(enemyBack,1,'back')}${row(enemyFront,1,'front')}</div>${diceHTML}<div class="tutorial-side"><strong>${draft.emojis[0]} ${escapeHTML(draft.names[0])} ♠ · ◉ ${step>=6?2:0}</strong>${row(ownFront,0,'front')}${row(ownBack,0,'back')}</div></div>${action}</section>`);
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
  const body=victory?'Open to witness the final clash and its reckoning. Your other saved games remain here.':invitation?'Claim your kingdom now. Your battle lines open when the host declares war and sends the next dispatch.':turn?'Open to replay the last clashes and continue if this is your seat. Your other saved games remain here.':'Restoring adds another saved game. Your current games remain untouched.';
  const go=victory?'View final clash':invitation?'Claim my seat':turn?'Open turn & replay':'Add backup';
  const progress=invitation?`${g.players.length} kingdoms gather`:g.phase==='setup'?`Battle lines · ${g.setup+1} of ${g.players.length}`:`Round ${g.round} · turn #${g.turnNumber}`;
  const notice=restoreNoticeText(g);
  frame(`<section class="panel dispatch"><div class="phase">${title}</div><h2>${headline}</h2><p class="muted">${progress}</p>${playerChips(g)}<p class="muted small">Started ${escapeHTML(started)}</p><p class="small">${body}</p>${notice?`<p class="status">${escapeHTML(notice)}</p>`:''}<div class="actions"><button class="button" data-action="restore-backup">${go}</button></div></section>`);
}
function renderTextWaiting() {
  ensureTurnLink();
  ensureInvites();
  const p=player(game.turn);
  const groupChat=game.players.length>2;
  const invites=textAccess()===0?`<section class="panel"><h2>Summon each kingdom</h2><p class="small muted">Send each ruler their sealed summons once. Opening it claims that seat on their device.${groupChat?' Then keep every turn in one group chat, where the whole war council can witness it.':''}</p>${game.players.map((q,i)=>i===0?'':`<p>${escapeHTML(q.name)} ${SUITS[i]}</p>${inviteLinks[i]?.url?`<div class="actions"><button class="button secondary" data-action="copy-invite" data-index="${i}">Copy summons</button><button class="button secondary" data-action="share-invite" data-index="${i}">Send summons…</button></div><textarea readonly rows="2">${escapeHTML(inviteLinks[i].url)}</textarea>`:'<p class="small muted">Sealing summons…</p>'}`).join('')}</section>`:'';
  const settingUp=game.phase==='setup';
  const summary=`<section class="waiting-summary"><div class="crown">${p.emoji}</div><div><div class="phase">${settingUp?`Battle lines · ${game.setup+1} of ${game.players.length}`:`Text multiplayer · turn #${game.turnNumber}`}</div><h1>${escapeHTML(p.name)}’s ${settingUp?'battle lines':'turn'}</h1><p>${groupChat?`Share the next dispatch in thy group chat. It is addressed to ${escapeHTML(p.name)}, and every ruler may carry it there.`:`Send the next dispatch to ${escapeHTML(p.name)}.`}</p>${playerChips(game)}<p class="muted small">Started ${escapeHTML(game.startedAt>0?dateText(game.startedAt):'unknown')}</p>${dispatchNotice?.matchId===game.matchId?`<p class="status small">${escapeHTML(dispatchNotice.text)}</p>`:''}</div></section>`;
  const actions=turnLink?`<div class="actions"><button class="button" data-action="share-turn">${groupChat?'Share turn to group chat':`Send text to ${escapeHTML(p.name)}`}</button><button class="button secondary" data-action="copy-turn">Copy dispatch</button></div><details class="share-detail"><summary>Show dispatch and link</summary><textarea readonly rows="5" aria-label="Dispatch and link">${escapeHTML(shareMessage(game,turnLink))}</textarea></details>`:'<p class="muted small">Preparing a private turn link…</p>';
  const dispatch=`<section class="panel waiting-panel"><h2>${settingUp?'Send the muster':'Send the dispatch'}</h2>${settingUp?'':`<p class="muted small">${escapeHTML(lastBattleSentence(game))}</p>`}${replayLastButton()}${turnLinkError?`<p class="status">${escapeHTML(turnLinkError)}</p>`:''}${actions}<p class="muted small">The dispatch carries the whole match and a key. Keep it within your war council; it deters casual peeking but cannot prevent cheating.</p></section>`;
  frame(`${summary}${dispatch}${invites}${pastePanel()}`);
}
function renderTextInvites() {
  if(textAccess()!==0){
    frame(`<section class="panel dispatch"><div class="phase">The call to arms</div><h1>Await the declaration</h1><p>${escapeHTML(player(0).name)} is gathering the kingdoms. Your invitation has been saved; your battle lines will open when the host sends the first turn.</p></section>`);
    return;
  }
  ensureInvites();
  const groupChat=game.players.length>2;
  const seats=game.players.slice(1).map((p,i)=>{
    const seat=i+1,link=inviteLinks[seat]?.url;
    return `<div class="invite-seat"><h3>${p.emoji} ${SUITS[seat]} ${escapeHTML(p.name)}</h3>${link?`<div class="actions"><button class="button secondary" data-action="copy-invite" data-index="${seat}">Copy invite</button><button class="button secondary" data-action="share-invite" data-index="${seat}">Share invite</button></div>`:'<p class="muted small">Preparing a private invitation…</p>'}</div>`;
  }).join('');
  frame(`<section class="panel dispatch"><div class="phase">Gather your kingdoms</div><h1>Send the royal invitations</h1><p>Each player needs their own named invite to claim a seat. Send these before declaring war.${groupChat?' Then make one group chat for the campaign—every future dispatch belongs there.':''}</p>${seats}<p class="flavor">The gauntlet has been thrown down.</p><button class="button wide" data-action="declare-war">Declare war!</button></section>`);
}
function renderStart() {
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone;
  const install=!standalone&&!installDismissed?`<section class="install-tip" aria-label="Install Regicidious"><div><strong>Add to Home Screen</strong><p>On iPhone, open in Safari, tap Share, then Add to Home Screen. For text games, paste a received link into the installed app if Messages opens Safari.</p></div><button class="tip-close" data-action="dismiss-install" aria-label="Dismiss install tip">×</button></section>`:'';
  frame(`<section class="launch"><div class="launch-crown">♛</div><h1>A battle in your pocket</h1><p>Raise your banner. Guard your king. Take the crown.</p><button class="button wide launch-start" data-action="setup-open">Start new game →</button><button class="button secondary wide" data-action="tutorial-open">Training grounds · tutorial</button><button class="button secondary wide" data-action="scores-open">Solo high scores</button>${gameSlots().length?'<button class="button secondary wide" data-action="games">Continue a saved game</button>':''}</section>${install}<details class="panel compact-rules"><summary>How to play</summary><p>Set your formation in round one, then take up to three actions each turn — attack or adjust your lines — using a different card for every attack. Fresh levies cost 2 coins; once the levy pile is empty, fallen champions may be resurrected for 3. Solo, pass the phone, or exchange turns by text link.</p></details>`);
}
function renderSetup() {
  const modes=[['solo','Solo vs computer'],['local','Pass the phone'],['text','Text-message multiplayer']];
  const layouts=[['expanded','Expanded · 4 across, 7 cards'],['classic','Classic · 3 across, 6 cards']];
  const difficulty=draft.mode==='solo'?`<div class="label">Enemy commander</div><div class="actions mode-actions">${[['serf','Serf · novice'],['squire','Squire · easy'],['captain','Captain · fair'],['warlord','Warlord · hard'],['knight','Knight · ruthless']].map(([id,title])=>`<button class="button ${draft.difficulty===id?'':'ghost'}" data-action="difficulty" data-value="${id}">${title}</button>`).join('')}</div><p class="small muted">Each court knows more of the battlefield than the last. The Knight commands the full playbook.</p>`:'';
  const identityInput=i=>`<div class="player-identity"><label class="field"><span>${i===0?'Your name · tap to change':`${NAMES[i]} · suggested name`}</span><input data-name="${i}" maxlength="24" value="${escapeHTML(draft.names[i])}" autocomplete="off"></label><label class="field emoji-field"><span>Emoji</span><select data-emoji="${i}" aria-label="${escapeHTML(draft.names[i])} emoji">${EMOJIS.map(emoji=>`<option value="${emoji}"${draft.emojis[i]===emoji?' selected':''}>${emoji}</option>`).join('')}</select></label></div>`;
  const otherInputs=draft.mode==='solo'?'':draft.names.slice(1,draft.count).map((_,i)=>identityInput(i+1)).join('');
  const textGuidance=draft.mode==='text'?`<p class="small muted">Each player receives a private invite next.${draft.count>2?' Then create a group chat for the campaign and share every turn there.':' Send each following dispatch directly to the other ruler.'} Links discourage casual peeking but are not cheat-proof.</p>`:'';
  frame(`<div class="setup-heading"><button class="button ghost" data-action="setup-back">‹ Back</button><h1>New game</h1></div><section class="panel setup-panel"><p class="flavor">M’lord, our enemies are at the gates. We must prepare for war!</p><div class="label">Your banner</div>${identityInput(0)}<div class="label">Mode</div><div class="actions mode-actions">${modes.map(([mode,title])=>`<button class="button ${draft.mode===mode?'':'ghost'}" data-action="mode" data-value="${mode}">${title}</button>`).join('')}</div><div class="label">Battle lines</div><div class="actions mode-actions">${layouts.map(([layout,title])=>`<button class="button ${draft.layout===layout?'':'ghost'}" data-action="layout" data-value="${layout}">${title}</button>`).join('')}</div>${difficulty}<div class="label">${draft.mode==='solo'?'Computer opponents':'Players'}</div><div class="actions">${[2,3,4].map(n=>`<button class="button ${draft.count===n?'':'ghost'}" data-action="count" data-value="${n}">${draft.mode==='solo'?n-1:n}</button>`).join('')}</div>${otherInputs?`<div class="stack" style="margin-top:18px">${otherInputs}</div><p class="small muted">These are suggestions. Each player chooses their own name and emoji before setting up their lines.</p>`:''}${textGuidance}<button class="button wide begin-game" data-action="start">${draft.mode==='text'?'Prepare invitations →':'Begin the war →'}</button></section>`);
}
function renderFirstIdentity(){
  const p=player(game.setup);
  frame(`<section class="panel identity-gate"><div class="phase">Your first turn · ${SUITS[game.setup]} kingdom</div><h1>Choose your banner</h1><p class="muted">${game.mode==='text'?'The host suggested a name and emoji. Make them yours before you set your lines. Your choice travels with the next game link.':'Make this kingdom your own before setting your lines. Pass the phone in private.'}</p><div class="player-identity"><label class="field"><span>Your name</span><input data-claim-name maxlength="24" value="${escapeHTML(p.name)}" autocomplete="off"></label><label class="field emoji-field"><span>Emoji</span><select data-claim-emoji aria-label="Your emoji">${EMOJIS.map(emoji=>`<option value="${emoji}"${p.emoji===emoji?' selected':''}>${emoji}</option>`).join('')}</select></label></div><button class="button wide" data-action="claim-identity">Set up battle lines →</button></section>`);
}
function renderVeil() {
  const index = game.phase === 'setup' ? game.setup : game.phase === 'refill' ? game.refill[game.refillIndex] : game.phase === 'queen' ? game.pending.defender : game.turn;
  const text = game.phase === 'setup' ? 'M’lord, our enemies are at the gates. We must prepare for war!' : game.phase === 'refill' ? 'Mend breaches in thy shield wall, beyond prying eyes.' : game.phase === 'queen' ? 'Thy Queen is shielded by the humblest nearby guard.' : 'Thy kingdom awaits the next dispatch.';
  const solo=game.mode==='solo';
  frame(`<section class="veil"><div><div class="crown">${player(index).emoji}</div><div class="phase">${solo?'Your kingdom':'Pass the phone'}</div><h1>${escapeHTML(player(index).name)}</h1><p>${text}${solo?'':'<br>Make sure only this player can see the screen.'}</p><div class="actions"><button class="button wide" data-action="reveal">${game.phase==='setup'?'Set up battle lines →':solo?'Continue →':`I’m ${escapeHTML(player(index).name)} — reveal`}</button></div></div></section>`);
}
function renderBoard(index, mode) {
  const p = player(index);
  const boardAction = mode === 'arrange' || mode === 'setup' || mode === 'refill' ? 'slot' : mode === 'attack' ? 'attacker' : '';
  return `<div class="board-title"><h3>${escapeHTML(p.name)} <span class="${[1,3].includes(index)?'red':'gold'}">${SUITS[index]}</span></h3><span class="pill">◉ ${p.coins} · Levies ${p.deck.length} · Grave ${p.graveyard.length}</span></div><div class="label">Back line</div>${lineHTML(p.back,boardAction,'back')}<div class="label">Front line</div>${lineHTML(p.front,boardAction,'front')}${p.reserve.length ? `<div class="label">Reserve · place in an empty slot</div><div class="reserve">${p.reserve.map((id,i) => cardHTML(id,mode==='arrange'||mode==='refill'?'slot':'','reserve',i)).join('')}</div>` : ''}`;
}
function renderOpponents() {
  return game.players.map((p,i) => i === game.turn || !p.alive ? '' : `<section class="opponent"><div class="board-title"><h3>${escapeHTML(p.name)} ${SUITS[i]}</h3><span class="pill">${p.front.filter(Boolean).length+p.back.filter(Boolean).length} in play</span></div><div class="label">Back line</div>${lineHTML(p.back,'target',`${i}:back`,true)}<div class="label">Front line</div>${lineHTML(p.front,'target',`${i}:front`,true)}</section>`).join('');
}
function arenaRow(owner,row,own,mode,visual) {
  const p=player(owner);
  const levy=hireDetails(p);
  // The Queen draws her extra die from one adjacent peasant. Mark that pair
  // while the player is choosing an attack, rather than adding more UI text.
  const queenIndex=own&&mode==='attack'&&!visual?p[row].findIndex(id=>id&&rank(id)==='Q'):-1;
  const attendant=queenIndex<0?null:adjacentPeasants(p,row,queenIndex)
    .sort((a,b)=>value(a.id)-value(b.id)||a.index-b.index)[0];
  const cards=p[row].map((id,index)=>{
    let action='';
    if(own && ['setup','buy','arrange','refill'].includes(mode))action='slot';
    if(own && mode==='attack' && id && !(game.usedAttackers||[]).includes(id) && (row==='front'||rank(id)==='10'))action='attacker';
    if(!own && mode==='attack' && id)action='target';
    const source=visual?.source?.owner===owner&&visual.source.row===row&&visual.source.index===index;
    const target=visual?.target?.owner===owner&&visual.target.row===row&&visual.target.index===index;
    const loser=visual?.loser?.owner===owner&&visual.loser.row===row&&visual.loser.index===index || visual?.losers?.some(slot=>slot.owner===owner&&slot.row===row&&slot.index===index);
    const winner=visual?.winner?.owner===owner&&visual.winner.row===row&&visual.winner.index===index;
    const mining=false;
    const reveal=mining||source||target&&visual?.revealTarget||!own && mode==='battle' && game.pending?.defender===owner && game.pending.target.row===row && game.pending.target.index===index;
    const hidden=visual?.revealAll?false:visual?(!own||visual.hideOwnOthers||player(owner).cpu)&&!reveal:!own&&!reveal;
    const active=source||target&&visual?.showTarget;
    const linkClass=!visual&&index===queenIndex?'queen-linked':!visual&&index===attendant?.index?'queen-attendant':'';
    const className=(visual?`${!active?'replay-dim':''} ${active?'replay-active':''} ${source&&visual.kind==='reveal'?'replay-flip':''} ${loser?'replay-loser':''} ${winner?'replay-winner':''}`:linkClass)+(mining?' mining':'');
    return cardHTML(id,action,own?row:`${owner}:${row}`,index,{hidden,owner,row,target:reveal,className,buyConfirm:own&&['buy','arrange'].includes(mode)&&buyPrompt?.location===row&&buyPrompt.index===index,buyCost:levy.cost,buyVerb:levy.verb});
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
  return `<div class="sheet-scrim" data-action="toggle-sheet"></div><section class="arena-sheet" role="dialog" aria-label="Game details"><div class="row"><h3>War council</h3><button class="button ghost" data-action="toggle-sheet">Close</button></div><p class="muted small">Round ${game.round} · ${escapeHTML(player(game.turn).name)} · ${escapeHTML(game.phase)}</p><p class="muted small">Started ${escapeHTML(dateText(dates.started||game.startedAt))}<br>Last move ${escapeHTML(dateText(dates.last))}${dates.last?` · ${escapeHTML(relativeText(dates.last))}`:''}</p>${notice?`<p class="status">${escapeHTML(notice)}</p>`:''}<p class="small">${escapeHTML(game.message||'Choose thy champion, then a foe. The highest single die carries the clash.')}</p>${game.log?.length?`<div class="small muted">${game.log.slice(-6).reverse().map(item=>`<p>${escapeHTML(item)}</p>`).join('')}</div>`:''}${share}${backup}<div class="details-actions"><button class="button secondary wide" data-action="games">All games</button><button class="button ${deleteCandidate===slotId?'danger':'ghost'} wide" data-action="delete-game" data-id="${escapeHTML(slotId)}">${deleteCandidate===slotId?'Confirm delete':'Delete from this device'}</button></div><p class="small muted">${creditLine}</p>${timings.render===null?'':`<p class="small muted perf">${timingLine()}</p>`}</section>`;
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
  const attackStatus=['attack','battle','replay'].includes(mode)?` · ${game.actions}/${actionLimit()} actions`:'';
  frame(`<section class="arena" aria-label="Battlefield"><div class="arena-opponent">${chips}<div class="arena-hud">${heading}<span>${target?`${target.front.filter(Boolean).length+target.back.filter(Boolean).length} cards`:''}</span></div>${target?arenaRow(opponent,'back',false,mode,visual):''}${target?arenaRow(opponent,'front',false,mode,visual):''}${seenReserve}</div><div class="arena-middle">${middle}</div><div class="arena-self"><div class="arena-hud"><strong>${own.emoji} ${escapeHTML(own.name)} ${SUITS[owner]}</strong><span>◉ ${own.coins}${attackStatus}</span></div>${arenaRow(owner,'front',true,mode,visual)}${arenaRow(owner,'back',true,mode,visual)}${arenaReserve(owner,visual)}</div><div class="arena-dock ${visual?'replay-dock':''}${last?' with-last':''}">${controls}${last}</div></section>${arenaDetails()}`,true);
}
function renderPlay() {
  const p = player(game.turn);
  let intro = '';
  let controls = '';
  if (game.phase === 'buy' || game.phase === 'arrange') {
    const canBolster=p.front.includes(null)&&p.back.some(Boolean);
    const levy=hireDetails(p);
    intro = buyPrompt?`Hark! Tap the gilded hollow again to ${levy.verb.toLowerCase()} a random card for ${levy.cost} coins.`:`Prepare!! Good sire, array thy vanguard ere the horns sound.${levy.available?' Tap an empty hollow twice to '+levy.verb.toLowerCase()+' a random card for '+levy.cost+' coins.':''}${covered(p)?'':' Every rear card needs a card in front of it.'}`;
    controls = `${canBolster?`<button class="button secondary" data-action="bolster">Bolster your lines</button>`:''}<button class="button wide" data-action="next" ${covered(p)?'':'disabled'}>Battle lines ready for battle!</button>`;
  } else if (game.phase === 'attack') {
    intro = `Action ${game.actions+1}/${actionLimit()}: tap a champion then a foe to attack, or choose below.${game.usedAttackers?.length?' A different champion must lead each charge.':''}`;
    controls = `<button class="button secondary" data-action="adjust">Adjust formation · 1 action</button>`;
  } else {
    const income=incomeAmount(p);
    intro = `Spoils of war: ${game.kills} fallen ${game.kills===1?'champion':'champions'}${hasCard(p,'J')?' + 1 Jack’s levy':''} = ${income} ${income===1?'coin':'coins'}.`;
    controls = `<button class="button wide" data-action="income">Claim ${income} ◉ and yield the turn →</button>`;
  }
  renderArena(game.turn,game.phase,intro,controls);
}
function renderRefill() {
  const index = game.refill[game.refillIndex], p = player(index);
  const gaps = p.front.filter(id => !id).length;
  renderArena(index,'refill',gaps?`The shield wall has ${Math.min(gaps,p.back.filter(Boolean).length)} breach${Math.min(gaps,p.back.filter(Boolean).length)===1?'':'es'}: send a rear champion forward to stand in it.`:'The vanguard stands whole. Tap a newly moved champion, then their old rear place to undo.',`<button class="button wide" data-action="refill-done" ${gaps && p.back.some(Boolean)?'disabled':''}>${gaps?'Mend the shield wall first':'Confirm the shield wall →'}</button>`);
}
function adjacentPeasants(p, row, index) {
  const cols=p[row]?.length||3;
  return [index-1,index+1].filter(i => i>=0 && i<cols && isPeasant(p[row][i] || '')).map(i => ({row,index:i,id:p[row][i]}));
}
function covered(p){ return p.back.every((id,i)=>!id||p.front[i]); }
function closeRanks(p) {
  if(!p||!Array.isArray(p.front)||!Array.isArray(p.back))return false;
  const owner=game?.players?.indexOf(p);
  const moveMemory=(fromRow,fromIndex,toRow,toIndex)=>{
    if(owner==null||owner<0||!game?.memory)return;
    const m=game.memory.find(m=>m.player===owner&&m.row===fromRow&&m.index===fromIndex);
    if(m){m.row=toRow;m.index=toIndex;}
  };
  let moved=false;
  while(!covered(p)){
    const fc=p.front.filter(Boolean).length, bc=p.back.filter(Boolean).length;
    if(fc>=bc){
      // Case A — the front has enough cards: slide the front cards (preserving
      // left-to-right order, gaps allowed) into a column set that covers every
      // back card. Prefer the fewest gaps, then the least total displacement,
      // then the lexicographically smallest column list.
      const frontIdx=p.front.map((id,i)=>id?i:-1).filter(i=>i>=0);
      const backCols=p.back.map((id,i)=>id?i:-1).filter(i=>i>=0);
      let best=null;
      const less=(a,b)=>{for(let k=0;k<a.length;k++){if(a[k]!==b[k])return a[k]<b[k];}return false;};
      const choose=(start,picked)=>{
        if(picked.length===fc){
          if(!backCols.every(c=>picked.includes(c)))return;
          const gaps=picked[fc-1]-picked[0]+1-fc;
          const disp=picked.reduce((s,c,k)=>s+Math.abs(c-frontIdx[k]),0);
          const key=[gaps,disp,...picked];
          if(!best||less(key,best.key))best={picked,key};
          return;
        }
        for(let c=start;c<=p.front.length-(fc-picked.length);c++)choose(c+1,[...picked,c]);
      };
      choose(0,[]);
      if(!best)break;
      const remap=new Map();
      frontIdx.forEach((i,k)=>{if(best.picked[k]!==i)remap.set(i,best.picked[k]);});
      if(remap.size){
        const next=p.front.map(()=>null);
        for(const [from,to] of remap){next[to]=p.front[from];moveMemory('front',from,'front',to);}
        frontIdx.forEach((i,k)=>{if(!remap.has(i))next[i]=p.front[i];});
        p.front=next;
        moved=true;
      }
      if(!remap.size)break;
    } else {
      // Case B — the back outnumbers the front: the first uncovered back slot advances.
      const i=p.back.findIndex((id,k)=>id&&!p.front[k]);
      if(rank(p.back[i])==='K'&&bc>1){
        // A different rear card advances (lowest value, first on ties) and the King takes its slot.
        let j=-1;
        for(let k=0;k<p.back.length;k++)if(p.back[k]&&rank(p.back[k])!=='K'&&(j<0||value(p.back[k])<value(p.back[j])))j=k;
        p.front[i]=p.back[j];p.back[j]=p.back[i];p.back[i]=null;
        moveMemory('back',j,'front',i);
        moveMemory('back',i,'back',j);
      } else {
        p.front[i]=p.back[i];p.back[i]=null;
        moveMemory('back',i,'front',i);
      }
      moved=true;
    }
  }
  if(moved)clampMiner(p);
  return moved;
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
  const outcome = b.result === 'tie' ? (isGenuineDraw(b)?`A bloody draw: ${cardTitle(b.attackCard)} and ${cardTitle(b.defendCard)} fall together.`:'The Assassin escapes the losing blow.') : rescue?royalSacrificeSentence(player(b.result==='attack'?b.defender:game.turn).name,b.result==='attack'?b.defendCard:b.attackCard,rescue.id):b.result === 'attack' ? `${player(game.turn).name}’s ${cardTitle(b.attackCard)} strikes down ${player(b.defender).name}’s ${cardTitle(b.defendCard)}.` : `${player(b.defender).name}’s ${cardTitle(b.defendCard)} strikes down ${player(game.turn).name}’s ${cardTitle(b.attackCard)}.`;
  renderArena(game.turn,'battle',outcome,`<button class="button" data-action="battle-next" disabled>Continue →</button>`);
  animateDice(b,battleOutcomeSlots(b));
}
function battleOutcomeSlots(b) {
  const slot=(owner,row,index)=>({owner,row,index,selector:`.card[data-slot="${owner===game.turn?row:`${owner}:${row}`}:${index}"]`});
  if(b.result==='tie')return isGenuineDraw(b)?{losers:[slot(b.defender,b.target.row,b.target.index),slot(game.turn,b.source.row,b.source.index)]}:{};
  const sacrifice=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
  if(b.result==='attack')return {loser:sacrifice?slot(b.defender,sacrifice.row,sacrifice.index):slot(b.defender,b.target.row,b.target.index),winner:slot(game.turn,b.source.row,b.source.index)};
  return {loser:sacrifice?slot(game.turn,sacrifice.row,sacrifice.index):slot(game.turn,b.source.row,b.source.index),winner:slot(b.defender,b.target.row,b.target.index)};
}
function animateDice(b,outcome={}) {
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
    if(outcome.loser)app.querySelector(outcome.loser.selector)?.classList.add('replay-loser');
    outcome.losers?.forEach(slot=>app.querySelector(slot.selector)?.classList.add('replay-loser'));
    if(outcome.winner)app.querySelector(outcome.winner.selector)?.classList.add('replay-winner');
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
  return rank(royal)==='K'?`${name}’s ${cardTitle(soldier)} hurls themself before the lance! The King endures.`:`${name}’s Queen is shielded; ${cardTitle(soldier)} gives their life in her stead.`;
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
    if(step.kind==='mine'||step.kind==='adjust'){
      const actor=player(game.turn).name;
      const line=step.kind==='mine'?`${actor} sends the ${cardTitle(player(game.turn).miner||'0-2')} to the mines.`:`${actor} adjusts the formation.`;
      renderArena(game.turn,'replay',line,`<button class="button secondary" data-action="replay-next">Next →</button>`,{kind:step.kind,opponent:game.turn,hideOwnOthers:true});
      clearTimeout(replayTimer);replayTimer=null;
      replayTimer=setTimeout(advanceReplay,650);
      return;
    }
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
    let loser=null,winner=null,visualLosers=null;
    if(step.kind==='result') {
      if(b.result==='tie') {
        narration=isGenuineDraw(b)?`A bloody draw: ${cardTitle(b.attackCard)} and ${cardTitle(b.defendCard)} fall together.`:'The Assassin escapes the losing blow.';
        if(isGenuineDraw(b)){loser=source;visualLosers=[source,target];}
      }
      else if(b.result==='attack') {
        const sacrifice=b.sacrifice.length?weakestSacrifice(b):-1;
        loser=sacrifice>=0?{owner,row:b.sacrifice[sacrifice].row,index:b.sacrifice[sacrifice].index}:target;
        winner=source;
        narration=sacrifice>=0?royalSacrificeSentence(opponent,b.defendCard,b.sacrifice[sacrifice].id):`${actor}’s ${cardTitle(b.attackCard)} strikes down ${opponent}’s ${cardTitle(b.defendCard)}.`;
      } else {
        const sacrifice=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
        loser=sacrifice?{owner:attacker,row:sacrifice.row,index:sacrifice.index}:source;winner=target;
        narration=sacrifice?royalSacrificeSentence(actor,b.attackCard,sacrifice.id):`${opponent}’s ${cardTitle(b.defendCard)} strikes down ${actor}’s ${cardTitle(b.attackCard)}.`;
      }
    }
    const visual={kind:step.kind,opponent:attacker,source,target,showTarget:step.kind!=='reveal',revealTarget:['roll','result'].includes(step.kind),showDice:['roll','result'].includes(step.kind),hideOwnOthers:playback.textReplay,loser,losers:visualLosers,winner};
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
  state.view=origin.view;state.actions=origin.actions??origin.attacks??0;state.usedAttacker=null;state.scout=null;state.memory=[];state.kills=origin.kills;
  state.turnNumber=origin.turnNumber||1;state.first=origin.first??0;state.selection=null;state.pending=null;
  state.refill=[];state.refillIndex=0;state.refillUndo=[];state.currentBattles=[];state.lastBattles=[];
  state.message='';state.log=[];
  state.players.forEach((p,i)=>{
    const s=origin.players[i];
    p.front=[...s.front];p.back=[...s.back];p.reserve=[...s.reserve];p.deck=[...s.deck];p.graveyard=[...(s.graveyard||[])];p.hades=[...(s.hades||[])];
    p.coins=s.coins;p.alive=s.alive;p.cpu=s.cpu;p.persona=s.persona||null;p.miner=null;
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
      game.round=2;game.players.forEach(q=>q.coins=Math.min(COIN_CAP,q.coins+ROUND_TWO_WARCHEST));game.phase='attack';game.turn=game.first??0;game.view=game.mode==='text'?game.first??0:game.mode==='solo'?0:null;game.selection=null;game.message='';
      if(game.mode==='text')game.turnNumber=1;
    }
    return;
  }
  if(t==='adjust'){game.actions++;game.phase='arrange';game.selection=null;game.message='';return;}
  if(t==='buy'||t==='hire'){
    const owner=Number(event.card.split('-')[0]),p=player(Number.isInteger(owner)?owner:game.turn);
    p.coins-=event.cost??HIRE_COST;
    const source=event.from==='graveyard'?p.graveyard:p.deck;
    const at=source.indexOf(event.card);
    if(at>=0)source.splice(at,1);
    p.reserve.push(event.card);
    return;
  }
  if(t==='phase'){game.phase=event.phase;game.selection=null;game.message='';return;}
  if(t==='attack'){
    if(event.actor!=null)game.turn=event.actor;
    const source=event.source,defender=event.defender,target={player:defender,...event.target};
    const attackCard=player(game.turn)[source.row][source.index],defendCard=player(defender)[target.row][target.index];
    game.usedAttacker=attackCard;game.usedAttackers=[...(game.usedAttackers||[]),attackCard];
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
  if(t==='income'){const p=player(game.turn);p.coins=Math.min(COIN_CAP,p.coins+incomeAmount(p));advanceTurn();return;}
  if(t==='arrangeSet'){
    const p=player(event.owner);
    p.front=[...event.front];p.back=[...event.back];p.reserve=[...event.reserve];
    clampMiner(p);
    if(!['setup','refill'].includes(game.phase)){
      game.turn=event.owner;
      if(game.actions>=actionLimit())finishAttacks();else game.phase='attack';
    }
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
        let loser=null,winner=null,narration='The clash is drawn; both champions endure.';
        if(b.result==='attack'){
          const sacrifice=b.sacrifice.length?weakestSacrifice(b):-1;
          loser=sacrifice>=0?{owner:b.defender,row:b.sacrifice[sacrifice].row,index:b.sacrifice[sacrifice].index}:target;
          winner=source;
          narration=sacrifice>=0?royalSacrificeSentence(opponent,b.defendCard,b.sacrifice[sacrifice].id):`${actor}’s ${cardTitle(b.attackCard)} strikes down ${opponent}’s ${cardTitle(b.defendCard)}.`;
        } else if(b.result==='defend'){
          const sacrifice=b.sacrifice.length?b.sacrifice[weakestSacrifice(b)]:null;
          loser=sacrifice?{owner:attacker,row:sacrifice.row,index:sacrifice.index}:source;winner=target;
          narration=sacrifice?royalSacrificeSentence(actor,b.attackCard,sacrifice.id):`${opponent}’s ${cardTitle(b.defendCard)} strikes down ${actor}’s ${cardTitle(b.attackCard)}.`;
        }
        const resultVisual=battleVisual('result',source,target,attacker);
        resultVisual.loser=loser;resultVisual.winner=winner;
        push(narration,{owner:b.defender,visual:resultVisual});
        continue;
      }
      if(event.t==='buy'||event.t==='hire'){
        const owner=Number(event.card.split('-')[0]);
        const name=player(Number.isInteger(owner)?owner:game.turn).name;
        applyHistoryEvent(event);
        push(`${name} ${event.from==='graveyard'?'resurrects':'levies'} ${cardTitle(event.card)} to the banners.`);
        continue;
      }
      if(event.t==='income'){
        const name=player(game.turn).name,n=incomeAmount(player(game.turn));
        applyHistoryEvent(event);
        push(`${name} claims ${n} ${n===1?'coin':'coins'} in spoils. ${game.phase==='victory'?`${player(living()[0]).name} claims the crown.`:`The command passes to ${player(game.turn).name}.`}`);
        continue;
      }
      applyHistoryEvent(event);
      if(event.t==='swap'){
        const id=player(event.owner)[event.to.location]?.[event.to.index];
        push(`${player(event.owner).name} shifts ${id?cardTitle(id):'a champion'} in the line.`);
      } else if(event.t==='setupDone'){
        if(saved.history.events[eventIndex-1]?.t!=='arrangeSet'){
          const who=game.phase==='arrange'?(game.mode==='solo'?0:game.players.length-1):game.setup-1;
          push(`${player(Math.max(0,who)).name} sets the battle line.`);
        }
      }
      else if(event.t==='phase'&&event.phase==='arrange') push(`${player(game.turn).name} readies the battle line.`);
      else if(event.t==='phase'&&event.phase==='attack') push(`${player(game.turn).name} calls the charge.`);
      else if(event.t==='resolve') push(game.phase==='victory'?`${player(living()[0]).name} claims the crown.`:(game.message||'The clash is settled.'));
      else if(event.t==='finish') push(game.phase==='refill'?'The vanguard must be made whole.':'The charge is spent.');
      else if(event.t==='mine') push(`${player(game.turn).name} sends the ${cardTitle(event.card||'0-2')} to the mines.`);
      else if(event.t==='adjust') push(`${player(game.turn).name} adjusts the formation.`);
      else if(event.t==='refillDone'&&saved.history.events[eventIndex-1]?.t!=='arrangeSet') push('The vanguard is made whole.');
      else if(event.t==='arrangeSet') push(`${player(event.owner).name} sets the battle line.`);
      else if(event.t==='sync') push('A royal dispatch refreshes the field.');
    }
    if(game.phase==='victory'&&frames.at(-1)?.phase!=='victory') push(`${player(living()[0]).name} claims the crown.`);
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
  frame(`<section class="panel"><h2>A royal sacrifice</h2><p class="muted">${escapeHTML(player(owner).name)}’s ${cardTitle(b.result==='attack'?b.defendCard:b.attackCard)} is shielded as the nearest humble guard gives their life in the royal’s stead.</p><button class="button wide" data-action="sacrifice">Witness it →</button></section>`);
}
function renderVictory() {
  const winner = player(living()[0]);
  const groupChat=game.players.length>2;
  if(game.mode==='text')ensureTurnLink();
  const score=ScoreCodec.entryFromGame(game);
  const rated=RatingCodec.fromGame(game,game.mode==='text'?recallSeat(game.matchId):0),ladder=rated?ratingStandings():null,change=rated&&ladder?.changes[rated.id];
  const ratingPanel=change?`<section class="panel"><h2>${change.ladder==='human'?'Human':'Computer'} Elo · ${Math.round(change.after).toLocaleString()}</h2><p class="muted">${change.delta>=0?'+':''}${Math.round(change.delta)} against ${change.ladder==='human'?'a rival kingdom':escapeHTML(player(1).name)}.</p><button class="button secondary wide" data-action="scores-open">See ratings & high scores</button></section>`:'';
  const scorePanel=score?`<section class="panel"><h2>${score.score.toLocaleString()} points</h2><p class="muted">${score.turns} commander ${score.turns===1?'turn':'turns'} against ${PERSONA_NAMES[score.difficulty]}.</p><button class="button secondary wide" data-action="scores-open">See high scores</button></section>`:'';
  const victoryHeadline=winner.name==='You'?'Your kingdom claims the crown.':`${escapeHTML(winner.name)} claims the crown.`;
  frame(`<section class="hero"><div class="crown">♛</div><div class="phase">The kingdom stands</div><h1>${victoryHeadline}</h1><p>${SUITS[winner.suit]} ${NAMES[winner.suit]} is the last kingdom standing.</p></section>${ratingPanel}${scorePanel}${canReplayLast()||canReplay(game)?`<section class="panel"><h2>Witness the campaign</h2><p class="muted small">${canReplay(game)?'Replay every turn with all cards face up.':'Watch the last clashes again.'}</p>${replayLastButton()}${canReplay(game)?`<button class="button wide" data-action="replay-game">Replay campaign</button>`:''}</section>`:''}${game.mode==='text'?`<section class="panel victory-dispatch"><h2>Seal thy victory</h2><p class="muted small">${groupChat?'Send the final dispatch to the group chat, so every kingdom can witness the crown claimed and replay the final clashes.':'Send the final dispatch to thy rival, so the crown’s claim is sealed.'}</p>${playerChips(game)}${turnLink?`<div class="actions"><button class="button" data-action="share-turn">${groupChat?'Send victory to group chat':`Send victory to ${escapeHTML(game.players.find(p=>p!==winner)?.name||'thy rival')}`}</button><button class="button secondary" data-action="copy-turn">Copy victory dispatch</button></div>`:'<p class="muted">Sealing the final dispatch…</p>'}</section>`:''}<section class="panel"><h2>Raise another banner?</h2><p class="muted small">Starting another game leaves this one in thy Games list.</p><button class="button secondary wide" data-action="new-after-win">Begin another war</button></section>`);
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
    if(['setup','arrange','buy','attack'].includes(game.phase) && player(idx) && !player(idx).cpu && (game.mode!=='solo'||game.phase==='setup')) return renderVeil();
    game.view=idx;
  }
  if (game.phase === 'setup') {
    const p=player(game.setup), canBolster=p.front.includes(null)&&p.back.some(Boolean);
    renderArena(game.setup,'setup',game.message || `Round 1 · set your formation: every rear card needs a card in front of it. Tap two cards to trade places.${covered(player(game.setup))?'':' Every rear card needs a card in front of it.'}`,`${canBolster?`<button class="button secondary" data-action="bolster">Bolster your lines</button>`:''}<button class="button wide" data-action="setup-done" ${covered(player(game.setup))?'':'disabled'}>Lock formation →</button>`);
  } else if (game.phase === 'refill') renderRefill();
  else if (game.phase === 'queen') renderQueen();
  else if (game.phase === 'battle') renderBattle();
  else renderPlay();
}

function slotAt(p, loc) { return p[loc]; }
function clearBuyPrompt(){buyPrompt=null;clearTimeout(buyPromptTimer);}
function prepareSlot(owner,location,index){
  const p=player(owner),empty=location!=='reserve'&&p[location]?.[index]==null;
  const levy=hireDetails(p);
  if(empty&&!game.selection&&levy.available&&p.coins>=levy.cost){
    if(buyPrompt?.location===location&&buyPrompt.index===index){
      clearBuyPrompt();
      const drawn=hireCard(p);
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
  clampMiner(p);
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
  if(p.miner===id)p.miner=null;
  if (rank(id)==='K') p.alive=false;
  else if(p.deck.length) p.graveyard.push(id);
  else p.hades.push(id);
}
function drawCard(p) { return p.deck.splice(random(p.deck.length),1)[0]; }
function resolveBattle() {
  const b=game.pending;
  const sacrificeIndex=b.sacrifice.length?weakestSacrifice(b):-1;
  const defeated=b.result==='attack' ? sacrificeIndex>=0?b.sacrifice[sacrificeIndex].id:b.defendCard : b.result==='defend'?sacrificeIndex>=0?b.sacrifice[sacrificeIndex].id:b.attackCard:null;
  game.log ??=[];
  game.log.push(`${player(game.turn).name} ${label(b.attackCard)} [${b.attackDice.join(',')}] vs ${player(b.defender).name} ${label(b.defendCard)} [${b.defendDice.join(',')}]: ${defeated?`${b.result==='attack'?label(b.attackCard):label(b.defendCard)} struck down ${label(defeated)}`:'the clash was drawn'}.`);
  if (game.log.length>24) game.log.shift();
  const genuineDraw=b.result==='tie'&&Math.max(...b.attackDice)===Math.max(...b.defendDice);
  if (b.result==='attack') {
    if (sacrificeIndex>=0) { const slot=b.sacrifice[sacrificeIndex]; defeat(b.defender,slot.row,slot.index); }
    else defeat(b.defender,b.target.row,b.target.index);
    game.kills++;
  } else if (b.result==='defend') {
    if(sacrificeIndex>=0){const slot=b.sacrifice[sacrificeIndex];defeat(game.turn,slot.row,slot.index);}
    else defeat(game.turn,b.source.row,b.source.index);
  } else if(genuineDraw) {
    defeat(b.defender,b.target.row,b.target.index);
    defeat(game.turn,b.source.row,b.source.index);
    game.kills++;
  }
  game.scout=player(b.defender)[b.target.row][b.target.index]===b.defendCard?{player:b.defender,row:b.target.row,index:b.target.index,id:b.defendCard}:null;
  rememberSlot(game.turn,b.source.row,b.source.index);
  rememberSlot(b.defender,b.target.row,b.target.index);
  closeRanks(player(b.defender));
  if(b.result==='defend'||genuineDraw)closeRanks(player(game.turn));
  pruneMemory();
  game.actions++;
  game.pending=null; game.selection=null;
  record({t:'resolve'});
  if (living().length<=1) {
    if(game.mode==='text'){game.lastBattles=game.currentBattles;game.currentBattles=[];game.turnNumber++;}
    game.phase='victory'; game.view=null; return;
  }
  if (!player(game.turn).alive) { advanceTurn(); return; }
  game.phase='attack'; game.view=player(game.turn).cpu?null:game.turn; game.message='';
  if (game.actions>=actionLimit()) finishAttacks();
}

const HIRE_COST=2, RESURRECT_COST=3, COIN_CAP=3, ROUND_TWO_WARCHEST=2;
const AI_TACTICS={
  // Each court has a strict subset of the next court's playbook. This makes
  // difficulty explainable: better rulers gain tools instead of secret odds.
  serf:{skill:.24,memory:0,reposition:0,shakeChance:.20,jitter:.55},
  squire:{skill:.48,memory:1,reposition:1,shakeChance:.16,jitter:.32,jackBack:true,cheapAttackers:true},
  captain:{skill:.68,memory:1,reposition:2,shakeChance:.11,jitter:.20,jackBack:true,knightBack:true,queenFlank:true,cheapAttackers:true,probe:true},
  warlord:{skill:.78,memory:1,reposition:2,shakeChance:.10,jitter:.16,jackBack:true,knightBack:true,queenFlank:true,cheapAttackers:true,probe:true,shuffle:true,knightSnipe:true},
  knight:{skill:1,memory:3,reposition:4,shakeChance:.04,jitter:.06,jackBack:true,knightBack:true,assassinBack:true,queenFlank:true,cheapAttackers:true,probe:true,shuffle:true,knightSnipe:true,killKnight:true,sticky:true,neverAdjust:false},
};
function tacticsFor(p){return AI_TACTICS[p.persona]||AI_TACTICS.squire;}
const formationMemory=new WeakMap();
let turnAdjusted=false,minePick=false;
function hireDetails(p){
  if(p?.deck?.length)return {pool:p.deck,cost:HIRE_COST,verb:'Hire',available:true};
  if(p?.graveyard?.length)return {pool:p.graveyard,cost:RESURRECT_COST,verb:'Resurrect',available:true};
  return {pool:[],cost:HIRE_COST,verb:'Hire',available:false};
}
function canHire(p){const h=hireDetails(p);return h.available&&p.coins>=h.cost;}
function hireCard(p){
  const h=hireDetails(p);
  if(!h.available||p.coins<h.cost)return null;
  p.coins-=h.cost;
  const drawn=h.pool.splice(random(h.pool.length),1)[0];
  p.reserve.push(drawn);
  record({t:'hire',card:drawn,cost:h.cost,from:h.verb==='Resurrect'?'graveyard':'deck'});
  return drawn;
}
function incomeAmount(p){return game.kills+(hasCard(p,'J')?1:0);}
function clampMiner(p){ if(p)p.miner=null; }
function memoryHit(enemy,row,index,tactics){
  const entry=(game?.memory||[]).find(m=>m.player===enemy&&m.row===row&&m.index===index&&game.round-m.round<tactics.memory);
  return entry?entry.id:null;
}
function rememberSlot(owner,row,index){
  if(!game.memory)game.memory=[];
  const id=player(owner)?.[row]?.[index]||null;
  game.memory=game.memory.filter(m=>!(m.player===owner&&m.row===row&&m.index===index));
  if(id)game.memory.push({player:owner,row,index,id,round:game.round});
  if(game.memory.length>24)game.memory.splice(0,game.memory.length-24);
}
function pruneMemory(){
  if(!game.memory)return;
  game.memory=game.memory.filter(m=>player(m.player)?.[m.row]?.[m.index]===m.id);
}
function exposedMoment(selfIndex,tactics){
  return selfIndex>=0&&(living().some(i=>i!==selfIndex&&player(i).back.every(id=>!id))
    ||(game.memory||[]).some(m=>m.player!==selfIndex&&m.row==='front'&&rank(m.id)==='K'&&game.round-m.round<tactics.memory));
}
function needsAdjust(p,tactics){
  if(tactics.neverAdjust||turnAdjusted)return false;
  if(canHire(p)&&p.reserve.length<3)return true;
  const selfIndex=game.players.indexOf(p);
  const seen=formationMemory.get(p);
  const rowKey=row=>p[row].filter(Boolean).slice().sort().join(',');
  if(seen&&(seen.front!==rowKey('front')||seen.back!==rowKey('back')))return true;
  let kingPos=null;
  for(const row of ['front','back'])for(let i=0;i<p[row].length;i++)if(p[row][i]&&rank(p[row][i])==='K')kingPos={row,index:i};
  if(kingPos&&!adjacentPeasants(p,kingPos.row,kingPos.index).length&&[...p.front,...p.back,...p.reserve].some(id=>id&&isPeasant(id)))return true;
  if(exposedMoment(selfIndex,tactics))return true;
  return random(1000)/1000<tactics.shakeChance;
}
function formationAnchor(p,row,index){
  const r=rank(p[row][index]||'');if(r==='K'||r==='Q')return true;
  return isPeasant(p[row][index]||'')&&[index-1,index+1].some(i=>i>=0&&i<p[row].length&&['K','Q'].includes(rank(p[row][i]||'')));
}
function repositionAI(p,tactics){
  const swaps=random((tactics.reposition||0)+1);
  for(let s=0;s<swaps;s++){
    const row=random(2)?'back':'front';
    const movable=p[row].map((id,i)=>id&&!formationAnchor(p,row,i)?i:-1).filter(i=>i>=0);
    if(movable.length<2)continue;
    const a=movable[random(movable.length)],b=movable[random(movable.length)];
    if(a===b)continue;
    [p[row][a],p[row][b]]=[p[row][b],p[row][a]];
  }
}
function arrangeAI(p) {
  const F=p.front?.length||3, B=p.back?.length||3;
  const cards=[...p.front,...p.back,...p.reserve].filter(Boolean);
  const tactics=tacticsFor(p);
  const key=cards.slice().sort().join(',');
  const frontKey=p.front.filter(Boolean).slice().sort().join(','), backKey=p.back.filter(Boolean).slice().sort().join(',');
  const selfIndex=game?.players?.indexOf(p)??-1;
  const enemies=selfIndex>=0?living().filter(i=>i!==selfIndex):[];
  const exposed=exposedMoment(selfIndex,tactics);
  const snipe=enemies.some(i=>player(i).front.every(id=>!id)&&player(i).back.some(Boolean));
  // A walled enemy can only be reached by a front-line Knight; parked in back he just waits.
  const siege=tactics.knightSnipe&&enemies.some(i=>player(i).back.some(Boolean)&&player(i).front.every(Boolean));
  const posture=(exposed?1:0)|(snipe?2:0)|(siege?4:0);
  const previous=formationMemory.get(p);
  if(tactics.sticky&&previous&&previous.key===key&&previous.front===frontKey&&previous.back===backKey&&previous.posture===posture)return;
  const remember=()=>formationMemory.set(p,{key,front:p.front.filter(Boolean).slice().sort().join(','),back:p.back.filter(Boolean).slice().sort().join(','),posture});
  if(random(1000)/1000>=tactics.skill){
    const field=shuffle(cards.slice());
    p.front=field.slice(0,F);while(p.front.length<F)p.front.push(null);
    p.back=field.slice(F,F+B);while(p.back.length<B)p.back.push(null);
    p.reserve=field.slice(F+B);
    const inReserve=p.reserve.findIndex(id=>rank(id)==='K');
    if(inReserve>=0){
      const row=p.back.some(Boolean)?'back':'front';
      const i=p[row].findIndex(Boolean);
      if(i>=0)[p[row][i],p.reserve[inReserve]]=[p.reserve[inReserve],p[row][i]];
    }
    const frontKing=p.front.findIndex(id=>id&&rank(id)==='K');
    const backCards=p.back.map((id,i)=>id?i:-1).filter(i=>i>=0);
    if(frontKing>=0&&backCards.length){const j=backCards[random(backCards.length)];[p.front[frontKing],p.back[j]]=[p.back[j],p.front[frontKing]];}
    closeRanks(p);
    remember();
    return;
  }
  const byRank=r=>cards.find(id=>rank(id)===r);
  const king=byRank('K'),queen=byRank('Q'),jack=byRank('J'),knight=byRank('10'),assassin=byRank('A');
  const peasants=cards.filter(isPeasant).sort((a,b)=>value(a)-value(b));
  const wantsFlank=tactics.queenFlank&&!!queen;
  const bodyguard1=peasants[0]||null;
  const flankPeasants=wantsFlank?peasants.slice(1,3):[];
  const bodyguard2=peasants[1+flankPeasants.length]||null;
  const backWanted=[king,bodyguard1,tactics.jackBack?jack:null,tactics.knightBack&&!snipe&&!siege?knight:null,bodyguard2,tactics.assassinBack&&!exposed?assassin:null].filter(Boolean).slice(0,B);
  const back=Array(B).fill(null);
  const kingIndex=B>2?(tactics.shuffle?1+random(B-2):1):Math.min(1,B-1);
  if(king)back[kingIndex]=king;
  const guardSlots=[kingIndex-1,kingIndex+1].filter(i=>i>=0&&i<B&&!back[i]);
  if(tactics.shuffle&&guardSlots.length>1&&random(2))guardSlots.reverse();
  [bodyguard1,bodyguard2].filter(id=>id&&backWanted.includes(id)).forEach((id,i)=>{if(guardSlots[i]!=null)back[guardSlots[i]]=id;});
  for(const id of backWanted.filter(id=>!back.includes(id))){
    const free=back.map((slot,i)=>slot?-1:i).filter(i=>i>=0);
    if(free.length)back[tactics.shuffle?free[random(free.length)]:free[0]]=id;
  }
  const onBack=new Set(back.filter(Boolean));
  const front=Array(F).fill(null);
  if(queen){
    const queenIndex=F>2?(tactics.shuffle?1+random(F-2):1):Math.min(1,F-1);
    front[queenIndex]=queen;
    if(wantsFlank){
      const sides=[queenIndex-1,queenIndex+1].filter(i=>i>=0&&i<F);
      if(tactics.shuffle&&sides.length>1&&random(2))sides.reverse();
      flankPeasants.filter(id=>!onBack.has(id)).forEach((id,i)=>{if(sides[i]!=null)front[sides[i]]=id;});
    }
  }
  const placed=new Set([...back,...front].filter(Boolean));
  let fillers=cards.filter(id=>!placed.has(id));
  if(wantsFlank){
    // Assassin, then the front-sniping Knight, then the income Jack, then peasant probers.
    const royals=[assassin,knight,jack].filter(id=>id&&fillers.includes(id));
    fillers=[...royals,...fillers.filter(isPeasant).sort((a,b)=>value(b)-value(a))];
  } else {
    fillers=fillers.sort((a,b)=>value(b)-value(a)||RANKS.indexOf(rank(b))-RANKS.indexOf(rank(a)));
  }
  for(const id of fillers){
    const slot=front.findIndex(s=>!s);
    if(slot>=0)front[slot]=id;
  }
  if(!front.some(Boolean)){
    // A depleted line still needs an attacker; parked cards cannot fight from the rear.
    const i=back.findLastIndex(id=>id&&id!==king);
    const j=i>=0?i:back.findLastIndex(Boolean);
    if(j>=0){front[0]=back[j];back[j]=null;}
  }
  const onBoard=new Set([...back,...front].filter(Boolean));
  p.front=front;
  p.back=back;
  p.reserve=cards.filter(id=>!onBoard.has(id));
  const rescue=stray=>{
    const board=[...p.front,...p.back].find(id=>id&&id!==stray&&rank(id)!=='K');
    const i=board?p.front.indexOf(board):-1;
    if(i>=0){p.front[i]=stray;p.reserve[p.reserve.indexOf(stray)]=board;return;}
    const j=board?p.back.indexOf(board):-1;
    if(j>=0){p.back[j]=stray;p.reserve[p.reserve.indexOf(stray)]=board;}
  };
  const strayKing=p.reserve.find(id=>rank(id)==='K');
  if(strayKing)rescue(strayKing);
  if(queen&&p.reserve.includes(queen))rescue(queen);
  closeRanks(p);
  remember();
}
function refillAI(p) {
  for(let i=0;i<p.front.length;i++) if(!p.front[i]) {
    let from=p.back.findIndex(id=>id && rank(id)!=='K');
    if(from<0)from=p.back.findIndex(Boolean);
    if(from<0) break;
    p.front[i]=p.back[from]; p.back[from]=null;
  }
}
function legalAttacks(self) {
  const targets=[];
  for(const enemy of living()) if(enemy!==game.turn) {
    for(const row of ['front','back']) for(let index=0;index<player(enemy)[row].length;index++) if(player(enemy)[row][index]) targets.push({enemy,row,index});
  }
  const choices=[];
  for(const sourceRow of ['front','back']) for(let index=0;index<self[sourceRow].length;index++) {
    const id=self[sourceRow][index]; if(!id || (game.usedAttackers||[]).includes(id) || sourceRow==='back' && rank(id)!=='10') continue;
    for(const t of targets) {
      if(t.row==='back' && (rank(id)!=='10' || sourceRow==='back')) continue;
      choices.push({sourceRow,sourceIndex:index,...t,score:0});
    }
  }
  return choices;
}
function chooseAIAttack() {
  const self=player(game.turn);
  const tactics=tacticsFor(self);
  const choices=legalAttacks(self);
  if(!choices.length)return null;
  if(random(1000)/1000>=tactics.skill)return choices[random(choices.length)];
  for(const choice of choices) {
    const id=self[choice.sourceRow][choice.sourceIndex];
    // Evaluate a probability model for a face-down card, never its actual rank.
    const seen=memoryHit(choice.enemy,choice.row,choice.index,tactics);
    const guesses=seen?[[rank(seen),1]]:choice.row==='back'?[['K',.48],['Q',.12],['J',.12],['10',.08],['8',.2]]:[['Q',.23],['J',.18],['10',.14],['A',.12],['8',.33]];
    let score=0;
    const occupiedGuard=[choice.index-1,choice.index+1].filter(i=>i>=0&&i<player(choice.enemy)[choice.row].length&&player(choice.enemy)[choice.row][i]).length;
    for(const [r,probability] of guesses) {
      const imagined=`${choice.enemy}-${r}`;
      const attackCount=1+(value(id)>value(imagined)?1:0)+(rank(id)==='10'&&choice.row==='front'?1:0)+(rank(id)==='Q'&&adjacentPeasants(self,choice.sourceRow,choice.sourceIndex).length?1:0);
      const defendCount=1+(value(imagined)>value(id)?1:0);
      const odds=diceOdds(attackCount,defendCount);
      const targetValue=r==='K'?occupiedGuard?[3.8,2.2][occupiedGuard-1]:7:r==='Q'?3:r==='10'?tactics.killKnight?3:1.7:r==='J'?2.5:r==='A'?1.5:1+value(imagined)/20;
      const ownValue=rank(id)==='K'?7:rank(id)==='Q'?adjacentPeasants(self,choice.sourceRow,choice.sourceIndex).length?1:3:rank(id)==='10'?2.5:rank(id)==='J'?2.5:rank(id)==='A'?0:tactics.cheapAttackers?.8+value(id)/10:1;
      score+=probability*(odds.win*(1+targetValue)-odds.lose*ownValue);
    }
    if(choice.row==='front' && player(choice.enemy).front.filter(Boolean).length===1) score+=.15;
    if(tactics.knightSnipe&&rank(id)==='10'&&choice.row==='back')score+=.4;
    // A full front line is a wall: the back line is the only road to the King.
    if(choice.row==='back'&&player(choice.enemy).front.every(Boolean))score+=.5;
    if(tactics.probe&&isPeasant(id)&&value(id)>=5&&!seen&&choice.row==='front')score+=.15;
    score+=(random(1000)/1000)*tactics.jitter;
    choice.score=score;
  }
  return choices.reduce((best,choice)=>choice.score>best.score?choice:best,choices[0]);
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
    if(++steps>maxSteps) { game.phase='stalemate';game.pending=null;game.selection=null;game.message='The computer could not bring this war to an end.';return; }
    const p=player(game.turn);
    if(game.phase==='buy') {
      game.phase='arrange';
    } else if(game.phase==='arrange') {
      while(canHire(p) && p.reserve.length<3) hireCard(p);
      arrangeAI(p);
      repositionAI(p,tacticsFor(p));
      closeRanks(p);
      recordFormation(game.turn);
      recordComputer('adjust');
      game.phase='attack';
    } else if(game.phase==='attack') {
      if(game.actions>=actionLimit()) { finishAttacks(); continue; }
      const tactics=tacticsFor(p);
      let choice=null;
      if(random(1000)/1000<tactics.skill) {
        if(needsAdjust(p,tactics)) { game.actions++;turnAdjusted=true;record({t:'adjust'});game.phase='arrange';continue; }
        choice=chooseAIAttack();
        if(!choice){game.actions++;turnAdjusted=true;record({t:'adjust'});game.phase='arrange';continue;}
      } else {
        const legal=legalAttacks(p);
        const options=[...(tactics.neverAdjust||turnAdjusted?[]:['adjust']),...(legal.length?['attack']:[])];
        const pick=options[random(options.length)];
        if(pick==='adjust') { game.actions++;turnAdjusted=true;record({t:'adjust'});game.phase='arrange';continue; }
        if(pick==='attack')choice=legal[random(legal.length)];
      }
      if(!choice){
        if(tactics.neverAdjust){finishAttacks();continue;}
        game.actions++;turnAdjusted=true;record({t:'adjust'});game.phase='arrange';continue;
      }
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
      p.coins=Math.min(COIN_CAP,p.coins+incomeAmount(p));
      record({t:'income'});
      advanceTurn();
    } else return;
  }
}
function attack(targetPlayer,row,index) {
  const source=game.selection;
  if(game.phase!=='attack'||!player(game.turn).alive||game.actions>=actionLimit())return;
  if (!source || !['front','back'].includes(source.location) || !player(game.turn)[source.location][source.index]) return;
  if (targetPlayer===game.turn || !player(targetPlayer)?.alive || !player(targetPlayer)[row]?.[index]) return;
  const attackCard=player(game.turn)[source.location][source.index], defendCard=player(targetPlayer)[row][index];
  if((game.usedAttackers||[]).includes(attackCard)){game.message='This champion has already charged this turn. Choose another for thy next assault.';game.selection=null;return;}
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
  game.usedAttacker=attackCard;game.usedAttackers=[...(game.usedAttackers||[]),attackCard];
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
  if(action==='score-layout'){rememberLayout(button.dataset.value);render();return;}
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
    } catch(error) { backupError='This finished game cannot be replayed.';render();console.error(error); }
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
      const same=StateCodec.encode({...existing.game,restoreNotices:[],log:[]},{history:false})===StateCodec.encode({...restored,restoreNotices:[],log:[]},{history:false});
      const setupForward=restored.turnNumber===1&&existing.game.turnNumber===1&&
        (existing.game.phase==='invite'&&['setup','arrange','attack'].includes(restored.phase)||
        existing.game.phase==='setup'&&(restored.phase==='setup'&&restored.setup>existing.game.setup||['arrange','attack'].includes(restored.phase)&&restored.turn===(restored.first??0)));
      if(restored.turnNumber<existing.game.turnNumber||restored.turnNumber===existing.game.turnNumber&&!same&&!setupForward){
        incomingBackup=null;incomingKind=null;incomingSeat=null;
        backupError='This link is older than your saved match or conflicts with it. Your saved game was kept.';
        history.replaceState(null,'',location.pathname+location.search);hubOpen=true;render();return;
      }
    }
    if(commit(()=>{
      const keep=(!restored.history?.origin && existing?.game.history?.origin)?existing.game.history:null;
      const keepLog=kind==='turn'&&!(restored.log?.length)&&existing?.game.log?.length?existing.game.log:null;
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
      if(keepLog)game.log=keepLog;
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
  if (action==='count') { draft.count=Number(button.dataset.value); render(); return; }
  if (action==='difficulty') { if(['serf','squire','captain','warlord','knight'].includes(button.dataset.value))draft.difficulty=button.dataset.value; render(); return; }
  if (action==='mode') { draft.mode=button.dataset.value; render(); return; }
  if (action==='layout') { rememberLayout(button.dataset.value); render(); return; }
  if (action==='start') { rememberPlayerName(draft.names[0]);rememberPlayerEmoji(draft.emojis[0]);clearLinkError(); return commit(newGame); }
  if (action==='declare-war'&&game?.mode==='text'&&game.phase==='invite'&&textAccess()===0) return commit(()=>{game.phase='setup';game.view=0;});
  if(action==='claim-identity'&&needsFirstIdentity()){
    const seat=game.setup;
    const name=(app.querySelector('[data-claim-name]')?.value??player(seat).name).trim().slice(0,24)||`Player ${seat+1}`;
    const proposed=app.querySelector('[data-claim-emoji]')?.value??player(seat).emoji;
    const emoji=EMOJIS.includes(proposed)?proposed:player(seat).emoji;
    if(commit(()=>{player(seat).name=name;player(seat).emoji=emoji;applyOwnRatings(game,seat);game.view=seat;})){
      if(game.mode==='text')persistSeat(game.matchId,seat);
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
        if(game.phase==='arrange')prepareSlot(owner,button.dataset.location,index);
        else moveSlot(owner,button.dataset.location,index);
        if(button.dataset.location==='reserve')reserveOpen=false;
      }
      return;
    }
    if (action==='setup-done' && game.phase==='setup') {
      const p=player(game.setup);
      if (!covered(p)) { game.message='Every rear card needs a card in front of it.'; return; }
      recordFormation(game.setup);
      if (game.setup+1<game.players.length && game.mode!=='solo') {
        game.setup++;game.selection=null;game.message='';
        if(game.mode==='text'){game.turn=game.setup;game.view=game.setup;}
        else game.view=null;
      } else {
        game.round=2;game.players.forEach(q=>q.coins=Math.min(COIN_CAP,q.coins+ROUND_TWO_WARCHEST));game.phase='attack';game.turn=game.first??0;game.view=game.mode==='text'?game.first??0:game.mode==='solo'?0:null;game.selection=null;
        game.message='';
        if(game.mode==='text')game.turnNumber=1;
      }
      record({t:'setupDone'});
      return;
    }
    if (action==='buy' && game.phase==='arrange') { hireCard(player(game.turn)); return; }
    if (action==='next') {
      if (game.phase==='arrange' && !covered(player(game.turn))) { game.message='Every rear card needs a card in front of it.'; return; }
      if (game.phase==='arrange') {recordFormation(game.turn);if(game.actions>=actionLimit())finishAttacks();else game.phase='attack';}
      else if (game.phase==='buy') {recordFormation(game.turn);game.phase='attack';}
      clearBuyPrompt();
      game.selection=null; game.message=''; return;
    }
    if (action==='adjust' && game.phase==='attack') { game.actions++;turnAdjusted=true;record({t:'adjust'});game.phase='arrange';game.selection=null;game.message=''; return; }
    if (action==='attacker' && game.phase==='attack') {
      const row=button.dataset.location,id=player(game.turn)[row]?.[index];
      if (id && !(game.usedAttackers||[]).includes(id) && (row==='front' || row==='back' && rank(id)==='10')) game.selection=game.selection?.location===row&&game.selection.index===index?null:{location:row,index};
      return;
    }
    if (action==='target' && game.phase==='attack') { const [owner,row]=button.dataset.location.split(':'); attack(Number(owner),row,index); return; }
    if (action==='battle-next' && game.phase==='battle') { resolveBattle(); return; }
    if (action==='sacrifice' && game.phase==='queen') { resolveBattle(); if(player(game.turn).cpu) runAIWithReplay(); return; }
    if (action==='refill-done' && game.phase==='refill') { const p=player(game.refill[game.refillIndex]); if (!p.front.includes(null) || !p.back.some(Boolean)) { completeRefill(); if(player(game.turn).cpu) runAIWithReplay(); } return; }
    if (action==='income' && game.phase==='income') { const p=player(game.turn); p.coins=Math.min(COIN_CAP,p.coins+incomeAmount(p)); record({t:'income'}); advanceTurn(); runAIWithReplay(); }
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
      if(parts.length>2||!parts[0]?.startsWith('S1.')||parts.length===2&&!/^R[12]\./.test(parts[1]))throw Error('Invalid records backup');
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
    // A turn link is a complete newer state. For a known local seat, take it
    // immediately and land on the normal dispatch screen instead of making
    // the player confirm a redundant import screen.
    if(kind==='turn'&&saved.mode==='text'&&knownSeat(saved)>=0){
      const existing=gameSlots().find(slot=>slot.game.matchId===saved.matchId);
      const same=existing&&StateCodec.encode({...existing.game,restoreNotices:[]},{history:false})===StateCodec.encode({...saved,restoreNotices:[]},{history:false});
      if(existing&&(saved.turnNumber>existing.game.turnNumber||saved.turnNumber===existing.game.turnNumber&&same)){
        const localNotices=existing.game.restoreNotices?.filter(n=>n.seat===knownSeat(saved))||[];
        if(commit(()=>{
          const keep=!saved.history?.origin&&existing.game.history?.origin?existing.game.history:null;
          game=saved;slotId=existing.id;hubOpen=false;scoresOpen=false;backupText='';
          if(localNotices.length)game.restoreNotices=[...game.restoreNotices.filter(n=>n.seat!==localNotices[0].seat),...localNotices];
          if(keep)game.history=keep;
        })){
          incomingBackup=null;incomingKind=null;incomingSeat=null;clearLinkError();
          dispatchNotice={matchId:saved.matchId,text:same?'This dispatch is already in your chronicle.':`Updated from ${saved.players[existing.game.turn]?.name||'the latest'}’s dispatch.`};
          history.replaceState(null,'',location.pathname+location.search);linkLoading=false;
          if(saved.turn===knownSeat(saved)&&saved.phase!=='setup'&&saved.phase!=='victory'&&!same)startTextReplay(saved);
          render();return;
        }
      }
    }
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
