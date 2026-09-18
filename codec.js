/* Versioned binary match format. No JSON is used for new saves or links. */
const StateCodec = (() => {
  const phases=['setup','buy','arrange','attack','battle','queen','refill','income','victory','stalemate'];
  const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8',{fatal:true});
  const cardCode=id => id==null?255:Number(id.split('-')[0])*16+ranks.indexOf(id.split('-')[1]);
  const cardFrom=code => code===255?null:`${code>>4}-${ranks[code&15]}`;
  function encode(state) {
    const out=[0x52,0x47,1];
    const byte=n=>out.push(n&255);
    const number=n=>{ n=Number(n)>>>0; while(n>=128){byte((n&127)|128);n>>>=7;} byte(n); };
    const string=s=>{const data=encoder.encode(s||'');number(data.length);for(const n of data) byte(n);};
    const card=id=>byte(cardCode(id));
    const ranksPacked=ids=>{for(let i=0;i<ids.length;i+=2){const a=ids[i]==null?15:ranks.indexOf(ids[i].split('-')[1]);const b=ids[i+1]==null?15:ranks.indexOf(ids[i+1].split('-')[1]);byte(a|(b<<4));}};
    const dice=values=>{byte(values.length);for(const n of values)byte(n);};
    byte(state.mode==='solo'?0:state.mode==='text'?2:1);byte(state.players.length);byte(state.turn);number(state.round);
    byte(phases.indexOf(state.phase));byte(state.setup);byte(state.view==null?255:state.view);
    byte(state.selection?['front','back','reserve'].indexOf(state.selection.location):255);
    byte(state.selection?.index??255);byte(state.attacks);byte(state.kills);
    byte(state.refill.length);for(const i of state.refill)byte(i);byte(state.refillIndex);
    for(const p of state.players) {
      string(p.name);byte((p.alive?1:0)|(p.cpu?2:0));number(p.coins);
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
    // Detect accidental truncation/corruption. This is not a security signature.
    let check=2166136261;
    for(const n of out)check=Math.imul(check^n,16777619)>>>0;
    for(let i=0;i<4;i++)byte(check>>>(i*8));
    const binary=String.fromCharCode(...out);
    return 'B1.'+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decode(encoded) {
    if(typeof encoded!=='string'||!encoded.startsWith('B1.'))throw Error('Unknown match format');
    if(encoded.length>32768)throw Error('Match link too large');
    const value=encoded.slice(3).replace(/-/g,'+').replace(/_/g,'/');
    const data=Uint8Array.from(atob(value),ch=>ch.charCodeAt(0));
    if(data.length<8||data.length>24576)throw Error('Invalid match size');
    let check=2166136261;
    for(let i=0;i<data.length-4;i++)check=Math.imul(check^data[i],16777619)>>>0;
    const expected=(data[data.length-4]|data[data.length-3]<<8|data[data.length-2]<<16|data[data.length-1]<<24)>>>0;
    if(check!==expected)throw Error('Match checksum mismatch');
    let at=0;
    const byte=()=>{if(at>=data.length-4)throw Error('Truncated match');return data[at++];};
    const number=()=>{let n=0,shift=0,v;do{v=byte();n|=(v&127)<<shift;shift+=7;if(shift>35)throw Error('Invalid number');}while(v&128);return n>>>0;};
    const string=()=>{const length=number();if(length>65536||at+length>data.length-4)throw Error('Invalid text');const s=decoder.decode(data.slice(at,at+length));at+=length;return s;};
    const card=()=>{const code=byte();if(code!==255&&((code>>4)>3||(code&15)>12))throw Error('Invalid card');return cardFrom(code);};
    const ranksPacked=(count,owner)=>{const ids=[];for(let i=0;i<count;i+=2){const pair=byte();for(const nibble of [pair&15,pair>>4])if(ids.length<count){if(nibble!==15&&nibble>12)throw Error('Invalid rank');ids.push(nibble===15?null:`${owner}-${ranks[nibble]}`);}}return ids;};
    const dice=()=>{const count=byte();if(count>3)throw Error('Invalid dice');return Array.from({length:count},byte);};
    if(byte()!==0x52||byte()!==0x47||byte()!==1)throw Error('Unknown match version');
    const modeCode=byte(),mode=['solo','local','text'][modeCode],count=byte(),turn=byte(),round=number();
    if(!mode)throw Error('Invalid mode');
    if(count<2||count>4||turn>=count)throw Error('Invalid players');
    const phase=phases[byte()],setup=byte(),viewCode=byte(),selectionCode=byte(),selectionIndex=byte();
    if(!phase)throw Error('Invalid phase');
    const attacks=byte(),kills=byte(),refillCount=byte();
    const refill=Array.from({length:refillCount},byte),refillIndex=byte();
    const players=Array.from({length:count},(_,i)=>{
      const name=string(),flags=byte(),coins=number();
      const board=ranksPacked(6,i),front=board.slice(0,3),back=board.slice(3);
      const reserve=ranksPacked(byte(),i),deck=ranksPacked(byte(),i);
      return {name,suit:i,cpu:!!(flags&2),alive:!!(flags&1),coins,front,back,reserve,deck};
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
    let matchId='',turnNumber=1,currentBattles=[],lastBattles=[];
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
          const beforeActor=ranksPacked(6,actor),beforeDefender=ranksPacked(6,defender);
          return {actor,defender,source,target,attackCard,defendCard,attackDice,defendDice,result,sacrifice,beforeActor,beforeDefender};
        });
      };
      currentBattles=events();lastBattles=events();
    }
    if(at!==data.length-4)throw Error('Unexpected match data');
    return {version:1,mode,players,turn,round,phase,setup,view:viewCode===255?null:viewCode,
      selection:selectionCode===255?null:{location:['front','back','reserve'][selectionCode],index:selectionIndex},
      attacks,kills,pending,refill,refillIndex,refillUndo,matchId,turnNumber,currentBattles,lastBattles,message,log};
  }
  return {encode,decode};
})();
