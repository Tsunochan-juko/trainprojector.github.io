/* Wavefront OBJ/MTL. Units and UV direction follow RTM's ObjModel loader. */
(() => {
  'use strict';
  const TP=globalThis.TP ||= {};
  const tokens=s=>[...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m=>m[1]??m[2]??m[3]);
  TP.parseOBJ=text=>{
    const vertices=[],uvs=[],normals=[],objects=[],materials=[],libraries=[];
    let current,material=0,smoothing=1;
    const ensureMaterial=name=>{let i=materials.findIndex(m=>m.name===name);if(i<0){i=materials.length;materials.push({name,color:[1,1,1,1]});}return i;};
    const makeObject=name=>{const o={name,vertices,faces:[],visible:true,shading:1,facet:180,scale:[1,1,1],rotation:[0,0,0],translation:[0,0,0],mirror:0,depth:0};objects.push(o);return o;};
    ensureMaterial('default');current=makeObject('default');
    const index=(value,array)=>{const n=Number(value);if(!Number.isInteger(n)||!n)throw Error('OBJの頂点インデックスが不正です。');const i=n>0?n-1:array.length+n;if(i<0||i>=array.length)throw Error('OBJの頂点インデックスが範囲外です。');return i;};
    for(const raw of text.replace(/\\\r?\n/g,' ').split(/\r?\n/)){
      const line=raw.replace(/\s+#.*$/,'').trim();if(!line||line[0]==='#')continue;
      const split=line.search(/\s/),key=split<0?line:line.slice(0,split),value=split<0?'':line.slice(split+1).trim(),parts=value.split(/\s+/);
      if(key==='v'||key==='vt'||key==='vn'){
        const v=parts.map(Number),minimum=key==='vt'?2:3;if(v.length<minimum||v.slice(0,minimum).some(n=>!Number.isFinite(n)))throw Error('OBJの数値が不正です：'+line);
        if(key==='v')vertices.push(v.slice(0,3));else if(key==='vn')normals.push(v.slice(0,3));else uvs.push([v[0],1-v[1]]);
      }else if(key==='o'||key==='g')current=makeObject(value||'default');
      else if(key==='usemtl')material=ensureMaterial(value);
      else if(key==='mtllib')libraries.push(...tokens(value));
      else if(key==='s')smoothing=/^(off|0)$/i.test(value)?0:value;
      else if(key==='f'){
        const ids=[],uv=[],ns=[];
        for(const part of parts){const [v,t,n]=part.split('/');ids.push(index(v,vertices));uv.push(...(t?uvs[index(t,uvs)]:[0,0]));ns.push(n?normals[index(n,normals)]:null);}
        if(ids.length<3)throw Error('OBJの面には3頂点以上が必要です。');
        current.faces.push({ids,uv,normals:ns,material,smoothing});
      }
    }
    if(!objects.some(o=>o.faces.length))throw Error('OBJに面がありません。');
    return {format:'obj',units:1,materials,objects:objects.filter(o=>o.faces.length),libraries};
  };
  TP.parseMTL=text=>{
    const materials=[];let current=null;
    for(const raw of text.split(/\r?\n/)){
      const line=raw.replace(/\s+#.*$/,'').trim(),match=line.match(/^(\S+)\s+(.*)$/);if(!match)continue;
      const [,key,value]=match;
      if(key==='newmtl'){current={name:value,color:[1,1,1,1]};materials.push(current);}
      else if(current&&key==='Kd'){const color=value.split(/\s+/).map(Number);if(color.length>=3&&color.slice(0,3).every(Number.isFinite))current.color.splice(0,3,...color.slice(0,3));}
      else if(current&&(key==='d'||key==='Tr')){const alpha=Number(value.replace(/^-halo\s+/,''));if(Number.isFinite(alpha))current.color[3]=key==='Tr'?1-alpha:alpha;}
      else if(current&&key.toLowerCase()==='map_kd'){
        const args=tokens(value);let i=0;
        while(i<args.length&&args[i].startsWith('-')){const flag=args[i++];if(['-o','-s','-t'].includes(flag)){let n=0;while(n<3&&i<args.length&&Number.isFinite(Number(args[i]))){i++;n++;}}else i+=flag==='-mm'?2:1;}
        current.texture=args.slice(i).join(' ');
      }
    }
    return materials;
  };
})();
