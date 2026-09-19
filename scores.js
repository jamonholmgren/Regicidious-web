/* Compact, game-independent personal score records. No card state is included. */
const ScoreCodec=(()=>{
  const factors={serf:100,squire:115,knight:170,captain:130,warlord:150};
  const layouts=['classic','expanded'];
  const difficulties=Object.keys(factors);
  const textEncoder=new TextEncoder();
  const textDecoder=new TextDecoder('utf-8',{fatal:true});
  const MAX_PER_LAYOUT=50;
  function points(turns,difficulty){
    if(!Number.isInteger(turns)||turns<1||turns>2000000||!factors[difficulty])throw Error('Invalid score inputs');
    return Math.round((1000+Math.max(0,1000-50*(turns-1)))*factors[difficulty]/100);
  }
  function entryFromGame(g){
    if(g?.scoreVersion!==1||g.mode!=='solo'||g.phase!=='victory'||g.players?.length!==2||
      !g.players[0].alive||g.players[0].cpu||g.players[1].alive||!g.players[1].cpu||
      !layouts.includes(g.layout)||!difficulties.includes(g.players[1].persona)||
      !/^[a-f0-9]{32}$/.test(g.matchId||'')||!Number.isInteger(g.round)||g.round<2||
      !Number.isInteger(g.finishedAt)||g.finishedAt<1)return null;
    const turns=2*(g.round-2)+((g.turn-(g.first??0)+2)%2)+1;
    return {id:g.matchId,layout:g.layout,difficulty:g.players[1].persona,turns,
      score:points(turns,g.players[1].persona),date:Math.floor(g.finishedAt/1000),
      name:g.players[0].name.slice(0,24),emoji:g.players[0].emoji};
  }
  function valid(e){
    return e&&/^[a-f0-9]{32}$/.test(e.id)&&layouts.includes(e.layout)&&difficulties.includes(e.difficulty)&&
      Number.isInteger(e.turns)&&e.turns>=1&&e.turns<=2000000&&e.score===points(e.turns,e.difficulty)&&
      Number.isInteger(e.date)&&e.date>0&&e.date<=4000000000&&typeof e.name==='string'&&e.name.length<=24&&
      StateCodec.emojis.includes(e.emoji);
  }
  function ranked(entries){
    const byId=new Map();let conflicts=0;
    for(const e of entries){
      if(!valid(e))throw Error('Invalid score entry');
      const prior=byId.get(e.id);
      if(prior){
        if(prior.layout!==e.layout||prior.difficulty!==e.difficulty||prior.turns!==e.turns||prior.date!==e.date||prior.name!==e.name||prior.emoji!==e.emoji)conflicts++;
      } else byId.set(e.id,e);
    }
    const ordered=[...byId.values()].sort((a,b)=>b.score-a.score||a.turns-b.turns||b.date-a.date||a.id.localeCompare(b.id));
    const counts={classic:0,expanded:0};
    return {entries:ordered.filter(e=>++counts[e.layout]<=MAX_PER_LAYOUT),conflicts};
  }
  function merge(local,incoming){return ranked([...local,...incoming]);}
  function encode(entries){
    const list=ranked(entries).entries;
    const out=[0x52,0x53,1];
    const byte=n=>out.push(n&255);
    const number=n=>{n=Number(n)>>>0;while(n>=128){byte((n&127)|128);n>>>=7;}byte(n);};
    number(list.length);
    for(const e of list){
      for(let i=0;i<32;i+=2)byte(parseInt(e.id.slice(i,i+2),16));
      byte(layouts.indexOf(e.layout));byte(difficulties.indexOf(e.difficulty));
      number(e.turns);number(e.date);byte(StateCodec.emojis.indexOf(e.emoji));
      const name=textEncoder.encode(e.name);number(name.length);for(const n of name)byte(n);
    }
    let check=2166136261;for(const n of out)check=Math.imul(check^n,16777619)>>>0;
    for(let i=0;i<4;i++)byte(check>>>(8*i));
    return 'S1.'+btoa(String.fromCharCode(...out)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decode(token){
    if(typeof token!=='string'||!/^S1\.[A-Za-z0-9_-]+$/.test(token)||token.length>50000)throw Error('Invalid score backup');
    const data=Uint8Array.from(atob(token.slice(3).replace(/-/g,'+').replace(/_/g,'/')),ch=>ch.charCodeAt(0));
    if(data.length<8||data.length>40000)throw Error('Invalid score backup');
    let check=2166136261;for(let i=0;i<data.length-4;i++)check=Math.imul(check^data[i],16777619)>>>0;
    const expected=(data.at(-4)|data.at(-3)<<8|data.at(-2)<<16|data.at(-1)<<24)>>>0;
    if(check!==expected)throw Error('Score backup checksum mismatch');
    let at=0;const byte=()=>{if(at>=data.length-4)throw Error('Truncated score backup');return data[at++];};
    const number=()=>{let value=0,shift=0,n;do{n=byte();value|=(n&127)<<shift;shift+=7;if(shift>35)throw Error('Invalid score number');}while(n&128);return value>>>0;};
    if(byte()!==0x52||byte()!==0x53||byte()!==1)throw Error('Unsupported score backup');
    const count=number();if(count>MAX_PER_LAYOUT*2)throw Error('Too many scores');
    const entries=[];
    for(let i=0;i<count;i++){
      let id='';for(let j=0;j<16;j++)id+=byte().toString(16).padStart(2,'0');
      const layout=layouts[byte()],difficulty=difficulties[byte()],turns=number(),date=number(),emoji=StateCodec.emojis[byte()];
      const length=number();if(length>96||at+length>data.length-4)throw Error('Invalid score name');
      const name=textDecoder.decode(data.slice(at,at+length));at+=length;
      const e={id,layout,difficulty,turns,date,emoji,name,score:points(turns,difficulty)};
      if(!valid(e))throw Error('Invalid score entry');entries.push(e);
    }
    if(at!==data.length-4)throw Error('Unexpected score data');
    return ranked(entries).entries;
  }
  return {points,entryFromGame,merge,encode,decode,MAX_PER_LAYOUT};
})();
