/* Regicidious — local-only, framework-free pass-and-play. */
const KEY = 'regicidious.game.v1';
const SLOT_PREFIX = 'regicidious.match.';
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
let backupText='',incomingBackup=null,backupError='';

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
  try { incomingBackup=StateCodec.decode(location.hash.slice(8)); }
  catch { backupError='This backup link is damaged or uses an unsupported version.'; }
}

const random = max => {
  const bytes = new Uint32Array(1);
  const limit = Math.floor(4294967296 / max) * max;
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
};
function makeSlotId() { return Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join(''); }
function readSlot(id) {
  const raw=localStorage.getItem(SLOT_PREFIX+id);
  if(!raw) return null;
  const saved=raw.startsWith('B1.')?StateCodec.decode(raw):JSON.parse(raw);
  if(saved.version!==1)throw Error('Unsupported match version');
  saved.log??=[]; saved.mode??='local';
  for(const p of saved.players)p.cpu??=false;
  return saved;
}
function gameSlots() {
  const slots=[];
  for(let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);
    if(!key?.startsWith(SLOT_PREFIX))continue;
    try { const g=readSlot(key.slice(SLOT_PREFIX.length));if(g)slots.push({id:key.slice(SLOT_PREFIX.length),game:g}); }
    catch { /* Preserve a damaged save; never silently delete it. */ }
  }
  return slots.sort((a,b)=>a.id===slotId?-1:b.id===slotId?1:0);
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
  game = {version:1,mode:draft.mode,players,turn:0,round:1,phase:'setup',setup:0,view:null,selection:null,attacks:0,kills:0,pending:null,refill:[],refillIndex:0,message:'',log:[]};
  navigator.storage?.persist?.().catch(() => {});
}
function advanceTurn() {
  const alive = living();
  if (alive.length <= 1) { game.phase = 'victory'; game.view = null; return; }
  const next = alive.find(i => i > game.turn) ?? alive[0];
  if (next <= game.turn) game.round++;
  game.turn = next; game.phase = 'buy'; game.view = null; game.selection = null;
  game.attacks = 0; game.kills = 0; game.pending = null;
  game.message = `${player(next).name}'s turn. Pass the phone to them.`;
}
function cardHTML(id, action, location, index, opts={}) {
  const selected = game?.selection && game.selection.location === location && game.selection.index === index;
  const attrs = action ? `data-action="${action}" data-location="${location}" data-index="${index}"` : 'disabled';
  if (!id) return `<button class="card empty" ${attrs} aria-label="Empty slot">+</button>`;
  if (opts.hidden) return `<button class="card back ${opts.target?'target':''}" ${attrs} aria-label="Face-down card"><span class="center">♛</span></button>`;
  return `<button class="card ${['♥','♦'].includes(suit(id))?'red':''} ${selected?'selected':''}" ${attrs} aria-label="${label(id)}"><span class="rank">${rank(id)}<small>${suit(id)}</small></span><span class="center">${suit(id)}</span><span class="rank foot">${rank(id)}<small>${suit(id)}</small></span></button>`;
}
function lineHTML(cards, action, location, hidden=false) { return `<div class="line">${cards.map((id,i) => cardHTML(id,action,location,i,{hidden})).join('')}</div>`; }
function frame(content) {
  app.innerHTML = `<main class="app"><header class="top"><div><div class="brand">♛ Regicidious</div><div class="tag">The pocket battlefield</div></div><button class="pill" data-action="games">Games</button></header>${storageError ? `<div class="status" role="alert">${storageError}</div>` : ''}${backupError ? `<div class="status" role="alert">${backupError}</div>` : ''}${content}${game?.mode==='solo'&&!hubOpen&&!incomingBackup?`<section class="panel"><h3>Keep a backup</h3><p class="muted small">A backup link contains the whole match, including hidden cards. Keep it private.</p><button class="button secondary wide" data-action="backup">Copy backup link</button>${backupText?`<label class="field" style="margin-top:12px"><span>Backup link · copy this if clipboard access is unavailable</span><textarea readonly rows="3">${escapeHTML(backupText)}</textarea></label>`:''}</section>`:''}<p class="notice">Created by Shane Holmgren · Digital adaptation: Regicidious<br>Saved on this device after every move. Keep Safari website data to keep your game.<br><span class="perf">Last move: logic ${timings.logic} µs · save ${timings.save} µs · UI ${timings.render} µs</span></p></main>`;
}
function renderHub() {
  const slots=gameSlots();
  frame(`<section class="hero"><div class="crown">♛</div><h1>Your games</h1><p>Every match stays here until Safari website data is removed.</p></section>${slots.map(({id,game:g})=>`<section class="panel"><div class="phase">${g.mode==='solo'?'Solo':'Pass & play'} · Round ${g.round}</div><h2>${escapeHTML(g.players[0].name)}${g.mode==='solo'?' vs computer':''}</h2><p class="muted small">${g.phase==='victory'?'Finished':`Current turn: ${escapeHTML(g.players[g.turn].name)}`} · ${g.players.length} kingdoms</p><button class="button wide" data-action="open-game" data-id="${id}">${g.phase==='victory'?'View game':'Continue →'}</button></section>`).join('')}<div class="actions"><button class="button secondary wide" data-action="new-game">Start another game</button></div>`);
}
function renderImport() {
  const p=incomingBackup.players[incomingBackup.turn];
  frame(`<section class="panel"><div class="phase">Backup link</div><h2>Add this match?</h2><p class="muted">${escapeHTML(p.name)} · round ${incomingBackup.round} · ${incomingBackup.players.length} players</p><p class="small">Restoring adds another saved game. Your current games remain untouched.</p><div class="actions"><button class="button" data-action="restore-backup">Add backup</button><button class="button secondary" data-action="keep-current">Keep current games</button></div></section>`);
}
function renderStart() {
  frame(`<section class="hero"><div class="crown">♛</div><h1>Regicidious</h1><p>A tiny kingdom, a dangerous front line, and two attacks to make your mark.</p></section><section class="panel"><h2>Choose your battlefield</h2><p class="muted small">Play computer courts or pass one phone around. No account or network needed after the first load.</p><div class="label">Mode</div><div class="actions"><button class="button ${draft.mode==='solo'?'':'ghost'}" data-action="mode" data-value="solo">Solo vs computer</button><button class="button ${draft.mode==='local'?'':'ghost'}" data-action="mode" data-value="local">Pass & play</button></div><div class="label">${draft.mode==='solo'?'Computer opponents':'Players'}</div><div class="actions">${[2,3,4].map(n => `<button class="button ${draft.count===n?'':'ghost'}" data-action="count" data-value="${n}">${draft.mode==='solo'?n-1:n}</button>`).join('')}</div><div class="stack" style="margin-top:18px">${draft.names.slice(0,draft.mode==='solo'?1:draft.count).map((name,i) => `<label class="field"><span>${SUITS[i]} ${draft.mode==='solo'?'Your name':NAMES[i]}</span><input data-name="${i}" maxlength="24" value="${escapeHTML(name)}" autocomplete="off"></label>`).join('')}</div><div class="actions"><button class="button wide" data-action="start">Begin the war →</button></div></section><details class="panel"><summary>How this version plays</summary><ul class="rule-list"><li>Arrange six cards, then take turns buying, rearranging, and attacking up to twice.</li><li>Tap your attacker, then a face-down enemy card. Only a 10 can reach the back line.</li><li>Highest single die wins. Ties spare both cards. Defeated cards return to the owner’s shuffled pile.</li><li>A surviving Jack earns one coin; each enemy card defeated earns one more. Cards cost two coins.</li><li>Civ bonuses are not included yet.</li></ul></details>`);
}
function renderVeil() {
  const index = game.phase === 'setup' ? game.setup : game.phase === 'refill' ? game.refill[game.refillIndex] : game.phase === 'queen' ? game.pending.defender : game.turn;
  const text = game.phase === 'setup' ? 'Arrange your starting cards in private.' : game.phase === 'refill' ? 'Fill any front-line gaps in private.' : game.phase === 'queen' ? 'Your Queen may sacrifice an adjacent peasant.' : 'Your kingdom is waiting.';
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
function renderPlay() {
  const p = player(game.turn);
  const phaseText = {buy:'Buy cards',arrange:'Arrange your line',attack:'Attack',income:'Record income'}[game.phase];
  let intro = '';
  let controls = '';
  if (game.phase === 'buy') {
    intro = `Draw one random card from your shuffled suit pile for 2 coins. You can buy more than one.`;
    controls = `<button class="button" data-action="buy" ${p.coins<2||!p.deck.length?'disabled':''}>Buy a card · 2 ◉</button><button class="button secondary" data-action="next">Arrange →</button>`;
  } else if (game.phase === 'arrange') {
    intro = `Tap two cards or an empty slot to move or swap. Front and back hold three each. Once you attack, your layout is locked for this turn.`;
    controls = `<button class="button wide" data-action="next">Attack →</button>`;
  } else if (game.phase === 'attack') {
    intro = `Attack ${game.attacks+1} of 2. Select one of your front-line cards, then an enemy front-line card. A 10 may also target the back line.`;
    controls = `<button class="button secondary wide" data-action="finish-attacks">${game.attacks ? 'Finish attacks' : 'Skip attacks'} →</button>`;
  } else {
    const jack = hasCard(p,'J') ? 1 : 0;
    intro = `${game.kills} defeated ${game.kills===1?'card':'cards'} + ${jack} Jack bonus = ${game.kills+jack} ${game.kills+jack===1?'coin':'coins'}.`;
    controls = `<button class="button wide" data-action="income">Collect ${game.kills+jack} ◉ and end turn →</button>`;
  }
  frame(`<div class="phase">${phaseText}</div><div class="status">${escapeHTML(game.message || intro)}</div>${renderBoard(game.turn,game.phase)}${game.phase==='attack'?renderOpponents():''}<div class="actions">${controls}</div>${game.log?.length?`<section class="panel"><h3>Recent battles</h3><div class="small muted">${game.log.slice(-8).reverse().map(item=>`<p>${escapeHTML(item)}</p>`).join('')}</div></section>`:''}`);
}
function renderRefill() {
  const index = game.refill[game.refillIndex], p = player(index);
  const gaps = p.front.filter(id => !id).length;
  frame(`<div class="phase">Restore the front line</div><div class="status">${gaps ? `Move ${Math.min(gaps,p.back.filter(Boolean).length)} card(s) forward from the back line. Tap a card, then an empty front slot.` : 'Your front line is ready.'}</div>${renderBoard(index,'refill')}<div class="actions"><button class="button wide" data-action="refill-done" ${gaps && p.back.some(Boolean)?'disabled':''}>Done →</button></div>`);
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
  const outcome = b.result === 'tie' ? 'A draw. Both survive.' : b.result === 'attack' ? `${player(b.defender).name} loses ${label(b.defendCard)}.` : `${player(game.turn).name} loses ${label(b.attackCard)}.`;
  const dice = values => `<div class="dice">${values.map(n => `<span class="die">${n}</span>`).join('')}</div>`;
  frame(`<div class="phase">The clash</div><section class="panel"><h2>${escapeHTML(outcome)}</h2><div class="battle"><div><strong>${escapeHTML(player(game.turn).name)} · ${label(b.attackCard)}</strong>${dice(b.attackDice)}</div><div><strong>${escapeHTML(player(b.defender).name)} · ${label(b.defendCard)}</strong>${dice(b.defendDice)}</div></div>${b.result==='attack'&&b.sacrifice ? `<p class="muted small">The Queen can sacrifice an adjacent peasant instead.</p>` : ''}<div class="actions"><button class="button wide" data-action="battle-next">${b.result==='attack'&&b.sacrifice?'Pass to defender →':'Continue →'}</button></div></section>`);
}
function renderQueen() {
  const b = game.pending, p = player(b.defender);
  frame(`<div class="phase">Royal sacrifice</div><section class="panel"><h2>Save your Queen?</h2><p class="muted">${escapeHTML(p.name)}, your Queen ${label(b.defendCard)} was defeated. You may lose an adjacent peasant instead.</p><div class="actions">${b.sacrifice.map((slot,i) => `<button class="button secondary" data-action="sacrifice" data-index="${i}">Sacrifice ${label(slot.id)}</button>`).join('')}<button class="button danger" data-action="sacrifice" data-index="-1">Lose the Queen</button></div></section>`);
}
function renderVictory() {
  const winner = player(living()[0]);
  frame(`<section class="hero"><div class="crown">♛</div><div class="phase">The kingdom stands</div><h1>${escapeHTML(winner.name)} wins.</h1><p>${SUITS[winner.suit]} ${NAMES[winner.suit]} is the last kingdom standing. This finished game remains saved on this device.</p></section><section class="panel"><h2>Another game?</h2><p class="muted small">Starting a new game replaces this finished game on this device.</p><button class="button secondary wide" data-action="new-after-win">New game</button></section>`);
}
function render() {
  if(incomingBackup) return renderImport();
  if(hubOpen) return renderHub();
  if (!game) return renderStart();
  if (game.phase === 'victory') return renderVictory();
  if (game.view === null) return renderVeil();
  if (game.phase === 'setup') {
    frame(`<div class="phase">Starting formation · ${game.setup+1} of ${game.players.length}</div><div class="status">${escapeHTML(game.message || `Only ${player(game.setup).name} should look. Tap two cards to swap their positions. Start with at least as many cards in front as behind.`)}</div>${renderBoard(game.setup,'setup')}<div class="actions"><button class="button wide" data-action="setup-done">Lock formation →</button></div>`);
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
  if (game.phase==='refill' && !(from.location==='back' && location==='front' && !b[index])) return;
  if (from.location==='reserve' && location==='reserve') return;
  // A King must remain in a line; a reserve cannot be used as a safe hiding place.
  if ((location==='reserve' && rank(a[from.index])==='K') || (from.location==='reserve' && b[index] && rank(b[index])==='K')) { game.message='Your King must stay on the battlefield.'; game.selection=null; return; }
  [a[from.index],b[index]] = [b[index] || null,a[from.index]];
  if (from.location==='reserve' && !a[from.index]) a.splice(from.index,1);
  if (location==='reserve' && !b[index]) b.splice(index,1);
  game.selection=null;
}
function completeRefill() {
  game.selection=null; game.refillIndex++;
  if (game.refillIndex < game.refill.length) game.view=null;
  else { game.phase='income'; game.view=game.turn; game.message=''; }
}
function finishAttacks() {
  game.refill = game.players.map((p,i) => p.alive && p.front.includes(null) && p.back.some(Boolean) ? i : -1).filter(i => i>=0);
  for(const i of game.refill.filter(i=>player(i).cpu)) refillAI(player(i));
  game.refill=game.refill.filter(i=>!player(i).cpu);
  game.refillIndex=0; game.selection=null;
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
function resolveBattle(sacrificeIndex=-1) {
  const b=game.pending;
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
  if (living().length<=1) { game.phase='victory'; game.view=null; return; }
  game.phase='attack'; game.view=player(game.turn).cpu?null:game.turn; game.message=`${game.attacks} of 2 attacks used. ${game.attacks<2?'You may attack again or finish.':''}`;
  if (game.attacks>=2 || !player(game.turn).front.some(Boolean)) finishAttacks();
}

function cardPriority(id) {
  const r=rank(id);
  return r==='Q'?18:r==='10'?17:r==='A'?15:r==='J'?13:r==='9'?12:r==='8'?11:r==='K'?-100:value(id);
}
function arrangeAI(p) {
  const cards=[...p.front,...p.back,...p.reserve].filter(Boolean);
  const king=cards.find(id=>rank(id)==='K');
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
    const from=p.back.findIndex(id=>id && rank(id)!=='K');
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
  for(let index=0;index<3;index++) {
    const id=self.front[index]; if(!id) continue;
    for(const t of targets) {
      if(t.row==='back' && rank(id)!=='10') continue;
      // Evaluate a probability model for a face-down card, never its actual rank.
      const guesses=t.row==='back'?[['K',.48],['Q',.12],['J',.12],['10',.08],['8',.2]]:[['Q',.23],['J',.18],['10',.14],['A',.12],['8',.33]];
      let score=0;
      for(const [r,probability] of guesses) {
        const imagined=`${t.enemy}-${r}`;
        const attackCount=1+(value(id)>value(imagined)?1:0)+(rank(id)==='10'&&t.row==='front'?1:0)+(rank(id)==='Q'&&queenNeighbor(self,'front',index).length?1:0);
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
      choices.push({index,...t,score});
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
function runAI() {
  while(game.phase!=='victory' && player(game.turn).cpu) {
    const p=player(game.turn);
    if(game.phase==='buy') {
      while(p.coins>=2 && p.deck.length && p.reserve.length<3) { p.coins-=2; p.reserve.push(drawCard(p)); }
      game.phase='arrange';
    } else if(game.phase==='arrange') { arrangeAI(p); game.phase='attack'; }
    else if(game.phase==='attack') {
      const choice=game.attacks<2 && chooseAIAttack();
      if(!choice) { finishAttacks(); continue; }
      game.selection={location:'front',index:choice.index};
      attack(choice.enemy,choice.row,choice.index);
    } else if(game.phase==='battle') {
      if(game.pending.sacrifice.length && game.pending.defender===0) { game.phase='queen'; game.view=null; return; }
      const sacrifice=game.pending.sacrifice.length ? game.pending.sacrifice.reduce((best,s,i,a)=>value(s.id)<value(a[best].id)?i:best,0) : -1;
      resolveBattle(sacrifice);
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
  if (!source || source.location!=='front' || !player(game.turn).front[source.index]) return;
  if (targetPlayer===game.turn || !player(targetPlayer)?.alive || !player(targetPlayer)[row]?.[index]) return;
  const attackCard=player(game.turn).front[source.index], defendCard=player(targetPlayer)[row][index];
  if (row==='back' && rank(attackCard)!=='10') { game.message='Only a Knight (10) can attack the back line.'; return; }
  const sourceSlot={row:'front',index:source.index}, target={player:targetPlayer,row,index};
  const [a,d]=diceCount(attackCard,defendCard,sourceSlot,target);
  const attackDice=roll(a), defendDice=roll(d);
  let result=Math.max(...attackDice)>Math.max(...defendDice)?'attack':Math.max(...attackDice)<Math.max(...defendDice)?'defend':'tie';
  if (result==='defend' && rank(attackCard)==='A') result='tie';
  const sacrifice=result==='attack' && rank(defendCard)==='Q' ? queenNeighbor(player(targetPlayer),row,index) : [];
  game.pending={defender:targetPlayer,source:sourceSlot,target,attackCard,defendCard,attackDice,defendDice,result,sacrifice};
  game.phase='battle'; game.selection=null; game.message='';
}

app.addEventListener('input', event => {
  if (event.target.matches('[data-name]')) draft.names[Number(event.target.dataset.name)] = event.target.value;
});
app.addEventListener('click', event => {
  const button=event.target.closest('[data-action]'); if (!button) return;
  const action=button.dataset.action, index=Number(button.dataset.index);
  if(action==='backup' && game) {
    backupText=location.href.split('#')[0]+'#backup='+StateCodec.encode(game);
    navigator.clipboard?.writeText(backupText).catch(()=>{});
    render(); return;
  }
  if(action==='games') { hubOpen=true;backupText='';render();return; }
  if(action==='new-game' || action==='new-after-win') { game=null;slotId=null;hubOpen=false;backupText='';render();return; }
  if(action==='open-game') {
    try { const chosen=readSlot(button.dataset.id);if(!chosen)throw Error('Missing match');game=chosen;slotId=button.dataset.id;hubOpen=false;backupText='';localStorage.setItem(ACTIVE_KEY,slotId);storageError='';render(); }
    catch(error) { storageError='This game could not be opened. Its saved data was not changed.';render();console.error(error); }
    return;
  }
  if(action==='keep-current') { incomingBackup=null;hubOpen=!game;history.replaceState(null,'',location.pathname+location.search);render();return; }
  if(action==='restore-backup' && incomingBackup) {
    const restored=incomingBackup;
    if(commit(()=>{game=restored;slotId=makeSlotId();backupText='';hubOpen=false;})) { incomingBackup=null; history.replaceState(null,'',location.pathname+location.search); render(); }
    return;
  }
  if(storageError) return;
  if (action==='count') { draft.count=Number(button.dataset.value); render(); return; }
  if (action==='mode') { draft.mode=button.dataset.value; render(); return; }
  if (action==='start') return commit(newGame);
  if (!game) return;
  commit(() => {
    if (action==='reveal') { game.view=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.phase==='queen'?game.pending.defender:game.turn; return; }
    if (action==='slot') {
      const owner=game.phase==='setup'?game.setup:game.phase==='refill'?game.refill[game.refillIndex]:game.turn;
      if (['setup','arrange','refill'].includes(game.phase)) moveSlot(owner,button.dataset.location,index);
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
      if (button.dataset.location==='front' && player(game.turn).front[index]) game.selection=game.selection?.index===index?null:{location:'front',index};
      return;
    }
    if (action==='target' && game.phase==='attack') { const [owner,row]=button.dataset.location.split(':'); attack(Number(owner),row,index); return; }
    if (action==='battle-next' && game.phase==='battle') {
      if (game.pending.sacrifice.length) { game.phase='queen'; game.view=null; }
      else resolveBattle(); return;
    }
    if (action==='sacrifice' && game.phase==='queen') { resolveBattle(index); if(player(game.turn).cpu) runAI(); return; }
    if (action==='finish-attacks' && game.phase==='attack') { finishAttacks(); return; }
    if (action==='refill-done' && game.phase==='refill') { const p=player(game.refill[game.refillIndex]); if (!p.front.includes(null) || !p.back.some(Boolean)) { completeRefill(); if(player(game.turn).cpu) runAI(); } return; }
    if (action==='income' && game.phase==='income') { player(game.turn).coins+=game.kills+(hasCard(player(game.turn),'J')?1:0); advanceTurn(); runAI(); }
  });
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
render();
