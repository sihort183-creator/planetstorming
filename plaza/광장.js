'use strict';
const Plaza=(()=>{
 const g=id=>document.getElementById(id);
 let api,world={me:null,players:[]},self=null,ghost=false,entered=false;
 let px=0,pz=0,heading=0,entryYaw=0,orbitPitch=.12,pending=false,lastSync=0;
 const actors=new Map(),moving=new Map(),cardImages=new Map();
 const tabKey=Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
 let boundTemplate,clock=0,lastUI=0;
 function text(el,value){el.textContent=value;return el}
 function element(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e}
 function mesh(points,uv,index,mat){
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  if(uv)geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geom.setIndex(index);return new THREE.Mesh(geom,mat)
 }
 function necklace(group,s){
  const c=document.createElement('canvas');c.width=640;c.height=312;
  const ctx=c.getContext('2d'),amount=n=>s.currency==='KRW'?Math.round(n).toLocaleString('ko-KR')+'원':'$'+n.toLocaleString('en-US',{maximumFractionDigits:2});
  const diff=s.close>0?(s.close/s.basis-1)*100:null;
  const texture=new THREE.CanvasTexture(c);
  function paint(img){
   ctx.fillStyle='#35302c';ctx.fillRect(0,0,640,312);ctx.fillStyle='#faf8f4';ctx.fillRect(6,6,628,300);
   if(img)ctx.drawImage(img,23,19,66,66);
   ctx.fillStyle='#302c29';ctx.font='600 34px sans-serif';ctx.fillText(s.name,103,48,510);
   ctx.font='24px sans-serif';ctx.fillText(s.symbol,103,77);ctx.font='26px sans-serif';ctx.fillText('매수평단',25,123);
   ctx.font='bold 61px sans-serif';ctx.fillText(amount(s.basis),22,188,598);
   ctx.font='30px sans-serif';ctx.fillStyle=diff<0?'#285db0':'#904738';ctx.fillText(diff===null?'수익률 계산 대기':'평단 대비 '+(diff>0?'+':'')+diff.toFixed(2)+'%',25,238);
   ctx.fillStyle='#554f49';ctx.font='25px sans-serif';ctx.fillText('기준가 '+(s.close>0?amount(s.close):'미제공'),25,286,598);texture.needsUpdate=true
  }
  paint(null);let img=cardImages.get(s.logo);if(!img){img=new Image();img.src=s.logo;cardImages.set(s.logo,img)}img.decode().then(()=>paint(img)).catch(()=>{});
  const mat=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{card:{value:texture}},vertexShader:'varying vec2 tc;void main(){tc=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D card;varying vec2 tc;void main(){gl_FragColor=texture2D(card,tc);}'});
  const flat=new THREE.ShaderMaterial({side:THREE.DoubleSide,vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(.22,.17,.12,1.);}'});
  const top=1.30,front=.48;
  for(const side of [-1,1]){
   const a=.26*side,b=.47*side;
   group.add(mesh([a-.014,1.52,.03,a+.014,1.52,.03,b+.014,top,front,b-.014,top,front],null,[0,1,2,0,2,3],flat))
  }
  const face=mesh([-.912,top,front,.912,top,front,.912,.412,.528,-.912,.412,.528],[0,1,1,1,1,0,0,0],[0,1,2,0,2,3],mat);group.add(face);return face
 }
 const shirtPalette=['#a33d31','#335795','#cc982f','#2b827d','#8054a4','#c76938','#41503e','#bf7186','#adc2d1','#504657'];
 const shirtVariants=new WeakMap();
 function dress(group,slot){
  const shadeIndex=slot%shirtPalette.length;
  group.traverse(node=>{
   const original=node.geometry,ranges=original?.userData.shirtRanges;
   if(!ranges)return;
   let variants=shirtVariants.get(original);
   if(!variants){variants=[];shirtVariants.set(original,variants)}
   if(!variants[shadeIndex]){
    const rgb=parseInt(shirtPalette[shadeIndex].slice(1),16);
    const shade=original.getAttribute('shade').clone(),variant=new THREE.BufferGeometry();
    for(const [name,attr] of Object.entries(original.attributes))variant.setAttribute(name,attr);
    variant.setIndex(original.index);
    for(const [first,end] of ranges)for(let i=first;i<end;i++)
     shade.setXYZ(i,(rgb>>16)/255,(rgb>>8&255)/255,(rgb&255)/255);
    variant.setAttribute('shade',shade);variants[shadeIndex]=variant;
   }
   node.geometry=variants[shadeIndex];
  })
 }
 function actor(p){
  const node=new THREE.Group(),ground=api.height(p.x,p.z);
  node.position.set(p.x,ground,p.z);
  let lift=0,card=null;
  if(p.role==='bound'){
   if(!boundTemplate)boundTemplate=api.makePepe(true);
   const body=boundTemplate.clone(true),s=p.stock;dress(body,p.slot);
   const loss=s.close>0?Math.min(1,Math.max(0,1-s.close/s.basis)):0;
   lift=1.8*loss;body.position.y=lift-.0064;
   const post=body.getObjectByName('stake');
   const width=1.32+1.65*loss;
   if(post){
    post.scale.set(width,1+lift/(2.88*.4),width);
    post.position.set(0,-lift/.4,.515*(width-1));
    for(const rope of body.children.filter(child=>child.name==='binding')){
     rope.geometry=rope.geometry.clone();
     const positions=rope.geometry.getAttribute('position');
     for(let i=0;i<positions.count;i++){
      const z=positions.getZ(i),rear=Math.max(0,Math.min(1,(.12-z)/1.05));
      positions.setXYZ(i,positions.getX(i)*(1+.38*(width-1)*rear),positions.getY(i),z-.41*(width-1)*rear);
     }
     rope.geometry.computeVertexNormals();rope.geometry.computeBoundingSphere();
    }
   }
   card=necklace(body,s);node.add(body)
  }
  const tag=text(element('button','world-name'),p.nick);tag.type='button';tag.onclick=()=>inspect(p);
  const cry=text(element('span','world-cry'),'크아악!!');cry.hidden=true;
  g('world-tags').append(tag,cry);api.scene.add(node);
  let base=null;
  if(card){
   base=element('div','stake-reactions');base.hidden=true;g('world-tags').append(base);
   reactionPanel(base,p);
  }
  return {node,tag,cry,lift,card,base,stake:node.getObjectByName("stake")}
 }
 let emojiData,openPicker=null,firstPerson=null;
 function medal(label,count,button){
  const canvas=document.createElement('canvas');canvas.width=button?384:192;canvas.height=192;
  const ctx=canvas.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=button?'#615044':'#f1dfba';ctx.fillRect(0,0,canvas.width,192);
  ctx.fillStyle='#fff';ctx.font=button?'bold 66px sans-serif':'136px "Segoe UI Emoji",sans-serif';
  ctx.fillText(label,canvas.width/2,count>1?84:98,canvas.width*.92);
  if(count>1){ctx.fillStyle='#422f22';ctx.font='bold 42px sans-serif';ctx.fillText(String(count),96,161)}
  const texture=new THREE.CanvasTexture(canvas),points=[0,0,.054],uv=[.5,.5],index=[];
  const rx=button?.295:.128,ry=button?.105:.128,n=40;
  for(const [scale,z] of [[.91,.054],[1,.034],[1,-.018]]){
   for(let i=0;i<n;i++){
    const angle=2*Math.PI*i/n,c=Math.cos(angle),t=Math.sin(angle);
    const x=button?Math.sign(c)*Math.pow(Math.abs(c),.48):c,y=button?Math.sign(t)*Math.pow(Math.abs(t),.48):t;
    points.push(rx*x*scale,ry*y*scale,z);uv.push(.5+.5*x*scale,.5+.5*y*scale);
   }
  }
  for(let i=0;i<n;i++){
   const k=1+i,l=1+(i+1)%n;index.push(0,k,l);
   for(const a of [0,n])index.push(k+a,l+n+a,l+a,k+a,k+n+a,l+n+a)
  }
  const mat=new THREE.ShaderMaterial({uniforms:{face:{value:texture}},side:THREE.DoubleSide,
   vertexShader:'varying vec2 tc;varying float z;void main(){tc=uv;z=position.z;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:'uniform sampler2D face;varying vec2 tc;varying float z;void main(){vec3 c=texture2D(face,tc).rgb;gl_FragColor=vec4(mix(vec3(.27,.20,.15),c,smoothstep(.027,.054,z)),1.);}'});
  return mesh(points,uv,index,mat)
 }
 function clearMedal(obj){obj.removeFromParent();obj.geometry.dispose();obj.material.uniforms.face.value.dispose();obj.material.dispose()}
 function mountBadge(a,obj,angle,h){
  const post=a.stake;
  obj.scale.set(1/post.scale.x,1/post.scale.y,1/post.scale.z);
  obj.position.set(.245*Math.sin(angle),h/post.scale.y,-.72+.205*Math.cos(angle));
  // Rotate outside the nonuniform scale so the raised face keeps its proportions.
  const joint=new THREE.Group();joint.position.copy(obj.position);joint.scale.copy(obj.scale);
  obj.position.set(0,0,0);obj.scale.set(1,1,1);obj.rotation.y=angle;post.add(joint);joint.add(obj);return joint
 }
 function stakeStickers(a,rows){
  if(!a.press){a.press=medal('이모지 ＋',0,true);mountBadge(a,a.press,0,.50)}
  const visible=rows.slice(0,6),key=JSON.stringify(visible.map(([e,n])=>[e,n]));
  if(a.markKey===key)return;a.markKey=key;
  for(const joint of a.badges||[]){clearMedal(joint.children[0]);joint.removeFromParent()}
  a.badges=visible.map(([emoji,n],i)=>{
   const col=i%3,width=Math.min(3,visible.length-Math.floor(i/3)*3);
   return mountBadge(a,medal(emoji,n,false),(col-(width-1)/2)*.85,visible.length>3&&i<3?.33:.145)
  });
 }
 const groups=['표정과 하트','사람과 손짓','','동물과 자연','음식과 음료','여행과 장소','활동과 스포츠','물건','기호','깃발'];
 function reactionPanel(panel,p){
  const chips=element('div','reaction-counts'),picker=element('details','reaction-picker');
  const title=text(element('summary'),'＋');title.setAttribute('aria-label',p.nick+' 기둥에 이모지 남기기');title.title='이모지 남기기';picker.append(title);panel.append(picker);picker.append(chips);
  const error=element('div');error.setAttribute('role','status');panel.append(error);
  let busy=false,version='',grid=null,shown=[],limit=60;
  function data(){return actors.get(p.id)?.data?.reactions||[]}
  async function toggle(emoji){
   if(busy)return;busy=true;error.textContent='';
   const list=data(),old=list.find(row=>row[0]===emoji),enabled=!old?.[2];
   try{await request('react',{target:p.id,emoji,enabled});
    const next=data().filter(row=>row[0]!==emoji),count=(old?.[1]||0)+(enabled?1:-1);
    if(count)next.push([emoji,count,enabled]);
    actors.get(p.id).data.reactions=next;refresh();picker.open=false;sync()
   }catch(e){error.textContent=e.message}finally{busy=false}
  }
  function button(emoji,label,caption){
   const b=text(element('button'),caption);b.type='button';b.dataset.emoji=emoji;b.title=label;b.setAttribute('aria-label',label);
   b.onclick=()=>toggle(emoji);return b
  }
  function refresh(){
   const rows=data(),key=JSON.stringify(rows);
   if(key!==version){chips.replaceChildren(...rows.map(([e,n,on])=>{const b=button(e,e+' '+n+'개',e+' '+n);b.setAttribute('aria-pressed',String(on));return b}));version=key}
   if(grid){const mine=new Set(rows.filter(r=>r[2]).map(r=>r[0]));for(const b of grid.children)b.setAttribute('aria-pressed',String(mine.has(b.dataset.emoji)))}
  }
  panel.refresh=refresh;refresh();
  picker.ontoggle=async()=>{
   if(!picker.open){if(openPicker===picker)openPicker=null;return}
   if(openPicker&&openPicker!==picker)openPicker.open=false;openPicker=picker;
   if(picker.dataset.ready)return;
   picker.dataset.ready='1';
   try{
    emojiData??=fetch('/반응-이모지.json').then(r=>{if(!r.ok)throw Error();return r.json()});
    const rows=(await emojiData).rows;
    const search=element('input');search.type='search';search.placeholder='이모지 검색';search.setAttribute('aria-label','이모지 검색');
    const select=element('select');select.setAttribute('aria-label','이모지 종류');select.add(new Option('모든 종류',''));
    groups.forEach((name,i)=>{if(name)select.add(new Option(name,i))});
    grid=element('div','emoji-grid');const more=text(element('button','emoji-more'),'더 보기'),empty=text(element('small'),'검색 결과가 없습니다.');
    const menu=element('div','emoji-tools');menu.append(chips,search,select,grid,more,empty);picker.append(menu);placePicker(panel);
    function render(){grid.replaceChildren(...shown.slice(0,limit).map(([e,label])=>button(e,label,e)));more.hidden=shown.length<=limit;empty.hidden=shown.length>0;refresh()}
    function filter(){const terms=search.value.trim().toLowerCase().split(/\s+/);limit=60;shown=rows.filter(([e,label,group,tags])=>(!select.value||group===Number(select.value))&&terms.every(t=>(e+label+tags).includes(t)));render()}
    more.onclick=()=>{limit+=60;render()};search.oninput=select.onchange=filter;filter()
   }catch{emojiData=null;delete picker.dataset.ready;picker.open=false;error.textContent='이모지를 불러올 수 없습니다. 다시 열어 주세요.'}
  }
 }
 function inspect(p){
  p=actors.get(p.id)?.data||p;
  const panel=g('inspect');panel.dataset.owner=p.id;panel.replaceChildren();const close=text(element('button'),'닫기');close.onclick=()=>{panel.hidden=true};
  panel.append(text(element('strong'),p.nick),close);
  if(p.stock){
   const s=p.stock,img=new Image();img.src=s.logo;img.alt='';panel.append(img,text(element('span'),s.name+' '+s.symbol));
   const money=n=>s.currency==='KRW'?n.toLocaleString('ko-KR')+'원':'$'+n.toLocaleString('en-US');
   panel.append(text(element('small'),'매수평단'),text(element('b'),money(s.basis)),text(element('span'),s.close>0?'평단 대비 '+((s.close/s.basis-1)*100).toFixed(2)+'%':'수익률 계산 대기'),text(element('small'),'기준가 '+(s.close>0?money(s.close):'미제공')))
  }else panel.append(text(element('span'),'현금 관망'));

  panel.hidden=false
 }
 function receive(state){
  if(!state.me)return;
  world=state;
  const active=new Set(state.players.map(p=>p.id));
  for(const [id,a] of actors)if(!active.has(id)){
   if(openPicker&&a.base?.contains(openPicker))openPicker=null;
   a.tag.remove();a.cry.remove();a.base?.remove();a.node.removeFromParent();
   if(a.press)clearMedal(a.press);
   for(const joint of a.badges||[])clearMedal(joint.children[0]);
   if(a.card){a.card.material.uniforms.card.value.dispose();a.card.material.dispose();a.card.geometry.dispose()}
   const m=moving.get(id);if(m){m.group.removeFromParent();m.dispose?.();moving.delete(id)}
   actors.delete(id);if(g('inspect').dataset.owner===String(id))g('inspect').hidden=true
  }
  for(const p of world.players){
   const old=actors.get(p.id);
   if(old&&p.stock&&!p.stock.logo)p.stock.logo=old.data.stock.logo;
   if(!old){const a=actor(p);actors.set(p.id,a)}
   const figure=actors.get(p.id);figure.data=p;
   if(figure.base){figure.base.refresh();stakeStickers(figure,p.reactions||[])}
  }
  self=world.players.find(p=>p.id===world.me);
  if(!entered){entered=true;px=self.x;pz=self.z;entryYaw=self.role==="cash"&&(px||pz)?Math.atan2(-px,pz):0;heading=-entryYaw;g('holding').hidden=true;g('actions').hidden=false;g('spectate').hidden=self.role!=='bound';g('pad').classList.toggle('inactive',self.role==='bound')}
 }
 async function request(path,body){
  const r=await fetch('/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)throw Error(d.error||'연결을 확인해 주세요.');return d
 }
 async function sync(){
  if(pending||!entered)return;pending=true;
  try{const mode=self.role==='cash'?'walk':ghost?'ghost':null;
   receive(await request('move',{tab:tabKey,known:[...actors.keys()],moving:mode?{mode,x:px,z:pz,yaw:heading}:null}));g('network').hidden=true
  }catch{g('network').hidden=false}finally{pending=false}
 }
 function drawMoving(p,mode,x,z,yaw,dt){
  let a=moving.get(p.id);
  if(a&&a.mode!==mode){api.scene.remove(a.group);a.dispose?.();moving.delete(p.id);a=null}
  if(!mode)return null;
  if(!a){const build=mode==='walk'?window.makeWalkingPepe:window.makeGhostPepe;a=build(api.makePepe,THREE);if(mode==='walk')dress(a.group,p.slot);a.mode=mode;a.group.position.set(x,0,z);api.scene.add(a.group);moving.set(p.id,a)}
  const v=a.group.position,oldX=v.x,oldZ=v.z,k=p.id===world.me?1:1-Math.exp(-8*dt);
  v.x+=(x-v.x)*k;v.z+=(z-v.z)*k;v.y=api.height(v.x,v.z)+(mode==='ghost'?.21:0);
  a.group.rotation.y+=Math.atan2(Math.sin(yaw-a.group.rotation.y),Math.cos(yaw-a.group.rotation.y))*(1-Math.exp(-13*dt));
  a.update(dt,Math.min(1.6,Math.hypot(v.x-oldX,v.z-oldZ)/Math.max(.001,dt)));return a.group
 }
 function free(x,z){
  for(const a of actors.values()){
   if(a.data.id===world.me&&self.role==='cash')continue;
   if(a.data.role==='bound'&&Math.hypot(x-a.data.x,z-a.data.z)<.65)return false;
   const m=moving.get(a.data.id);if(m&&a.data.id!==world.me&&Math.hypot(x-m.group.position.x,z-m.group.position.z)<.50)return false
  }return true
 }
 function project(el,x,y,z,dy=0){
  const v=new THREE.Vector3(x,y,z).project(api.camera);
  el.hidden=v.z< -1||v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1;
  if(!el.hidden){el.style.left=(v.x*.5+.5)*100+'%';el.style.top='calc('+((.5-v.y*.5)*100)+'% + '+dy+'px)'}
 }
 function placePicker(base){
  if(!openPicker||!base.contains(openPicker))return;
  const menu=openPicker.querySelector('.emoji-tools');if(!menu)return;
  const box=base.getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;
  menu.style.left=Math.max(6,Math.min(innerWidth-w-6,box.left+box.width/2-w/2))+'px';
  menu.style.top=Math.max(6,Math.min(innerHeight-h-6,box.top>h+8?box.top-h-6:box.bottom+6))+'px'
 }
 function frame(dt,forward,side,yaw,pitch){
  if(!self)return false;clock+=dt;yaw+=entryYaw;orbitPitch=Math.max(-.3,Math.min(.65,pitch));
  const walking=self.role==='cash'||ghost,first=firstPerson??walking;
  if(walking&&(forward||side)){
   const n=Math.max(1,Math.hypot(forward,side)),dx=(forward*Math.sin(yaw)+side*Math.cos(yaw))/n,dz=(-forward*Math.cos(yaw)+side*Math.sin(yaw))/n;
   const step=(ghost?1.6:1.05)*dt;
   const x=Math.max(-98,Math.min(98,px+dx*step)),z=Math.max(-98,Math.min(98,pz+dz*step));
   if(free(x,pz))px=x;if(free(px,z))pz=z;
   if(!first)heading=Math.atan2(dx,dz);
  }
  const own=actors.get(world.me);
  let eyeY=api.height(px,pz)+own.lift+.86;
  if(walking){
   if(first)heading=Math.PI-yaw;
   const group=drawMoving(self,ghost?'ghost':'walk',px,pz,heading,dt);
   group.visible=!first;eyeY=moving.get(self.id).eyeHeight()
  }
  own.node.visible=true;
  if(own.stake){for(const part of own.stake.parent.children)part.visible=walking||!first||part===own.stake}
  if(first){
   api.camera.position.set(px,eyeY,pz);
   api.camera.rotation.set(pitch,walking?-yaw:Math.PI-.20-yaw,0,'YXZ');
  }else{
   const focus=walking?api.height(px,pz)+.62:api.height(px,pz)+.57+own.lift*.52;
   const dist=walking?2.35:2.15+own.lift*.53,angle=.17-orbitPitch;
   api.camera.position.set(px-Math.sin(yaw)*dist*Math.cos(angle),focus+dist*Math.sin(angle),pz+Math.cos(yaw)*dist*Math.cos(angle));
   api.camera.lookAt(px,focus,pz)
  }
  const button=g('perspective'),label=first?'3인칭 보기':'1인칭 보기';if(button.textContent!==label)button.textContent=label;
  api.camera.updateMatrixWorld();
  const labels=clock-lastUI>.045;if(labels)lastUI=clock;
  for(const p of world.players){
   const a=actors.get(p.id),mine=p.id===world.me;
   let m=mine?(walking?{x:px,z:pz,yaw:heading,mode:ghost?'ghost':'walk'}:null):p.moving;
   if(!m&&p.role==='cash')m={mode:'walk',x:p.x,z:p.z,yaw:0};
   const avatar=mine&&walking?moving.get(p.id).group:drawMoving(p,m?.mode,m?.x,m?.z,m?.yaw||0,dt);
   if(mine&&p.role==='cash'&&first){a.tag.hidden=a.cry.hidden=true;continue}
   if(!labels)continue;
   if(a.base){

    const near=Math.hypot(px-p.x,pz-p.z)<9;
    if(near&&a.press){const at=a.press.getWorldPosition(new THREE.Vector3());project(a.base,at.x,at.y,at.z)}else a.base.hidden=true;
    if(a.base.hidden&&openPicker&&a.base.contains(openPicker))openPicker.open=false;
    else placePicker(a.base)
   }
   if(!a.node.visible||(mine&&first&&!walking)){a.tag.hidden=a.cry.hidden=true;continue}
   const point=p.role==='cash'?avatar.position:a.node.position;
   const y=point.y+(p.role==='cash'?1.13:1.21+a.lift);
   if(Math.hypot(px-point.x,pz-point.z)>15){a.tag.hidden=a.cry.hidden=true;continue}
   project(a.tag,point.x,y,point.z);
   if(!mine&&p.role==='bound'&&(clock+(p.slot*3.17))%8<1.65)project(a.cry,point.x,y,point.z,-31);else a.cry.hidden=true
  }
  if(clock-lastSync>.48){lastSync=clock;sync()}return true
 }
 function hitBound(x,y,camera){
  const origin=camera.position,direction=new THREE.Vector3(x,y,.5).unproject(camera).sub(origin).normalize();
  const o=new THREE.Vector3(),dir=o.clone(),a=o.clone(),b=o.clone(),c=o.clone(),ab=o.clone(),ac=o.clone(),h=o.clone(),s=o.clone(),q=o.clone();
  let best=Infinity,result=null;
  for(const actor of actors.values()){
   if(!actor.card||!actor.node.visible)continue;
   actor.node.traverse(mesh=>{
    if(!mesh.isMesh)return;for(let n=mesh;n;n=n.parent)if(!n.visible)return;
    const geo=mesh.geometry,inv=mesh.matrixWorld.clone().invert();
    o.copy(origin).applyMatrix4(inv);dir.copy(direction).transformDirection(inv);
    if(!geo.boundingSphere)geo.computeBoundingSphere();
    const sphere=geo.boundingSphere;h.subVectors(sphere.center,o);const along=h.dot(dir);
    if(along< -sphere.radius||h.lengthSq()-along*along>sphere.radius*sphere.radius)return;
    const pos=geo.getAttribute('position'),idx=geo.index;
    for(let i=0,n=idx?idx.count:pos.count;i<n;i+=3){
     a.fromBufferAttribute(pos,idx?idx.getX(i):i);b.fromBufferAttribute(pos,idx?idx.getX(i+1):i+1);c.fromBufferAttribute(pos,idx?idx.getX(i+2):i+2);
     ab.subVectors(b,a);ac.subVectors(c,a);h.crossVectors(dir,ac);
     const det=ab.dot(h);if(Math.abs(det)<1e-10)continue;
     s.subVectors(o,a);const u=s.dot(h)/det;if(u<0||u>1)continue;
     q.crossVectors(s,ab);const v=dir.dot(q)/det;if(v<0||u+v>1)continue;
     const t=ac.dot(q)/det;if(t<=0)continue;
     const distance=h.copy(o).addScaledVector(dir,t).applyMatrix4(mesh.matrixWorld).distanceTo(origin);
     if(distance<best){best=distance;result={actor,card:mesh===actor.card}}
    }
   })
  }
  return result
 }
 function bind(scene,camera,height,makePepe){
  api={scene,camera,height,makePepe};const canvas=document.querySelector('canvas');let down;
  canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});
  canvas.addEventListener('pointerup',e=>{
   if(!entered||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;
   const x=2*e.clientX/innerWidth-1,y=1-2*e.clientY/innerHeight;
   const nearest=hitBound(x,y,camera);
   if(nearest&&!nearest.card&&nearest.actor.base&&!nearest.actor.base.hidden){const picker=nearest.actor.base.querySelector('details');picker.open=!picker.open}
   else if(nearest)inspect(nearest.actor.data)
  })
 }
 async function init(){
  addEventListener('pagehide',()=>{if(entered)navigator.sendBeacon('/away',new Blob([JSON.stringify({tab:tabKey})],{type:'application/json'}))});
  setInterval(()=>{if(entered&&document.hidden)sync()},4000);
  const form=g('holding-form'),roleInputs=[...document.querySelectorAll('[name=role]')];let restoring=false;
  function fields(){
   const bound=!restoring&&roleInputs[0].checked;
   g('new-fields').hidden=restoring;g('nickname').required=!restoring;g('stock-fields').hidden=!bound;
   g('stock-choice').required=g('avg-price').required=bound;g('code').autocomplete=restoring?'current-password':'new-password';
   g('mode-toggle').textContent=restoring?'처음 입장':'다시 입장';g('join-error').textContent=''
  }
  roleInputs.forEach(r=>r.onchange=fields);g('mode-toggle').onclick=()=>{restoring=!restoring;fields()};fields();
  form.onsubmit=async e=>{
   e.preventDefault();const submit=g('enter');if(submit.disabled)return;submit.disabled=true;
   try{
    const d={code:g('code').value};if(!restoring){d.nick=g('nickname').value;d.role=roleInputs[0].checked?'bound':'cash';if(d.role==='bound')d.stock=await window.readPlazaStock()}
    receive(await request(restoring?'restore':'enter',d));g('code').value=''
   }catch(err){g('join-error').textContent=err.message}finally{submit.disabled=false}
  };
  g('perspective').onclick=()=>{firstPerson=!(firstPerson??(self.role==='cash'||ghost));document.querySelector('canvas').focus()};
  document.addEventListener('pointerdown',e=>{if(openPicker&&!openPicker.parentElement.contains(e.target))openPicker.open=false});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&openPicker)openPicker.open=false});
  g('spectate').onclick=()=>{
   ghost=!ghost;px=self.x+(ghost?.90:0);pz=self.z+(ghost?.75:0);heading=.20;document.querySelector('canvas').focus();g('spectate').textContent=ghost?'자리로':'관전';g('pad').classList.toggle('inactive',!ghost);sync()
  };
  g('leave').onclick=async()=>{try{await request('leave',{});location.reload()}catch{g('network').hidden=false}};
  try{receive(await request('world'))}catch{g('join-error').textContent='광장 서버에 연결할 수 없습니다.'}
 }
 return {frame,bind,init}
})();