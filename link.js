/* Single-URL, casually private handoffs. The key rides in the link: not authentication. */
const LinkCodec=(()=>{
  const MAX=98304;
  const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const from64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),ch=>ch.charCodeAt(0));
  async function seal(value){
    if(typeof value!=='string'||value.length>65536)throw Error('Match too large to share');
    const secret=crypto.getRandomValues(new Uint8Array(32));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['encrypt']);
    let body;
    if(value.startsWith('B1.')){
      const bytes=from64(value.slice(3));body=new Uint8Array(bytes.length+1);body[0]=1;body.set(bytes,1);
    } else if(/^P1:[0-3]:B1\./.test(value)){
      const seat=Number(value[3]),bytes=from64(value.slice(8));body=new Uint8Array(bytes.length+2);body[0]=2;body[1]=seat;body.set(bytes,2);
    } else body=new TextEncoder().encode(value);
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,body));
    const out=new Uint8Array(secret.length+iv.length+cipher.length);
    out.set(secret);out.set(iv,secret.length);out.set(cipher,secret.length+iv.length);
    return 'E1.'+(base64url(out).match(/.{1,180}/g)||[]).join('.');
  }
  async function open(token){
    if(typeof token!=='string'||!token.startsWith('E1.')||token.length>MAX)throw Error('Invalid share link');
    const data=from64(token.slice(3).replace(/[.\s\u200b-\u200d\ufeff]/g,''));
    if(data.length<61||data.length>49152)throw Error('Invalid share link');
    const key=await crypto.subtle.importKey('raw',data.slice(0,32),'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(32,44)},key,data.slice(44));
    const bytes=new Uint8Array(plain);
    if(bytes[0]===1)return 'B1.'+base64url(bytes.slice(1));
    if(bytes[0]===2&&bytes[1]<=3)return `P1:${bytes[1]}:B1.`+base64url(bytes.slice(2));
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  return {seal,open};
})();
