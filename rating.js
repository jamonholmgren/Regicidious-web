/* Personal, zero-sum Elo ledger. One compact result per finished solo match. */
const RatingCodec=(()=>{
  const layouts=['classic','expanded'],opponents=['serf','squire','knight'];
  const LIMIT=10000,K=32;
  function fromGame(g){
    if(g?.scoreVersion!==1||g.mode!=='solo'||g.phase!=='victory'||g.players?.length!==2||
      g.players[0].cpu||!g.players[1].cpu||g.players[0].alive===g.players[1].alive||
      !layouts.includes(g.layout)||!opponents.includes(g.players[1].persona)||
      !/^[a-f0-9]{32}$/.test(g.matchId||'')||!Number.isInteger(g.finishedAt)||g.finishedAt<1)return null;
    return {id:g.matchId,layout:g.layout,opponent:g.players[1].persona,won:g.players[0].alive,date:Math.floor(g.finishedAt/1000)};
  }
  function valid(e){return e&&/^[a-f0-9]{32}$/.test(e.id)&&layouts.includes(e.layout)&&opponents.includes(e.opponent)&&typeof e.won==='boolean'&&Number.isInteger(e.date)&&e.date>0&&e.date<=4000000000;}
  function merge(local,incoming){
    const byId=new Map(),conflicts=[];
    for(const e of [...local,...incoming]){
      if(!valid(e))throw Error('Invalid rating result');
      const old=byId.get(e.id);
      if(old){if(old.layout!==e.layout||old.opponent!==e.opponent||old.won!==e.won||old.date!==e.date)conflicts.push(e.id);}
      else byId.set(e.id,e);
    }
    if(byId.size>LIMIT)throw Error('Too many rating results');
    return {events:[...byId.values()].sort((a,b)=>a.date-b.date||a.id.localeCompare(b.id)),conflicts};
  }
  function standings(events){
    const ratings={human:1000,serf:800,squire:1000,knight:1200};
    const records={human:{wins:0,losses:0},serf:{wins:0,losses:0},squire:{wins:0,losses:0},knight:{wins:0,losses:0}};
    const changes={};
    for(const e of merge([],events).events){
      const before=ratings.human,bot=ratings[e.opponent];
      const expected=1/(1+10**((bot-before)/400));
      const raw=K*((e.won?1:0)-expected);
      const delta=raw>0?Math.min(raw,bot):Math.max(raw,-before);
      ratings.human+=delta;ratings[e.opponent]-=delta;
      records.human[e.won?'wins':'losses']++;
      records[e.opponent][e.won?'losses':'wins']++;
      changes[e.id]={before,after:ratings.human,delta};
    }
    return {ratings,records,changes};
  }
  function encode(events){
    const list=merge([],events).events,out=[0x52,0x47,1];
    const byte=n=>out.push(n&255);
    const number=n=>{n>>>=0;while(n>=128){byte((n&127)|128);n>>>=7;}byte(n);};
    number(list.length);
    for(const e of list){
      for(let i=0;i<32;i+=2)byte(parseInt(e.id.slice(i,i+2),16));
      byte(layouts.indexOf(e.layout)|(opponents.indexOf(e.opponent)<<1)|(e.won?8:0));number(e.date);
    }
    let check=2166136261;for(const n of out)check=Math.imul(check^n,16777619)>>>0;
    for(let i=0;i<4;i++)byte(check>>>(8*i));
    const chunks=[];for(let i=0;i<out.length;i+=8192)chunks.push(String.fromCharCode(...out.slice(i,i+8192)));
    return 'R1.'+btoa(chunks.join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decode(token){
    if(typeof token!=='string'||!/^R1\.[A-Za-z0-9_-]+$/.test(token)||token.length>400000)throw Error('Invalid rating data');
    const data=Uint8Array.from(atob(token.slice(3).replace(/-/g,'+').replace(/_/g,'/')),ch=>ch.charCodeAt(0));
    if(data.length<8||data.length>300000)throw Error('Invalid rating data');
    let check=2166136261;for(let i=0;i<data.length-4;i++)check=Math.imul(check^data[i],16777619)>>>0;
    const expected=(data.at(-4)|data.at(-3)<<8|data.at(-2)<<16|data.at(-1)<<24)>>>0;
    if(check!==expected)throw Error('Rating checksum mismatch');
    let at=0;const byte=()=>{if(at>=data.length-4)throw Error('Truncated rating data');return data[at++];};
    const number=()=>{let n=0,shift=0,part;do{part=byte();n|=(part&127)<<shift;shift+=7;if(shift>35)throw Error('Invalid rating number');}while(part&128);return n>>>0;};
    if(byte()!==0x52||byte()!==0x47||byte()!==1)throw Error('Unknown rating version');
    const count=number();if(count>LIMIT)throw Error('Too many rating results');
    const events=[];
    for(let i=0;i<count;i++){
      let id='';for(let j=0;j<16;j++)id+=byte().toString(16).padStart(2,'0');
      const flags=byte(),date=number();if(flags>13||((flags>>1)&3)>2)throw Error('Invalid rating flags');
      const event={id,layout:layouts[flags&1],opponent:opponents[(flags>>1)&3],won:!!(flags&8),date};
      if(!valid(event))throw Error('Invalid rating result');events.push(event);
    }
    if(at!==data.length-4)throw Error('Unexpected rating data');
    return merge([],events).events;
  }
  return {fromGame,merge,standings,encode,decode};
})();
