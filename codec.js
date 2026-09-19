/* Versioned binary match format. No JSON is used for new saves or links. */
const StateCodec = (() => {
  const phases=['setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate','invite'];
  const emojis=['👑','🐉','🦊','🦁','🐺','🛡️','🦅','🐻','🦄','💀','⚔️','🧙'];
  const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const personas=[null,'serf','squire','knight'];
  const playerFlags=p=>(p.alive?1:0)|(p.cpu?2:0)|(Math.max(0,personas.indexOf(p.persona))<<2);
  const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8',{fatal:true});
  const cardCode=id => id==null?255:Number(id.split('-')[0])*16+ranks.indexOf(id.split('-')[1]);
  const cardFrom=code => code===255?null:`${code>>4}-${ranks[code&15]}`;
  const packSlot=s=>((['front','back','reserve'].indexOf(s.location)&3)<<4)|(s.index&15);
  const unpackSlot=n=>({location:['front','back','reserve'][n>>4],index:n&15});
  function encode(state, opts={}) {
    const expanded=state.layout==='expanded'||state.players?.[0]?.front?.length===4;
    const out=[0x52,0x47,expanded?2:1];
    const byte=n=>out.push(n&255);
    const number=n=>{ n=Number(n)>>>0; while(n>=128){byte((n&127)|128);n>>>=7;} byte(n); };
    const string=s=>{const data=encoder.encode(s||'');number(data.length);for(const n of data) byte(n);};
    const card=id=>byte(cardCode(id));
    const ranksPacked=ids=>{for(let i=0;i<ids.length;i+=2){const a=ids[i]==null?15:ranks.indexOf(ids[i].split('-')[1]);const b=ids[i+1]==null?15:ranks.indexOf(ids[i+1].split('-')[1]);byte(a|(b<<4));}};
    const dice=values=>{byte(values.length);for(const n of values)byte(n);};
    byte((state.mode==='solo'?0:state.mode==='text'?2:1)|(state.queenRule==='cedric'?128:0));byte(state.players.length);byte(state.turn);number(state.round);
    byte(phases.indexOf(state.phase));byte(state.setup);byte(state.view==null?255:state.view);
    byte(state.selection?['front','back','reserve'].indexOf(state.selection.location):255);
    byte(state.selection?.index??255);byte(state.actions);byte(state.kills);
    byte(state.refill.length);for(const i of state.refill)byte(i);byte(state.refillIndex);
    for(const p of state.players) {
      string(p.name);byte(playerFlags(p));number(p.coins);
      ranksPacked([...p.front,...p.back]);
      byte(p.reserve.length);ranksPacked(p.reserve);
      byte(p.deck.length);ranksPacked(p.deck);
    }
    const b=state.pending;
    byte(b?1:0);
    if(b) {
      byte(b.defender);byte(b.source.index|(b.source.row==='back'?128:0));byte(b.target.row==='back'?1:0);byte(b.target.index);
      card(b.attackCard);card(b.defendCard);dice(b.attackDice);dice(b.defendDice);
      byte(['tie','attack','defend'].indexOf(b.result));
      byte(b.sacrifice.length);
      for(const slot of b.sacrifice){byte(slot.row==='back'?1:0);byte(slot.index);card(slot.id);}
    }
    string(state.message);
    number((state.log||[]).length);for(const entry of state.log||[])string(entry);
    const undo=state.refillUndo||[];
    byte(undo.length);
    for(const move of undo){byte(move.owner);byte(move.from);byte(move.to);card(move.card);}
    byte(0xa7);
    const matchId=state.matchId||'';
    byte(matchId?16:0);
    if(matchId)for(let i=0;i<32;i+=2)byte(parseInt(matchId.slice(i,i+2),16));
    number(state.turnNumber||1);
    for(const events of [state.currentBattles||[],state.lastBattles||[]]){
      byte(events.length);
      for(const e of events){
        byte(e.actor);byte(e.defender);
        byte(e.source.index|(e.source.row==='back'?128:0));
        byte(e.target.index|(e.target.row==='back'?128:0));
        card(e.attackCard);card(e.defendCard);dice(e.attackDice);dice(e.defendDice);
        byte(['tie','attack','defend'].indexOf(e.result));
        byte(e.sacrifice?e.sacrifice.index|(e.sacrifice.row==='back'?128:0):255);
        ranksPacked(e.beforeActor);ranksPacked(e.beforeDefender);
      }
    }
    if(opts.history!==false && state.history?.origin && Array.isArray(state.history.events)){
      byte(0xa8);
      const origin=state.history.origin;
      byte(origin.turn);byte(origin.setup);byte(phases.indexOf(origin.phase));
      byte(origin.view==null?255:origin.view);number(origin.round);
      byte(origin.actions??origin.attacks??0);byte(origin.kills||0);number(origin.turnNumber||1);byte(origin.first||0);
      for(const p of origin.players){
        byte(playerFlags(p));number(p.coins);
        ranksPacked([...p.front,...p.back]);
        byte(p.reserve.length);ranksPacked(p.reserve);
        byte(p.deck.length);ranksPacked(p.deck);
      }
      number(state.history.events.length);
      byte(state.history.truncated?1:0);
      for(const e of state.history.events){
        const t=e.t;
        if(t==='swap'){byte(1);byte(e.owner);byte(packSlot(e.from));byte(packSlot(e.to));}
        else if(t==='setupDone')byte(2);
        else if(t==='buy'){byte(3);card(e.card);}
        else if(t==='phase'){byte(4);byte(phases.indexOf(e.phase));}
        else if(t==='attack'){
          byte(5);byte(e.actor??255);
          byte(e.source.index|(e.source.row==='back'?128:0));
          byte(e.defender);
          byte(e.target.index|(e.target.row==='back'?128:0));
          dice(e.attackDice);dice(e.defendDice);
          byte(['tie','attack','defend'].indexOf(e.result));
          byte((e.sacrifice||[]).length);
          for(const s of e.sacrifice||[]){byte(s.row==='back'?1:0);byte(s.index);card(s.id);}
        }
        else if(t==='resolve')byte(6);
        else if(t==='finish')byte(7);
        else if(t==='refillDone')byte(8);
        else if(t==='income')byte(9);
        else if(t==='mine'){byte(12);card(e.card);}
        else if(t==='adjust')byte(13);
        else if(t==='arrangeSet'){
          byte(10);byte(e.owner);
          ranksPacked([...e.front,...e.back]);
          byte(e.reserve.length);ranksPacked(e.reserve);
        }
        else if(t==='sync'){
          byte(11);
          const snap=e.origin;
          byte(snap.turn);byte(snap.setup);byte(phases.indexOf(snap.phase));
          byte(snap.view==null?255:snap.view);number(snap.round);
          byte(snap.actions??snap.attacks??0);byte(snap.kills||0);number(snap.turnNumber||1);byte(snap.first||0);
          for(const p of snap.players){
            byte(playerFlags(p));number(p.coins);
            ranksPacked([...p.front,...p.back]);
            byte(p.reserve.length);ranksPacked(p.reserve);
            byte(p.deck.length);ranksPacked(p.deck);
          }
        }
        else throw Error('Unknown history event');
      }
    }
    if(Number(state.startedAt)>0){
      byte(0xa9);
      number(Math.floor(Number(state.startedAt)/1000));
    }
    if(state.usedAttacker){byte(0xaa);card(state.usedAttacker);}
    if(state.scout){byte(0xab);byte(state.scout.player);byte(state.scout.index|(state.scout.row==='back'?128:0));card(state.scout.id);}
    byte(0xac);for(let i=0;i<state.players.length;i++)byte(Math.max(0,emojis.indexOf(state.players[i].emoji)));
    if(state.restoreNotices?.length){byte(0xad);byte(state.restoreNotices.length);for(const notice of state.restoreNotices){byte(notice.seat);byte(notice.kind==='invite'?1:0);number(notice.turnNumber);}}
    if(state.finishedAt){byte(0xae);number(Math.floor(state.finishedAt/1000));}
    if(state.scoreVersion){byte(0xaf);byte(state.scoreVersion);}
    if(state.memory?.length){byte(0xb0);byte(state.memory.length);for(const m of state.memory){byte(m.player);byte(m.index|(m.row==='back'?128:0));card(m.id);number(m.round);}}
    if(state.players.some(p=>p.miner)){byte(0xb1);for(const p of state.players)card(p.miner);}
    if(state.first){byte(0xb2);byte(state.first);}
    // Detect accidental truncation/corruption. This is not a security signature.
    let check=2166136261;
    for(const n of out)check=Math.imul(check^n,16777619)>>>0;
    for(let i=0;i<4;i++)byte(check>>>(i*8));
    const binary=String.fromCharCode(...out);
    return 'B1.'+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decode(encoded, legacyHistory=false) {
    if(typeof encoded!=='string'||!encoded.startsWith('B1.'))throw Error('Unknown match format');
    if(encoded.length>98304)throw Error('Match link too large');
    const value=encoded.slice(3).replace(/-/g,'+').replace(/_/g,'/');
    const data=Uint8Array.from(atob(value),ch=>ch.charCodeAt(0));
    if(data.length<8||data.length>65536)throw Error('Invalid match size');
    let check=2166136261;
    for(let i=0;i<data.length-4;i++)check=Math.imul(check^data[i],16777619)>>>0;
    const expected=(data[data.length-4]|data[data.length-3]<<8|data[data.length-2]<<16|data[data.length-1]<<24)>>>0;
    if(check!==expected)throw Error('Match checksum mismatch');
    try {
    let at=0;
    const byte=()=>{if(at>=data.length-4)throw Error('Truncated match');return data[at++];};
    const number=()=>{let n=0,shift=0,v;do{v=byte();n|=(v&127)<<shift;shift+=7;if(shift>35)throw Error('Invalid number');}while(v&128);return n>>>0;};
    const string=()=>{const length=number();if(length>65536||at+length>data.length-4)throw Error('Invalid text');const s=decoder.decode(data.slice(at,at+length));at+=length;return s;};
    const card=()=>{const code=byte();if(code!==255&&((code>>4)>3||(code&15)>12))throw Error('Invalid card');return cardFrom(code);};
    const ranksPacked=(count,owner)=>{const ids=[];for(let i=0;i<count;i+=2){const pair=byte();for(const nibble of [pair&15,pair>>4])if(ids.length<count){if(nibble!==15&&nibble>12)throw Error('Invalid rank');ids.push(nibble===15?null:`${owner}-${ranks[nibble]}`);}}return ids;};
    const dice=()=>{const count=byte();if(count>3)throw Error('Invalid dice');return Array.from({length:count},byte);};
    if(byte()!==0x52||byte()!==0x47)throw Error('Unknown match version');
    const codecVersion=byte();
    if(codecVersion!==1&&codecVersion!==2)throw Error('Unknown match version');
    const boardCount=codecVersion===2?8:6, lineLen=codecVersion===2?4:3, layout=codecVersion===2?'expanded':'classic';
    const modeCode=byte(),mode=['solo','local','text'][modeCode&127],queenRule=modeCode&128?'cedric':'original',count=byte(),turn=byte(),round=number();
    if(!mode)throw Error('Invalid mode');
    if(count<2||count>4||turn>=count)throw Error('Invalid players');
    const phase=phases[byte()],setup=byte(),viewCode=byte(),selectionCode=byte(),selectionIndex=byte();
    if(!phase)throw Error('Invalid phase');
    const actions=byte(),kills=byte(),refillCount=byte();
    const refill=Array.from({length:refillCount},byte),refillIndex=byte();
    const players=Array.from({length:count},(_,i)=>{
      const name=string(),flags=byte(),coins=number();
      const board=ranksPacked(boardCount,i),front=board.slice(0,lineLen),back=board.slice(lineLen);
      const reserve=ranksPacked(byte(),i),deck=ranksPacked(byte(),i);
      return {name,suit:i,cpu:!!(flags&2),alive:!!(flags&1),persona:personas[flags>>2]||null,coins,front,back,reserve,deck,miner:null};
    });
    let pending=null;
    if(byte()) {
      const defender=byte(),sourceCode=byte(),source={row:sourceCode&128?'back':'front',index:sourceCode&127};
      const target={player:defender,row:byte()?'back':'front',index:byte()};
      const attackCard=card(),defendCard=card(),attackDice=dice(),defendDice=dice();
      const result=['tie','attack','defend'][byte()],sacrificeCount=byte();
      const sacrifice=Array.from({length:sacrificeCount},()=>({row:byte()?'back':'front',index:byte(),id:card()}));
      pending={defender,source,target,attackCard,defendCard,attackDice,defendDice,result,sacrifice};
    }
    const message=string(),logCount=number();
    if(logCount>1000)throw Error('Invalid log');
    const log=Array.from({length:logCount},string);
    const refillUndo=[];
    if(at<data.length-4){
      const undoCount=byte();if(undoCount>3)throw Error('Invalid refill history');
      for(let i=0;i<undoCount;i++)refillUndo.push({owner:byte(),from:byte(),to:byte(),card:card()});
    }
    let matchId='',turnNumber=1,currentBattles=[],lastBattles=[],history=null,startedAt=0,usedAttacker=null,scout=null,restoreNotices=[],finishedAt=0,scoreVersion=0,memory=[],first=0;
    if(at<data.length-4){
      if(byte()!==0xa7)throw Error('Unknown match extension');
      const idLength=byte();if(idLength!==0&&idLength!==16)throw Error('Invalid match ID');
      for(let i=0;i<idLength;i++)matchId+=byte().toString(16).padStart(2,'0');
      turnNumber=number();
      const events=()=>{
        const n=byte();if(n>2)throw Error('Invalid battle history');
        return Array.from({length:n},()=>{
          const actor=byte(),defender=byte(),sourceCode=byte(),targetCode=byte();
          const source={row:sourceCode&128?'back':'front',index:sourceCode&127};
          const target={row:targetCode&128?'back':'front',index:targetCode&127};
          const attackCard=card(),defendCard=card(),attackDice=dice(),defendDice=dice();
          const result=['tie','attack','defend'][byte()],sacrificeCode=byte();
          const sacrifice=sacrificeCode===255?null:{row:sacrificeCode&128?'back':'front',index:sacrificeCode&127};
          const beforeActor=ranksPacked(boardCount,actor),beforeDefender=ranksPacked(boardCount,defender);
          return {actor,defender,source,target,attackCard,defendCard,attackDice,defendDice,result,sacrifice,beforeActor,beforeDefender};
        });
      };
      currentBattles=events();lastBattles=events();
    }
    while(at<data.length-4){
      const mag=byte();
      if(mag===0xa9){startedAt=number()*1000;continue;}
      if(mag===0xaa){usedAttacker=card();continue;}
      if(mag===0xab){const player=byte(),slot=byte();scout={player,row:slot&128?'back':'front',index:slot&127,id:card()};continue;}
      if(mag===0xac){for(const p of players){const code=byte();if(code>=emojis.length)throw Error('Invalid emoji');p.emoji=emojis[code];}continue;}
      if(mag===0xad){const n=byte();if(n>count)throw Error('Invalid restore notice');restoreNotices=Array.from({length:n},()=>{const seat=byte(),kind=byte(),noticedTurn=number();if(seat>=count||kind>1||noticedTurn<1)throw Error('Invalid restore notice');return {seat,kind:kind?'invite':'backup',turnNumber:noticedTurn};});continue;}
      if(mag===0xae){finishedAt=number()*1000;continue;}
      if(mag===0xaf){scoreVersion=byte();if(scoreVersion!==1)throw Error('Invalid score version');continue;}
      if(mag===0xb0){const n=byte();if(n>24)throw Error('Invalid memory');memory=Array.from({length:n},()=>{const owner=byte(),slot=byte(),id=card(),seen=number();return {player:owner,row:slot&128?'back':'front',index:slot&127,id,round:seen};});continue;}
      if(mag===0xb1){for(const p of players)p.miner=card();continue;}
      if(mag===0xb2){first=byte();continue;}
      if(mag!==0xa8)throw Error('Unknown match extension');
      const originTurn=byte(),originSetup=byte(),originPhase=phases[byte()],originView=byte(),originRound=number();
      if(!originPhase)throw Error('Invalid history origin');
      const originAttacks=byte(),originKills=byte(),originTurnNumber=number(),originFirst=legacyHistory?0:byte();
      const originPlayers=Array.from({length:count},(_,i)=>{
        const flags=byte(),coins=number();
        const board=ranksPacked(boardCount,i),front=board.slice(0,lineLen),back=board.slice(lineLen);
        const reserve=ranksPacked(byte(),i),deck=ranksPacked(byte(),i);
        return {front,back,reserve,deck,coins,alive:!!(flags&1),cpu:!!(flags&2),persona:personas[flags>>2]||null,miner:null};
      });
      const eventCount=number();
      if(eventCount>8192)throw Error('Invalid history');
      const truncated=!!byte();
      const historyEvents=[];
      for(let i=0;i<eventCount;i++){
        const type=byte();
        if(type===1){
          const owner=byte(),from=unpackSlot(byte()),to=unpackSlot(byte());
          if(!from.location||!to.location)throw Error('Invalid history');
          historyEvents.push({t:'swap',owner,from,to});
        } else if(type===2) historyEvents.push({t:'setupDone'});
        else if(type===3) historyEvents.push({t:'buy',card:card()});
        else if(type===4){
          const next=phases[byte()];
          if(!next)throw Error('Invalid history');
          historyEvents.push({t:'phase',phase:next});
        } else if(type===5){
          const actorCode=byte(),sourceCode=byte(),defender=byte(),targetCode=byte();
          const source={row:sourceCode&128?'back':'front',index:sourceCode&127};
          const target={row:targetCode&128?'back':'front',index:targetCode&127};
          const attackDice=dice(),defendDice=dice();
          const result=['tie','attack','defend'][byte()];
          if(!result)throw Error('Invalid history');
          const sacrificeCount=byte();
          if(sacrificeCount>2)throw Error('Invalid history');
          const sacrifice=Array.from({length:sacrificeCount},()=>({row:byte()?'back':'front',index:byte(),id:card()}));
          const attack={t:'attack',source,defender,target,attackDice,defendDice,result,sacrifice};
          if(actorCode!==255)attack.actor=actorCode;
          historyEvents.push(attack);
        } else if(type===6) historyEvents.push({t:'resolve'});
        else if(type===7) historyEvents.push({t:'finish'});
        else if(type===8) historyEvents.push({t:'refillDone'});
        else if(type===9) historyEvents.push({t:'income'});
        else if(type===12) historyEvents.push({t:'mine',card:card()});
        else if(type===13) historyEvents.push({t:'adjust'});
        else if(type===10){
          const owner=byte(),board=ranksPacked(boardCount,owner),reserve=ranksPacked(byte(),owner);
          historyEvents.push({t:'arrangeSet',owner,front:board.slice(0,lineLen),back:board.slice(lineLen),reserve});
        } else if(type===11){
          const snapTurn=byte(),snapSetup=byte(),snapPhase=phases[byte()],snapView=byte(),snapRound=number();
          if(!snapPhase)throw Error('Invalid history');
          const snapAttacks=byte(),snapKills=byte(),snapTurnNumber=number(),snapFirst=legacyHistory?0:byte();
          const snapPlayers=Array.from({length:count},(_,i)=>{
            const flags=byte(),coins=number();
            const board=ranksPacked(boardCount,i),front=board.slice(0,lineLen),back=board.slice(lineLen);
            const reserve=ranksPacked(byte(),i),deck=ranksPacked(byte(),i);
            return {front,back,reserve,deck,coins,alive:!!(flags&1),cpu:!!(flags&2),persona:personas[flags>>2]||null,miner:null};
          });
          historyEvents.push({t:'sync',origin:{turn:snapTurn,setup:snapSetup,phase:snapPhase,view:snapView===255?null:snapView,round:snapRound,actions:snapAttacks,kills:snapKills,turnNumber:snapTurnNumber,first:snapFirst,players:snapPlayers}});
        } else throw Error('Unknown history event');
      }
      history={origin:{turn:originTurn,setup:originSetup,phase:originPhase,view:originView===255?null:originView,round:originRound,actions:originAttacks,kills:originKills,turnNumber:originTurnNumber,first:originFirst,players:originPlayers},events:historyEvents};
      if(truncated)history.truncated=true;
    }
    if(at!==data.length-4)throw Error('Unexpected match data');
    players.forEach((p,i)=>{p.emoji??=emojis[i%emojis.length];});
    return {version:1,layout,queenRule,mode,players,turn,round,phase,setup,view:viewCode===255?null:viewCode,
      selection:selectionCode===255?null:{location:['front','back','reserve'][selectionCode],index:selectionIndex},
      actions,usedAttacker,scout,memory,kills,pending,refill,refillIndex,refillUndo,matchId,turnNumber,first,currentBattles,lastBattles,message,log,history,startedAt,restoreNotices,finishedAt,scoreVersion};
    } catch(error) {
      // Build 50 added opening-seat bytes to replay snapshots without changing the
      // outer B1 marker. Try the prior snapshot shape before rejecting that save.
      if(!legacyHistory)return decode(encoded,true);
      throw error;
    }
  }
  return {encode,decode,emojis};
})();
