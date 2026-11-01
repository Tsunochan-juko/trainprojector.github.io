/* MQO text geometry. Source data stays in the archive; preview geometry is separate. */
(() => {
  'use strict';
  const TP=globalThis.TP ||= {};
  const numbers=s=>(s||'').trim().split(/\s+/).filter(Boolean).map(Number);
  TP.parseMQO = text => {
    if(!/Metasequoia Document/.test(text))throw Error('MQOのテキスト形式ではありません。');
    const starts=[...text.matchAll(/^\s*Object\s+"([^"]+)"\s*\{/gm)];
    if(!starts.length)throw Error('MQOにオブジェクトがありません。');
    const prefix=text.slice(0,starts[0].index), mb=prefix.match(/\bMaterial\s+\d+\s*\{([\s\S]*?)^\s*\}/m);
    const materials=(mb?.[1]||'').split(/\r?\n/).map(line=>{
      const name=line.match(/^\s*"([^"]*)"/);if(!name)return null;
      return {name:name[1],color:numbers(line.match(/\bcol\(([^)]+)\)/)?.[1]||'1 1 1 1'),texture:line.match(/\btex\("([^"]+)"\)/)?.[1]};
    }).filter(Boolean);
    const objects=starts.map((match,i)=>{
      const block=text.slice(match.index,starts[i+1]?.index??text.length), prop=(name,fallback)=>numbers(block.match(new RegExp('^\\s*'+name+'\\s+([^\\r\\n]+)','m'))?.[1]||fallback);
      const vb=block.match(/\bvertex\s+(\d+)\s*\{\s*\n([\s\S]*?)^\s*\}/m), fb=block.match(/\bface\s+(\d+)\s*\{\s*\n([\s\S]*?)^\s*\}/m);
      if(!vb||!fb)throw Error('MQOの頂点／面を読み取れません：'+match[1]);
      const vertices=vb[2].trim()?vb[2].trim().split(/\r?\n/).map(numbers):[];
      const faces=fb[2].split(/\r?\n/).map(line=>{
        const ids=line.match(/\bV\(([^)]+)\)/);if(!ids)return null;
        return {ids:numbers(ids[1]),material:Number(line.match(/\bM\((\d+)\)/)?.[1]||0),uv:numbers(line.match(/\bUV\(([^)]+)\)/)?.[1])};
      }).filter(f=>f&&f.ids.length>=3);
      if(vertices.length!==Number(vb[1]))throw Error('MQO頂点数が一致しません：'+match[1]);
      if(vertices.some(v=>v.length!==3||v.some(x=>!Number.isFinite(x)))||faces.some(f=>f.ids.some(id=>id<0||id>=vertices.length)))throw Error('MQOの頂点データが不正です：'+match[1]);
      return {name:match[1],vertices,faces,visible:prop('visible','15')[0]!==0,shading:prop('shading','1')[0],facet:prop('facet','59.5')[0],scale:prop('scale','1 1 1'),rotation:prop('rotation','0 0 0'),translation:prop('translation','0 0 0'),mirror:prop('mirror','0')[0],mirrorAxis:prop('mirror_axis','1')[0],depth:prop('depth','0')[0]};
    });
    return {format:'mqo',units:.01,materials,objects};
  };
  const unit=v=>{const l=Math.hypot(...v)||1;return v.map(n=>n/l);};
  const faceNormal=(a,b,c)=>unit([(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])]);
  function transform(v,o,normal=false){
    let [x,y,z]=v.map((n,i)=>normal?n/(o.scale[i]||1):n*o.scale[i]);
    const [rx,ry,rz]=o.rotation;let c=Math.cos(rx),s=Math.sin(rx);[y,z]=[y*c-z*s,y*s+z*c];c=Math.cos(ry);s=Math.sin(ry);[x,z]=[x*c+z*s,-x*s+z*c];c=Math.cos(rz);s=Math.sin(rz);[x,y]=[x*c-y*s,x*s+y*c];
    return normal?unit([x,y,z]):[x,y,z].map((n,i)=>n+o.translation[i]);
  }
  // Ear clipping handles concave polygons as well as triangles and quads.
  TP.triangulate=(ids,vertices)=>{
    if(ids.length===3)return [[0,1,2]];
    const n=[0,0,0];for(let i=0;i<ids.length;i++){const a=vertices[ids[i]],b=vertices[ids[(i+1)%ids.length]];n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);}
    const drop=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),axes=[0,1,2].filter(i=>i!==drop),p=ids.map(i=>axes.map(k=>vertices[i][k]));
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const area=p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0),sign=area>=0?1:-1,remaining=ids.map((_,i)=>i),triangles=[];
    const epsilon=Math.max(...p.flat().map(Math.abs),1)**2*1e-12;
    while(remaining.length>3){let cut=false;
      for(let j=0;j<remaining.length;j++){const a=remaining[(j+remaining.length-1)%remaining.length],b=remaining[j],c=remaining[(j+1)%remaining.length];if(cross(p[a],p[b],p[c])*sign<=epsilon)continue;
        if(remaining.some(k=>k!==a&&k!==b&&k!==c&&cross(p[a],p[b],p[k])*sign>=-epsilon&&cross(p[b],p[c],p[k])*sign>=-epsilon&&cross(p[c],p[a],p[k])*sign>=-epsilon))continue;
        triangles.push([a,b,c]);remaining.splice(j,1);cut=true;break;
      }
      if(!cut){for(let j=1;j<remaining.length-1;j++)triangles.push([remaining[0],remaining[j],remaining[j+1]]);return triangles;}
    }
    triangles.push(remaining);return triangles;
  };
  TP.geometry=(model,{smoothing=true,offset=[0,0,0],globalOffset=[0,0,0],scale=1,reverse=false,prefix=''}={})=>{
    const parts=[],warnings=[],chain=[];
    for(const o of model.objects){
      chain.length=Math.max(0,o.depth||0);const parents=chain.filter(Boolean).reverse();chain[o.depth||0]=o;
      const converted=(v,normal=false)=>{let result=transform(v,o,normal);for(const parent of parents)result=transform(result,parent,normal);return normal?result:result.map(v=>v*(model.units??.01));};
      const normals=o.faces.map(f=>faceNormal(...(model.format==='obj'?[f.ids[0],f.ids[1],f.ids[2]]:[f.ids[0],f.ids[2],f.ids[1]]).map(i=>o.vertices[i]))),adj=new Map();
      if(smoothing&&o.shading) o.faces.forEach((f,i)=>{for(const id of f.ids){if(!adj.has(id))adj.set(id,[]);adj.get(id).push(i);}});
      const groups=new Map(),cos=Math.cos(o.facet*Math.PI/180);
      const mirrors=[[1,1,1]];if(o.mirror)for(let axis=0;axis<3;axis++)if(o.mirrorAxis&(1<<axis)){for(const original of mirrors.slice()){const sign=original.slice();sign[axis]=-1;mirrors.push(sign);}}
      for(let fi=0;fi<o.faces.length;fi++){
        const f=o.faces[fi];if(!groups.has(f.material))groups.set(f.material,[]);const out=groups.get(f.material);
        for(const sign of mirrors){const reflected=[o,...parents].reduce((n,o)=>n*o.scale.reduce((s,v)=>s*v,1),sign.reduce((n,v)=>n*v,1))<0;
          for(const triangle of TP.triangulate(f.ids,o.vertices))for(const j of ((model.format!=='obj')!==reflected?[triangle[0],triangle[2],triangle[1]]:triangle)){
            const id=f.ids[j];let n=normals[fi];
            if(f.normals?.[j])n=f.normals[j];
            else if(smoothing&&o.shading&&f.smoothing!==0){const ns=adj.get(id).filter(i=>f.smoothing===undefined||o.faces[i].smoothing===f.smoothing).map(i=>normals[i]).filter(v=>v.reduce((s,x,k)=>s+x*n[k],0)>=cos);n=unit([0,1,2].map(k=>ns.reduce((s,v)=>s+v[k],0)));}
            n=converted(n.map((v,k)=>v*sign[k]),true);let v=converted(o.vertices[id].map((v,k)=>v*sign[k]));
            if(reverse){v=[-v[0],v[1],-v[2]];n=[-n[0],n[1],-n[2]];}
            v=v.map((v,k)=>(v+Number(offset[k]||0))*scale+Number(globalOffset[k]||0));
            out.push(...v,Number(f.uv[j*2]||0),Number(f.uv[j*2+1]||0),...n);
          }
        }
      }
      const batches=[...groups].map(([material,data])=>({material,data:new Float32Array(data)}));
      // RTM Parts.render() does not use the editor's visible flag. Many packs save
      // the entire body as hidden in MQO. Show geometry and let the user filter it.
      if(batches.length)parts.push({name:prefix+o.name,visible:true,batches});
    }
    return {parts,warnings:[...new Set(warnings)]};
  };
})();
