/* Local ZIP reader: central directory, STORE / DEFLATE, lazy extraction. */
(() => {
  'use strict';
  const TP = globalThis.TP ||= {};
  TP.decode = bytes => {
    if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le').decode(bytes);
    if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
    catch { return new TextDecoder('shift-jis').decode(bytes); }
  };
  TP.path = value => {
    const out=[];
    for (const bit of String(value).replace(/\\/g,'/').split('/')) {
      if (!bit || bit==='.') continue;
      if (bit==='..') out.pop(); else out.push(bit);
    }
    return out.join('/');
  };
  TP.json = text => {
    // RTM packs sometimes contain comments and trailing commas. Preserve quoted text.
    let out='', quoted=false, escaped=false;
    for(let i=0;i<text.length;i++) {
      const c=text[i], next=text[i+1];
      if(quoted) { out+=c; if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue; }
      if(c==='"') { quoted=true; out+=c; continue; }
      if(c==='/' && next==='/') { while(i<text.length && text[i]!=='\n') i++; out+='\n'; continue; }
      if(c==='/' && next==='*') { i+=2; while(i<text.length && !(text[i]==='*' && text[i+1]==='/')) i++; i++; out+=' '; continue; }
      if(c===',') { let j=i+1; while(/\s/.test(text[j]||'') && j<text.length) j++; if(text[j]===']'||text[j]==='}') continue; }
      out+=c;
    }
    // A comment can sit between a trailing comma and the closing bracket.
    let clean='';quoted=false;escaped=false;
    for(let i=0;i<out.length;i++){
      const c=out[i];if(quoted){clean+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"')quoted=true;
      if(c===','){let j=i+1;while(j<out.length&&/\s/.test(out[j]))j++;if(out[j]===']'||out[j]==='}')continue;}
      clean+=c;
    }
    return JSON.parse(clean.replace(/^\uFEFF/,''));
  };
  const crcTable = Uint32Array.from({length:256},(_,i)=>{let n=i;for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc32 = a => {let n=0xffffffff;for(const v of a)n=crcTable[(n^v)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
  class ZipArchive {
    static async open(file) {
      const z=new ZipArchive(); z.name=file.name; z.file=file; z.bytes=new Uint8Array(await file.arrayBuffer());
      const a=z.bytes, v=new DataView(a.buffer,a.byteOffset,a.byteLength); let end=-1;
      for(let i=a.length-22;i>=Math.max(0,a.length-65557);i--) if(v.getUint32(i,true)===0x06054b50 && i+22+v.getUint16(i+20,true)===a.length){end=i;break;}
      if(end<0) throw Error(file.name+'：ZIPの終端が見つかりません。');
      let count=v.getUint16(end+10,true), central=v.getUint32(end+16,true);
      if(v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('分割されたZIPには対応していません。');
      const u64=offset=>{if(offset<0||offset+8>a.length)throw Error('ZIP64の範囲が不正です。');const n=Number(v.getBigUint64(offset,true));if(!Number.isSafeInteger(n))throw Error('ZIP64のサイズがブラウザの上限を超えています。');return n;};
      if(count===65535||central===0xffffffff){
        if(end<20||v.getUint32(end-20,true)!==0x07064b50)throw Error('ZIP64の終端が不正です。');
        const pos=u64(end-12);if(pos+56>a.length||v.getUint32(pos,true)!==0x06064b50)throw Error('ZIP64の一覧が不正です。');
        if(v.getUint32(pos+16,true)||v.getUint32(pos+20,true))throw Error('分割されたZIP64には対応していません。');
        count=u64(pos+32);central=u64(pos+48);
      }
      z.entries=[]; let p=central;
      for(let i=0;i<count;i++) {
        if(p+46>a.length||v.getUint32(p,true)!==0x02014b50) throw Error('ZIPのファイル一覧が壊れています。');
        const flags=v.getUint16(p+8,true), method=v.getUint16(p+10,true), crc=v.getUint32(p+16,true), nl=v.getUint16(p+28,true), el=v.getUint16(p+30,true), cl=v.getUint16(p+32,true);
        let packed=v.getUint32(p+20,true),size=v.getUint32(p+24,true),offset=v.getUint32(p+42,true),name=TP.path(TP.decode(a.subarray(p+46,p+46+nl)));
        if(p+46+nl+el+cl>a.length)throw Error('ZIPのファイル名・付加情報が範囲外です。');
        for(let ex=p+46+nl;ex+4<=p+46+nl+el;){const id=v.getUint16(ex,true),len=v.getUint16(ex+2,true);if(ex+4+len>p+46+nl+el)throw Error('ZIPの付加情報が不正です。');
          if(id===1){let at=ex+4;const take=()=>{if(at+8>ex+4+len)throw Error('ZIP64のサイズ情報が不足しています。');const n=u64(at);at+=8;return n;};if(size===0xffffffff)size=take();if(packed===0xffffffff)packed=take();if(offset===0xffffffff)offset=take();}
          if(id===0x7075&&len>=5&&a[ex+4]===1&&v.getUint32(ex+5,true)===crc32(a.subarray(p+46,p+46+nl)))name=TP.path(new TextDecoder('utf-8').decode(a.subarray(ex+9,ex+4+len)));
          ex+=4+len;
        }
        if(packed===0xffffffff||size===0xffffffff||offset===0xffffffff)throw Error('ZIP64のサイズ情報が不足しています。');
        if(name && a[p+46+nl-1]!==47) z.entries.push({zip:z,name,size,read:async()=>{
          if(flags&1)throw Error(name+'：暗号化ZIPには対応していません。');
          if(size>268435456)throw Error(name+'：1ファイルが256MBを超えています。');
          if(offset+30>a.length||v.getUint32(offset,true)!==0x04034b50)throw Error('ZIPのファイルヘッダーが壊れています。');
          const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);
          if(start+packed>a.length)throw Error('ZIPのファイル範囲が不正です。');
          let bytes=a.subarray(start,start+packed);
          if(method===8) {
            let ds;try {ds=new DecompressionStream('deflate-raw');} catch {throw Error('このブラウザはZIP展開に未対応です。新しいChromeまたはEdgeで開いてください。');}
            const reader=new Blob([bytes]).stream().pipeThrough(ds).getReader(), chunks=[];let length=0;
            try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>size||length>268435456)throw Error('ZIPの展開サイズが不正です。');chunks.push(r.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
            bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
          } else if(method!==0) throw Error(name+'：ZIPの圧縮方式 '+method+' は未対応です。');
          if(bytes.length!==size||crc32(bytes)!==crc)throw Error(name+'：ZIPの整合性確認に失敗しました。');
          return bytes;
        }});
        p+=46+nl+el+cl;
      }
      return z;
    }
  }
  TP.ZipArchive=ZipArchive;
  class Assets {
    constructor(){this.archives=[];this.entries=[];this.cache=new Map();this.index=new Map();}
    add(zip){
      this.archives.push(zip);
      for(const entry of zip.entries){
        if(/(^|\/)__MACOSX\//.test(entry.name))continue;
        const match=entry.name.match(/^(.*?assets\/)([^/]+)\/(.*)$/i),legacy=entry.name.match(/^(.*?)(models|textures|json|scripts)\/(.+)$/i);
        if(match){entry.root=match[1]+match[2]+'/';entry.namespace=match[2].toLowerCase();entry.relative=match[3];}
        else if(legacy){entry.root=legacy[1];entry.namespace='minecraft';entry.relative=legacy[2]+'/'+legacy[3];}
        else if(/\.(json|mqo|obj|mqoz|mtl|png|mcmeta)$/i.test(entry.name)){entry.root='';entry.namespace='minecraft';entry.relative=/\.(mqo|obj|mqoz|mtl)$/i.test(entry.name)?'models/'+entry.name:entry.name;}
        else continue;
        this.entries.push(entry);const key=(entry.namespace+'/'+entry.relative).toLowerCase();if(!this.index.has(key))this.index.set(key,[]);this.index.get(key).push(entry);
      }
      this.cache.clear();
    }
    resolve(reference,owner,kind='') {
      if(!reference)return null;
      let ref=String(reference).replace(/\\/g,'/'), namespace='minecraft',explicit=false;
      if(ref.includes(':')) {const colon=ref.indexOf(':');namespace=ref.slice(0,colon);ref=ref.slice(colon+1);explicit=true;}
      ref=TP.path(ref);
      if(ref.startsWith('assets/')){const bits=ref.split('/');namespace=bits[1];ref=bits.slice(2).join('/');explicit=true;}
      if(kind&&!ref.startsWith(kind+'/'))ref=kind+'/'+ref;
      for(const ns of explicit?[namespace]:[namespace,owner?.namespace].filter(Boolean)){
        const choices=this.index.get((ns+'/'+ref).toLowerCase())||[],exact=choices.filter(e=>e.relative===ref),candidates=exact.length?exact:choices;
        const result=candidates.find(e=>e.zip===owner?.zip&&e.root===owner?.root)||candidates.at(-1);if(result)return result;
      }
      return null;
    }
    relative(reference,owner){if(!owner)return null;if(/^[^/]+:|^assets\//.test(reference))return this.resolve(reference,owner);return this.resolve(owner.namespace+':'+TP.path(owner.relative.slice(0,owner.relative.lastIndexOf('/')+1)+reference),owner);}
    async text(entry){if(!entry)throw Error('ファイルが見つかりません。');return TP.decode(await entry.read());}
    clear(){this.archives=[];this.entries=[];this.cache.clear();this.index.clear();}
  }
  TP.Assets=Assets;
})();
