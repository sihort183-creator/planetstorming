(() => {
  const templates = new WeakMap();
  const multisample = new WeakMap();
  const tau = 2 * Math.PI;

  function mistMaterial(THREE, cloth) {
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      alphaToCoverage: true,
      uniforms: { drift: { value: 0 }, motion: { value: 0 }, smoothMist: { value: false } },
      vertexShader: `
        attribute vec3 shade;
        varying vec3 tint, surfaceNormal, viewDir;
        uniform float drift, motion;
        void main() {
          vec3 p = position;
          ${cloth ? `
            float hem = 1.0 - smoothstep(.36, 1.27, p.y);
            p.x += hem * (.025 + .025 * motion) * sin(drift * 1.8 + p.z * 5.0);
            p.z += hem * (.031 * sin(drift * 1.5 + p.x * 4.5) - .17 * motion);
            p.y += hem * .023 * sin(drift * 2.1 + p.x * 7.0 + p.z * 4.0);
          ` : ''}
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          tint = shade;
          surfaceNormal = normalMatrix * normal;
          viewDir = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 tint, surfaceNormal, viewDir;
        uniform bool smoothMist;
        float bayer(vec2 cell) {
          vec2 b = mod(floor(cell), 2.);
          return 2. * b.x + 3. * b.y - 4. * b.x * b.y;
        }
        void main() {
          vec3 n = normalize(surfaceNormal);
          float rim = abs(dot(n, normalize(viewDir)));
          float light = dot(n, normalize(vec3(-.45,.8,.6)));
          float y = dot(tint, vec3(.25,.60,.15));
          vec3 pigment = mix(vec3(.053,.12,.16), vec3(.83,.98,.96), smoothstep(.055,.77,y));
          float skin = smoothstep(.014,.085,tint.g-max(tint.r,tint.b));
          pigment = mix(pigment, vec3(.48,.77,.73) + .13*y, skin);
          pigment += smoothstep(.055,.18,tint.r-tint.g)*vec3(.055,.005,.04);
          vec3 color = pigment*(.77+.13*smoothstep(-.42,-.02,light)+.10*smoothstep(.12,.6,light));
          color = mix(color, mix(vec3(.12,.25,.29),color,.45), 1.-smoothstep(.01,.16,rim));
          float opacity = ${cloth ? '.75' : '.875'};
          float d = (4.*bayer(gl_FragCoord.xy) + bayer(gl_FragCoord.xy*.5) + .5)/16.;
          if (!smoothMist && d > opacity) discard;
          gl_FragColor = vec4(color,smoothMist ? opacity : 1.);
        }
      `
    });
    material.onBeforeRender = renderer => {
      if(!multisample.has(renderer)){
        const gl=renderer.getContext();
        multisample.set(renderer,gl.getParameter(gl.SAMPLES)>=4);
      }
      material.uniforms.smoothMist.value=multisample.get(renderer);
    };
    return material;
  }

  function cloak(THREE) {
    const rings = [
      [.16,.004,.004,-.18,0], [.225,.15,.13,-.16,.028],
      [.305,.34,.23,-.135,.080], [.345,.405,.29,-.12,.107],
      [.40,.415,.30,-.115,.085], [.56,.405,.29,-.08,.038],
      [.78,.375,.28,-.045,.014], [1.02,.405,.29,-.035,.004],
      [1.19,.423,.30,-.04,0], [1.31,.396,.28,-.048,0],
      [1.40,.29,.215,-.054,0], [1.47,.19,.145,-.058,0],
      [1.49,.003,.003,-.058,0]
    ];
    const positions=[], shades=[], triangles=[];
    const cols=64, steps=(rings.length-1)*4;
    for(let j=0;j<=steps;j++){
      const segment=Math.min(rings.length-2,Math.floor(j/4)), t=j/4-segment;
      const samples=[rings[Math.max(0,segment-1)],rings[segment],rings[segment+1],rings[Math.min(rings.length-1,segment+2)]];
      const [y,rx,rz,z0,wave]=samples[1].map((a,i)=>{
        const [p,,b,c]=samples.map(r=>r[i]);
        return a+.5*t*((b-p)+t*((2*p-5*a+4*b-c)+t*(3*a-p-3*b+c)));
      });
      for(let i=0;i<cols;i++){
        const a=tau*i/cols, x=Math.sin(a), z=Math.cos(a);
        const fold=Math.sin(5*a+.65*y)+.33*Math.sin(3*a-.4);
        const ripple=wave*fold, shoulder=Math.exp(-(((y-1.025)/.23)**2));
        const mantle=shoulder*Math.abs(x)**9;
        positions.push(x*(rx+.16*mantle+.24*ripple),y-.10*mantle+ripple,z0+z*(rz+.26*ripple)+.075*mantle);
        const tone=.50+.12*Math.min(y,1.4)+.025*fold;
        shades.push(tone*.90,tone,tone*1.04);
        if(j>0){
          const a0=(j-1)*cols+i,b0=(j-1)*cols+(i+1)%cols;
          triangles.push(a0,b0,b0+cols,a0,b0+cols,a0+cols);
        }
      }
    }
    for(const j of [0,steps]){
      const start=j*cols, center=positions.length/3;
      positions.push(0,rings[j===0?0:rings.length-1][0],rings[j===0?0:rings.length-1][3]);
      shades.push(.54,.60,.62);
      for(let i=0;i<cols;i++){
        const a=start+i,b=start+(i+1)%cols;
        if(j===0)triangles.push(center,b,a);else triangles.push(center,a,b);
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('shade',new THREE.Float32BufferAttribute(shades,3));
    geometry.setIndex(triangles);
    geometry.computeVertexNormals();
    return geometry;
  }

  window.makeGhostPepe = function(makePepe,THREE){
    let template=templates.get(makePepe);
    if(!template){
      const donor=makePepe(true);
      const head=donor.children.find(child=>child.isGroup && child.children.some(mesh=>mesh.geometry?.hasAttribute('shade')));
      if(!head)throw Error('페페 머리 형상을 찾을 수 없습니다.');
      const face=head.clone(true), mist=mistMaterial(THREE,false);
      face.traverse(obj=>{if(obj.isMesh)obj.material=mist;});
      template={face, cloak:cloak(THREE), size:donor.scale.clone()};
      templates.set(makePepe,template);
    }
    const group=new THREE.Group(), apparition=new THREE.Group(), face=template.face.clone(true);
    const material=mistMaterial(THREE,true), body=new THREE.Mesh(template.cloak,material);
    group.scale.copy(template.size).multiplyScalar(.45);
    group.add(apparition);
    apparition.add(body,face);
    const phase=Math.random()*tau;
    let time=phase, blend=0;
    function update(dt,speed=0){
      const step=Math.min(.1,Math.max(0,dt));
      time+=step;
      blend+=(Math.min(1,Math.abs(speed)/2)-blend)*(1-Math.exp(-step*7));
      apparition.position.y=.115+.055*Math.sin(time*1.96);
      apparition.rotation.z=.025*Math.sin(time*1.5);
      apparition.rotation.x=.065*blend+.012*Math.sin(time*1.96+.5);
      material.uniforms.drift.value=time;
      material.uniforms.motion.value=blend;
    }
    update(0);
    const eye=new THREE.Vector3();
    function eyeHeight(){return face.localToWorld(eye.set(0,2.45,.22)).y}
    return {group,update,eyeHeight};
  };
})();
