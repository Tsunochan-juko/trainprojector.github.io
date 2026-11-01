(() => {
  'use strict';
  const TP=globalThis.TP ||= {};
  const views={'+X':[[0,0,-1],[0,1,0],[1,0,0]],'-X':[[0,0,1],[0,1,0],[-1,0,0]],'+Y':[[1,0,0],[0,0,-1],[0,1,0]],'-Y':[[1,0,0],[0,0,1],[0,-1,0]],'+Z':[[1,0,0],[0,1,0],[0,0,1]],'-Z':[[-1,0,0],[0,1,0],[0,0,-1]]};
  TP.views=views;
  class Renderer {
    constructor(canvas){
      this.canvas=canvas;this.parts=[];this.textures=new Set();this.buffers=[];
      // Blending stores premultiplied RGB in the framebuffer. Let the canvas
      // compositor and PNG exporter interpret it that way to avoid dark edges.
      const gl=this.gl=canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});
      if(!gl)throw Error('WebGL 2が利用できません。Chrome／Edgeのハードウェアアクセラレーション設定を確認してください。');
      const make=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const vertex=make(gl.VERTEX_SHADER,`#version 300 es
        in vec3 pos;in vec2 uv;in vec3 normal;uniform vec3 center,right,up,eye;uniform vec3 extent;out vec2 vuv;out float light;
        void main(){vec3 p=pos-center;gl_Position=vec4(dot(p,right)/extent.x,dot(p,up)/extent.y,-dot(p,eye)/extent.z,1.0);vuv=uv;light=.8+.2*abs(normal.y);}`);
      const fragment=make(gl.FRAGMENT_SHADER,`#version 300 es
        precision highp float;uniform sampler2D tex;uniform int phase;uniform vec4 color;uniform bool emissive;in vec2 vuv;in float light;out vec4 outputColor;
        void main(){vec4 c=texture(tex,vuv)*color;if(c.a<.001)discard;if(phase==0&&c.a<.999)discard;if(phase==1&&c.a>=.999)discard;outputColor=vec4(c.rgb*(emissive?1.0:light),c.a);}`);
      const p=this.program=gl.createProgram();gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
      this.attr={};for(const n of ['pos','uv','normal'])this.attr[n]=gl.getAttribLocation(p,n);
      this.loc={};for(const n of ['center','right','up','eye','extent','phase','color','emissive'])this.loc[n]=gl.getUniformLocation(p,n);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.frontFace(gl.CCW);gl.clearColor(0,0,0,0);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    }
    upload(image,settings={}){
      const gl=this.gl,tex=gl.createTexture();this.textures.add(tex);gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      const filter=settings.blur?gl.LINEAR:gl.NEAREST,wrap=settings.clamp?gl.CLAMP_TO_EDGE:gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap);return tex;
    }
    solid(missing=false){const c=document.createElement('canvas');c.width=c.height=8;const g=c.getContext('2d');g.fillStyle=missing?'#e76ac3':'white';g.fillRect(0,0,8,8);if(missing){g.fillStyle='#51394f';g.fillRect(0,0,4,4);g.fillRect(4,4,4,4);}const tex=this.upload(c);return {original:tex};}
    async texture(bytes,meta={}){
      const url=URL.createObjectURL(new Blob([bytes]));let img;
      try{img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('画像データをデコードできません。'));image.src=url;});}
      finally{URL.revokeObjectURL(url);}
      if(Math.max(img.width,img.height)>this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE))throw Error('テクスチャの寸法がGPUの上限を超えています。');
      return {original:this.upload(img,meta)};
    }
    dispose(){const gl=this.gl;for(const b of this.buffers)gl.deleteBuffer(b);for(const t of this.textures)gl.deleteTexture(t);this.buffers=[];this.textures.clear();this.parts=[];}
    setScene(parts,culling){
      this.parts=parts;this.culling=culling;
      const gl=this.gl;
      for(const part of parts)for(const b of part.batches){b.buffer=gl.createBuffer();this.buffers.push(b.buffer);gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);gl.bufferData(gl.ARRAY_BUFFER,b.data,gl.STATIC_DRAW);b.count=b.data.length/8;b.center=[0,0,0];for(let k=0;k<b.data.length;k+=8)for(let a=0;a<3;a++)b.center[a]+=b.data[k+a]/b.count;}
    }
    render(view='+X',longEdge=2048){
      const visible=this.parts.filter(p=>p.visible),batches=visible.flatMap(p=>p.batches).filter(b=>b.style?.visible!==false),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let count=0;
      for(const b of batches){count+=b.count;for(let k=0;k<b.data.length;k+=8)for(let a=0;a<3;a++){min[a]=Math.min(min[a],b.data[k+a]);max[a]=Math.max(max[a],b.data[k+a]);}}
      const gl=this.gl;gl.useProgram(this.program);gl.depthMask(true);
      if(!count){gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);return {empty:true};}
      const [right,up,eye]=views[view],center=min.map((v,i)=>(v+max[i])/2),size=min.map((v,i)=>Math.max(max[i]-v,.01));
      const projected=axis=>axis.reduce((s,v,i)=>s+Math.abs(v)*size[i],0);
      const horizontal=projected(right)*1.08,vertical=projected(up)*1.08,depth=projected(eye)*.6+.1,ratio=horizontal/vertical;
      const width=Math.max(1,Math.round(ratio>=1?longEdge:longEdge*ratio)),height=Math.max(1,Math.round(ratio>=1?longEdge/ratio:longEdge));
      const limit=Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const aa=Math.max(width,height)*2<=limit&&width*height*4<=16777216?2:1;
      this.canvas.width=width*aa;this.canvas.height=height*aa;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      for(const [name,v]of Object.entries({center,right,up,eye,extent:[horizontal/2,vertical/2,depth]}))gl.uniform3fv(this.loc[name],v);
      this.culling?gl.enable(gl.CULL_FACE):gl.disable(gl.CULL_FACE);
      const dot=p=>p.reduce((s,x,i)=>s+x*eye[i],0);
      for(let phase=0;phase<2;phase++){
        gl.uniform1i(this.loc.phase,phase);phase?gl.enable(gl.BLEND):gl.disable(gl.BLEND);gl.depthMask(!phase);
        const order=phase?batches.slice().sort((a,b)=>dot(a.center)-dot(b.center)):batches;
        for(const b of order){const settings=b.style||b;if(phase===1&&settings.alphaBlend===false)continue;const twoSided=settings.doubleSided??!this.culling;twoSided?gl.disable(gl.CULL_FACE):gl.enable(gl.CULL_FACE);gl.uniform1i(this.loc.emissive,!!settings.light);gl.bindTexture(gl.TEXTURE_2D,b.texture.original);const color=(b.color||[1,1,1,1]).slice();if(settings.opacity!==undefined)color[3]=settings.opacity;gl.uniform4fv(this.loc.color,color);gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);
          for(const [name,n,offset]of [['pos',3,0],['uv',2,12],['normal',3,20]]){gl.enableVertexAttribArray(this.attr[name]);gl.vertexAttribPointer(this.attr[name],n,gl.FLOAT,false,32,offset);}gl.drawArrays(gl.TRIANGLES,0,b.count);
        }
      }
      gl.depthMask(true);gl.finish();if(gl.getError())throw Error('WebGLの描画に失敗しました。解像度を下げてください。');this.output={width,height};return {width,height,triangles:count/3};
    }
    async png(){const {width,height}=this.output,c=document.createElement('canvas');c.width=width;c.height=height;const g=c.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(this.canvas,0,0,width,height);return new Promise((resolve,reject)=>c.toBlob(blob=>blob?resolve(blob):reject(Error('PNGの保存に失敗しました。')),'image/png'));}
  }
  TP.Renderer=Renderer;
})();
