/* Normalize RTM's current and legacy train configuration fields. */
(() => {
  'use strict';
  const TP = globalThis.TP ||= {};
  function source(value, texture) {
    if (typeof value === 'string') return {modelFile:value, textures:texture?[['default',texture]]:[]};
    if (value && typeof value === 'object' && !Array.isArray(value)) return {...value, textures:Array.isArray(value.textures)?value.textures:[]};
    return null;
  }
  TP.trainConfig = (cfg, filename='') => {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
    if (!cfg.trainName && !/^ModelTrain(?:_|\.)/i.test(filename.split('/').at(-1))) return null;
    const main = source(cfg.trainModel2 ?? cfg.trainModel, cfg.trainTexture);
    const positions = Array.isArray(cfg.bogiePos) ? cfg.bogiePos : [[0,0,7.125],[0,0,-7.125]];
    let bogies=[];
    if (Array.isArray(cfg.bogieModel3)) bogies=cfg.bogieModel3.map(v=>source(v));
    else if (Array.isArray(cfg.bogieModel2)) bogies=cfg.bogieModel2.map(v=>source(v));
    else {
      const common=source(cfg.bogieModel2 ?? cfg.bogieModel, cfg.bogieTexture);
      if (common) bogies=positions.map(()=>common);
    }
    const extension=main?.modelFile?.split('.').at(-1).toLowerCase();
    const supported=['mqo','obj','mqoz'].includes(extension);
    return {
      main, bogies, positions, supported,
      name:String(cfg.trainName||filename.split('/').at(-1).replace(/\.json$/i,'')),
      capability:!main?.modelFile?'モデル指定なし':extension==='class'?'Javaモデル：描画未対応':!supported?'未対応形式：'+(extension||'不明'):extension.toUpperCase()+(main.rendererPath?' / JSによる表示調整あり':''),
      scale:Number(cfg.scale)>0?Number(cfg.scale):1,
      offset:Array.isArray(cfg.offset)?cfg.offset:[0,0,0]
    };
  };
})();
