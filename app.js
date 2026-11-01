(() => {
  'use strict';
  const TP=globalThis.TP,$=id=>document.getElementById(id),assets=new TP.Assets();
  let renderer,vehicles=[],selected=null,view='+X',busy=false,messages=[],lastError='',frame=0,renderValid=false,materialStyles=[];
  const edits=new Map(),materialKeys=['visible','alphaBlend','light','doubleSided','opacity'];
  const materialValues=m=>Object.fromEntries(materialKeys.map(key=>[key,m[key]]));
  function rememberEdits(){if(selected&&renderer)edits.set(selected.entry,{materials:Object.fromEntries(materialStyles.map(m=>[m.id,materialValues(m)])),parts:Object.fromEntries(renderer.parts.map(p=>[p.id,p.visible]))});}
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const log=text=>{if(!messages.includes(text))messages.push(text);};
  const status=(text,error=false)=>{$('render-status').textContent=text;$('render-status').classList.toggle('error',error);};
  function diagnostics(){const list=$('messages');list.replaceChildren();for(const text of messages.length?messages:['モデル・テクスチャに不足は見つかりませんでした。']){const li=document.createElement('li');li.textContent=text;list.append(li);}}
  function setBusy(value){busy=value;$('zip-files').disabled=value;$('reset').disabled=value||!assets.archives.length;$('search').disabled=value||!vehicles.length;$('download').disabled=value||!renderValid;$('material-fields').disabled=value||!materialStyles.length;$('part-fields').disabled=value||!renderer?.parts.length;document.querySelector('label[for="zip-files"]').style.pointerEvents=value?'none':'';for(const b of document.querySelectorAll('.vehicle'))b.disabled=value;}
  function showVehicles(){
    const term=$('search').value.toLowerCase(),list=$('vehicle-list');list.replaceChildren();
    const matches=vehicles.filter(v=>(v.name+' '+v.entry.name).toLowerCase().includes(term));$('vehicle-count').textContent=matches.length+' / '+vehicles.length;
    if(!matches.length){const p=document.createElement('p');p.className='empty-list';p.textContent=vehicles.length?'一致する車両がありません。':'車両のJSONが見つかりません。';list.append(p);}
    for(const vehicle of matches){const b=document.createElement('button');b.className='vehicle'+(selected===vehicle?' active':'');b.disabled=busy;b.setAttribute('aria-pressed',String(selected===vehicle));const name=document.createElement('strong'),file=document.createElement('small');name.textContent=vehicle.name;file.textContent=vehicle.entry.name.split('/').at(-1)+' · '+vehicle.normalized.capability;b.title=vehicle.entry.zip.name+' / '+vehicle.entry.name;file.title=b.title;b.append(name,file);b.onclick=()=>selectVehicle(vehicle);list.append(b);}
  }
  async function importZips(files){
    if(busy)return;
    const inputs=Array.from(files).filter(f=>/\.(zip|jar)$/i.test(f.name));if(!inputs.length){$('load-status').textContent='ZIPまたはJARファイルを選択してください。';return;}
    setBusy(true);const errors=[];let added=0;
    try{
      async function addArchive(file,depth=0){
        if(assets.archives.some(a=>a.name===file.name&&a.file.size===file.size&&a.file.lastModified===file.lastModified))return;
        $('load-status').textContent=file.name+' を読み込んでいます…';await nextFrame();
        try{const archive=await TP.ZipArchive.open(file);assets.add(archive);added++;
          for(const inner of archive.entries.filter(e=>/\.(zip|jar)$/i.test(e.name)&&!/(^|\/)assets\//i.test(e.name))){
            if(depth>=2){errors.push(inner.name+'：入れ子が深いため、展開して個別に読み込んでください。');continue;}
            await addArchive(new File([await inner.read()],inner.name,{lastModified:file.lastModified}),depth+1);
          }
        }catch(e){errors.push(file.name+'：'+e.message);}
      }
      for(const file of inputs)await addArchive(file);
      $('load-status').textContent='車両のJSONを探しています…';await nextFrame();
      const prior=selected;vehicles=[];lastError='';
      for(const entry of assets.entries.filter(e=>/\.json$/i.test(e.relative)&&!e.relative.includes('__MACOSX'))){
        if(entry.size>16777216){if(/ModelTrain/i.test(entry.name))errors.push(entry.name+'：JSONが16MBを超えています。');continue;}
        try{const cfg=TP.json(await assets.text(entry)),normalized=TP.trainConfig(cfg,entry.name);if(normalized)vehicles.push({entry,cfg,normalized,name:normalized.name});}
        catch(e){if(/ModelTrain/i.test(entry.name))errors.push(entry.name+'：'+e.message);}
      }
      vehicles.sort((a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true}));selected=null;showVehicles();
      const size=assets.archives.reduce((n,z)=>n+z.file.size,0)/1048576;
      lastError=errors.length?' ／ '+errors.join(' ／ '):'';
      $('load-status').textContent=`${assets.archives.length} ZIP · ${size.toFixed(1)} MB · ${vehicles.length} 車両${added?' を読み込みました。':'（読み込み済み）'}${lastError}`;
      if(!vehicles.length){renderer?.dispose();materialStyles=[];showMaterials();showParts();renderValid=false;$('canvas').hidden=true;$('empty-preview').hidden=false;status('車両が見つかりません。車両JSONを含むパックを追加してください。',true);messages=errors;diagnostics();}
      setBusy(false);
      const first=vehicles.find(v=>v.entry===prior?.entry)||vehicles.find(v=>v.normalized.supported)||vehicles[0];if(first)await selectVehicle(first);
    }catch(e){$('load-status').textContent=e.message;setBusy(false);}
  }
  async function readModel(entry){
    if(assets.cache.has(entry)){const cached=assets.cache.get(entry);assets.cache.delete(entry);assets.cache.set(entry,cached);return cached;}
    let model;
    if(/\.mqo$/i.test(entry.name))model=TP.parseMQO(await assets.text(entry));
    else if(/\.mqoz$/i.test(entry.name)){
      const archive=await TP.ZipArchive.open(new File([await entry.read()],entry.name)),mqo=archive.entries.find(e=>/\.mqo$/i.test(e.name));
      if(!mqo)throw Error('MQOZの中にMQOがありません：'+entry.name);model=TP.parseMQO(TP.decode(await mqo.read()));
    }else if(/\.obj$/i.test(entry.name)){
      model=TP.parseOBJ(await assets.text(entry));model.missingLibraries=[];
      for(const lib of model.libraries.length?model.libraries:[entry.relative.split('/').at(-1).replace(/\.obj$/i,'.mtl')]){
        const mtl=assets.relative(lib,entry)||assets.resolve(lib,entry,'models');
        if(!mtl){if(model.libraries.length)model.missingLibraries.push(lib);continue;}
        for(const mat of TP.parseMTL(await assets.text(mtl))){const target=model.materials.find(m=>m.name===mat.name);if(target)Object.assign(target,mat,{textureOwner:mtl});}
      }
    }else throw Error('モデル形式が未対応です：'+entry.name);
    assets.cache.set(entry,model);if(assets.cache.size>3)assets.cache.delete(assets.cache.keys().next().value);return model;
  }
  async function selectVehicle(vehicle){
    if(busy)return;renderValid=false;setBusy(true);selected=vehicle;showVehicles();messages=[];materialStyles=[];$('material-search').value='';$('part-search').value='';showMaterials();status(vehicle.name+' を準備しています…');$('empty-preview').hidden=false;$('empty-preview').querySelector('p').textContent='モデルとテクスチャを読み込んでいます…';$('canvas').hidden=true;
    $('projection-title').textContent=vehicle.name;$('vehicle-detail').textContent=vehicle.entry.name.split('/').at(-1)+' · '+vehicle.entry.zip.name;
    try{
      await nextFrame();renderer ||= new TP.Renderer($('canvas'));renderer.dispose();
      const {cfg,entry,normalized}=vehicle,main=normalized.main;
      if(!normalized.supported)throw Error(normalized.capability+'。この車両は一覧表示のみ対応しています。');
      if(main.rendererPath)log('車両JS：'+main.rendererPath+'（実行しません。部品一覧で表示を調整できます。）');
      const textures=new Map();let missingTexture;
      async function material(binding,mat,modelEntry){
        const reference=binding?.[1]||mat?.texture;
        if(!reference)return {texture:renderer.solid(),color:mat?.color||[1,1,1,1]};
        // JSON paths are resource-root relative. MQO tex paths may be model-relative.
        let texEntry=binding?assets.resolve(reference,entry):assets.relative(reference,mat?.textureOwner||modelEntry)||assets.resolve(reference,entry);
        if(!texEntry){log('不足テクスチャ：'+reference+'（紫のチェックで表示）');missingTexture ||= renderer.solid(true);return {texture:missingTexture,color:[1,1,1,1]};}
        if(!textures.has(texEntry)){
          try{let meta={};const metaEntry=assets.resolve(texEntry.relative+'.mcmeta',texEntry);if(metaEntry)meta=TP.json(await assets.text(metaEntry)).texture||{};textures.set(texEntry,await renderer.texture(await texEntry.read(),meta));}
          catch(e){log('テクスチャ '+reference+'：'+e.message);missingTexture ||= renderer.solid(true);textures.set(texEntry,missingTexture);}
        }
        return {texture:textures.get(texEntry),color:binding?[1,1,1,1]:(mat?.color||[1,1,1,1]),alphaBlend:binding?/AlphaBlend/i.test(String(binding[2]||'')):true};
      }
      const parts=[];
      async function addModel(modelCfg,prefix,offset=[0,0,0],reverse=false){
        if(/\.class$/i.test(modelCfg.modelFile))throw Error(prefix+'はJava製モデルのため描画未対応です：'+modelCfg.modelFile);
        const modelEntry=assets.resolve(modelCfg.modelFile,entry,'models');if(!modelEntry)throw Error('不足モデル：'+modelCfg.modelFile+'。前提・共通パックを追加してください。');
        status(modelCfg.modelFile+' を読み込んでいます…');await nextFrame();const model=await readModel(modelEntry),bindings=modelCfg.textures||[];
        if(model.missingLibraries?.length&&model.materials.some(mat=>!bindings.some(b=>b[0]===mat.name||b[0]==='default')))log('不足MTL：'+model.missingLibraries.join('、')+'。JSONに割り当てのない材質は単色で表示します。');
        const materials=[];
        for(let m=0;m<Math.max(1,model.materials.length);m++){
          const mat=model.materials[m],binding=bindings.find(b=>b[0]===mat?.name)||bindings.find(b=>b[0]==='default'),mapped=await material(binding,mat,modelEntry);
          const style={id:prefix+m+':'+(mat?.name||'default'),name:prefix+(mat?.name||'default'),textureName:String(binding?.[1]||mat?.texture||'単色'),flags:String(binding?.[2]||''),visible:true,alphaBlend:binding?/AlphaBlend/i.test(String(binding[2]||'')):mapped.alphaBlend!==false,light:false,doubleSided:cfg.doCulling===false,opacity:Math.max(0,Math.min(1,mapped.color?.[3]??1))};
          style.initial=materialValues(style);Object.assign(style,edits.get(entry)?.materials[style.id]||{});mapped.style=style;materialStyles.push(style);materials.push(mapped);
        }
        const geo=TP.geometry(model,{smoothing:cfg.smoothing!==false,offset,globalOffset:normalized.offset,scale:normalized.scale,reverse,prefix});for(const w of [...(model.warnings||[]),...geo.warnings])log(w);
        for(let i=0;i<geo.parts.length;i++){const part=geo.parts[i];part.id=prefix+i+':'+part.name;part.initialVisible=part.visible;part.visible=edits.get(entry)?.parts[part.id]??part.visible;for(const batch of part.batches){const mat=materials[batch.material]||materials[0];Object.assign(batch,mat);}parts.push(part);}
        log(prefix+'モデル：'+modelCfg.modelFile+' / '+geo.parts.length+' 部品');
      }
      await addModel(main,'車体/');
      const bogies=normalized.bogies;
      for(let i=0;i<bogies.length;i++)if(bogies[i]?.modelFile){try{await addModel(bogies[i],`台車${i+1}/`,normalized.positions[i]||[0,0,0],i===1);}catch(e){log(e.message);}}
      const used=new Set(parts.flatMap(p=>p.batches.map(b=>b.style)));materialStyles=materialStyles.filter(m=>used.has(m));
      renderer.setScene(parts,cfg.doCulling!==false);showMaterials();showParts();diagnostics();$('empty-preview').hidden=true;$('canvas').hidden=false;draw();
    }catch(e){renderer?.dispose();materialStyles=[];showMaterials();showParts();status(e.message,true);log(e.message);diagnostics();$('diagnostics').open=true;$('empty-preview').hidden=false;$('empty-preview').querySelector('p').textContent=vehicle.normalized.supported?'読み込み情報を確認して、不足する前提パックを追加してください。':'この車両のモデル形式には未対応です。対応形式の車両を選択してください。';$('canvas').hidden=true;}
    finally{setBusy(false);}
  }
  function draw(){
    if(!renderer?.parts.length)return;
    try{const info=renderer.render(view,Number($('width').value));renderValid=!info.empty;$('download').disabled=busy||!renderValid;if(info.empty){status('表示中のパーツまたはマテリアルがありません。表示する項目を選んでください。');return;}status(`${info.width} × ${info.height} px · ${info.triangles.toLocaleString()} 三角形 · 背景透明`);}
    catch(e){renderValid=false;status(e.message,true);$('download').disabled=true;}
  }
  function scheduleDraw(){cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}
  function showMaterials(){
    const list=$('materials'),term=$('material-search').value.toLowerCase();list.replaceChildren();
    const matches=materialStyles.filter(m=>(m.name+' '+m.textureName).toLowerCase().includes(term));$('material-count').textContent=materialStyles.length?`${matches.length} / ${materialStyles.length}`:'';
    for(const mat of matches){
      const row=document.createElement('tr');row.dataset.materialId=mat.id;
      const toggle=(key,label)=>{const cell=document.createElement('td'),input=document.createElement('input');input.type='checkbox';input.checked=mat[key];input.dataset.setting=key;input.setAttribute('aria-label',mat.name+' '+label);input.onchange=()=>{mat[key]=input.checked;rememberEdits();scheduleDraw();};cell.append(input);return cell;};
      row.append(toggle('visible','表示'));
      const nameCell=document.createElement('td'),name=document.createElement('span'),texture=document.createElement('span');name.className='material-name';name.textContent=mat.name;texture.className='material-texture';texture.textContent=mat.textureName;nameCell.append(name,texture);
      if(mat.flags){const flags=document.createElement('span');flags.className='material-flags';flags.textContent='JSON: '+mat.flags;nameCell.append(flags);}row.append(nameCell,toggle('alphaBlend','AlphaBlend'),toggle('light','Light（陰影なし）'),toggle('doubleSided','両面描画'));
      const cell=document.createElement('td'),wrap=document.createElement('div'),input=document.createElement('input'),output=document.createElement('output');wrap.className='material-opacity';input.type='range';input.min=0;input.max=100;input.step=1;input.value=Math.round(mat.opacity*100);input.dataset.setting='opacity';input.setAttribute('aria-label',mat.name+' 不透明度');output.value=input.value+'%';input.oninput=()=>{mat.opacity=Number(input.value)/100;output.value=input.value+'%';rememberEdits();scheduleDraw();};wrap.append(input,output);cell.append(wrap);row.append(cell);list.append(row);
    }
  }
  function partSummary(){const all=renderer?.parts||[],term=$('part-search').value.toLowerCase(),matches=all.filter(p=>p.name.toLowerCase().includes(term));$('part-count').textContent=all.length?`表示 ${all.filter(p=>p.visible).length} / ${all.length}`+(term?` · 検索 ${matches.length} 件`:''):'';}
  function showParts(){
    const list=$('parts'),term=$('part-search').value.toLowerCase();list.replaceChildren();
    const matches=(renderer?.parts||[]).filter(p=>p.name.toLowerCase().includes(term));partSummary();
    for(const part of matches){const label=document.createElement('label'),input=document.createElement('input');label.className='part';input.type='checkbox';input.checked=part.visible;input.dataset.partId=part.id;input.onchange=()=>{part.visible=input.checked;partSummary();rememberEdits();scheduleDraw();};label.append(input,document.createTextNode(part.name));list.append(label);}
  }
  $('zip-files').onchange=e=>{importZips(e.target.files);e.target.value='';};
  const drop=$('drop-zone');for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('drag');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('drag');});drop.addEventListener('drop',e=>importZips(e.dataTransfer.files));
  // Dropping outside the box must not navigate away from a loaded project.
  document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
  $('search').oninput=showVehicles;$('part-search').oninput=showParts;$('material-search').oninput=showMaterials;
  for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;for(const v of document.querySelectorAll('[data-view]')){v.classList.toggle('active',v===b);v.setAttribute('aria-pressed',String(v===b));}$('view-label').textContent=b.textContent;draw();};
  $('width').onchange=draw;
  for(const [id,visible]of [['parts-show',true],['parts-hide',false]])$(id).onclick=()=>{const term=$('part-search').value.toLowerCase();for(const p of renderer?.parts||[])if(p.name.toLowerCase().includes(term))p.visible=visible;showParts();rememberEdits();draw();};
  $('parts-invert').onclick=()=>{const term=$('part-search').value.toLowerCase();for(const p of renderer?.parts||[])if(p.name.toLowerCase().includes(term))p.visible=!p.visible;showParts();rememberEdits();draw();};
  $('parts-reset').onclick=()=>{for(const p of renderer?.parts||[])p.visible=p.initialVisible;showParts();rememberEdits();draw();};
  $('materials-reset').onclick=()=>{for(const m of materialStyles)Object.assign(m,m.initial);showMaterials();rememberEdits();draw();};
  $('download').onclick=async()=>{if(busy||!renderer?.parts.length)return;try{draw();if($('download').disabled)return;const blob=await renderer.png(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=selected.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'_'+view.replace('+','plus').replace('-','minus')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){status(e.message,true);}};
  $('reset').onclick=()=>{if(busy)return;assets.clear();edits.clear();materialStyles=[];vehicles=[];selected=null;renderValid=false;renderer?.dispose();$('search').value='';$('part-search').value='';$('material-search').value='';showVehicles();showMaterials();showParts();$('projection-title').textContent='プレビュー';$('vehicle-detail').textContent='車両を選択してください';$('load-status').textContent='ZIPはまだ読み込まれていません。';$('canvas').hidden=true;$('empty-preview').hidden=false;$('empty-preview').querySelector('p').textContent='ZIPを読み込むと、ここに投影画像を表示します。';messages=[];diagnostics();status('モデル・材質・テクスチャをJSONから読み込みます。');setBusy(false);};
  $('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();status('GPUの描画コンテキストが失われました。ページを開き直してください。',true);$('download').disabled=true;});
  // Expose the same import action for local browser integration checks.
  TP.importFiles=importZips;TP.state=()=>({vehicleCount:vehicles.length,selected:selected?.name,busy,view,parts:renderer?.parts.length||0,messages:messages.slice()});
  TP.editorState=()=>({materials:materialStyles.map(m=>({id:m.id,name:m.name,...materialValues(m)})),parts:(renderer?.parts||[]).map(p=>({id:p.id,name:p.name,visible:p.visible}))});
})();
