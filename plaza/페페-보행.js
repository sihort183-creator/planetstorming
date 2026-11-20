(() => {
  const templates = new WeakMap();

  function mergeMeshes(meshes, THREE) {
    const positions = [], normals = [], shades = [], indices = [], shirtRanges = [];
    for (const mesh of meshes) {
      const { position, normal, shade } = mesh.geometry.attributes;
      const offset = positions.length / 3;
      for(const [first,end] of mesh.geometry.userData.shirtRanges || [])
        shirtRanges.push([offset+first,offset+end]);
      for (let i = 0; i < position.count; i++) {
        positions.push(position.getX(i), position.getY(i), position.getZ(i));
        normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        shades.push(shade.getX(i), shade.getY(i), shade.getZ(i));
      }
      const index = mesh.geometry.index;
      for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 3));
    geometry.setIndex(indices);
    if(shirtRanges.length)geometry.userData.shirtRanges=shirtRanges;
    return geometry;
  }

  function neckInsert(THREE) {
    const profile = [
      [1.326, 0.17, 0.14, -0.055],
      [1.37, 0.206, 0.173, -0.047],
      [1.414, 0.236, 0.201, -0.038],
      [1.449, 0.252, 0.217, -0.027],
      [1.49, 0.266, 0.225, -0.023],
      [1.54, 0.283, 0.23, -0.022],
      [1.595, 0.296, 0.233, -0.026]
    ];
    const segments = 48, positions = [], shades = [], indices = [];
    for (const [y, rx, rz, center] of profile) {
      for (let j = 0; j < segments; j++) {
        const a = j * 2 * Math.PI / segments;
        positions.push(rx * Math.cos(a), y, center + rz * Math.sin(a));
        shades.push(0.28, 0.40, 0.145);
      }
    }
    for (let i = 1; i < profile.length; i++) {
      for (let j = 0; j < segments; j++) {
        const low = (i - 1) * segments, next = (j + 1) % segments;
        indices.push(low + j, low + segments + j, low + next,
          low + next, low + segments + j, low + segments + next);
      }
    }
    for (const i of [0, profile.length - 1]) {
      const cap = positions.length / 3, start = i * segments;
      positions.push(0, profile[i][0], profile[i][3]);
      shades.push(0.28, 0.40, 0.145);
      for (let j = 0; j < segments; j++) {
        const a = start + j, b = start + (j + 1) % segments;
        indices.push(cap, i ? b : a, i ? a : b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  function template(makePepe, THREE) {
    if (templates.has(makePepe)) return templates.get(makePepe);
    const source = makePepe(false);
    const head = source.children.find(node => node.isGroup);
    const pieces = { trunk: [], leg: [], arm: [] };
    for (const mesh of source.children.filter(node => node.isMesh)) {
      const geometry = mesh.geometry;
      geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      if (min.x < 0 && max.x > 0) pieces.trunk.push(mesh);
      else if (min.x > 0) {
        const color = geometry.getAttribute('shade');
        const brown = color.getX(0) > color.getY(0) && color.getX(0) > color.getZ(0);
        pieces[brown ? 'leg' : 'arm'].push(mesh);
      }
    }
    if (!head || Object.values(pieces).some(part => !part.length)) throw Error('페페 보행 모델의 몸체를 찾을 수 없습니다.');
    const model = {
      trunk: mergeMeshes([...pieces.trunk, { geometry: neckInsert(THREE) }], THREE),
      leg: mergeMeshes(pieces.leg, THREE),
      arm: mergeMeshes(pieces.arm, THREE),
      head: mergeMeshes(head.children, THREE),
      headPose: head.clone(false),
      material: pieces.trunk[0].material,
      scale: source.scale.x
    };
    templates.set(makePepe, model);
    return model;
  }

  const limbVertex = `
    attribute vec3 shade;
    uniform vec2 joint, ankle;
    uniform float bend, footAngle, leg;
    varying vec3 color, n, v;
    mat2 rotateX(float angle) {
      float c = cos(angle), s = sin(angle);
      return mat2(c, s, -s, c);
    }
    void main() {
      vec3 p = position, norm = normal;
      if (leg > 0.5) {
        float weight = 1.0 - smoothstep(0.195, 0.275, position.y);
        mat2 flex = rotateX(footAngle * weight);
        p.yz = ankle + flex * (p.yz - ankle);
        norm.yz = flex * norm.yz;
      }
      float weight = 1.0 - smoothstep(joint.x - 0.12, joint.x + 0.12, position.y);
      mat2 rot = rotateX(bend * weight);
      p.yz = joint + rot * (p.yz - joint);
      norm.yz = rot * norm.yz;
      color = shade;
      n = normalMatrix * norm;
      vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
      v = -viewPosition.xyz;
      gl_Position = projectionMatrix * viewPosition;
    }`;

  function limb(THREE, group, shape, material, side, leg) {
    const pivot = new THREE.Group();
    const x = leg ? 0.235 : 0.31, y = leg ? 0.70 : 1.27;
    const uniforms = {
      joint: { value: leg ? [0.45, 0.016] : [1.07, -0.005] },
      ankle: { value: [0.216, 0.020] },
      bend: { value: 0 }, footAngle: { value: 0 }, leg: { value: Number(leg) }
    };
    const skin = new THREE.ShaderMaterial({
      uniforms, vertexShader: limbVertex, fragmentShader: material.fragmentShader, side: material.side
    });
    const mesh = new THREE.Mesh(shape, skin);
    mesh.position.set(-x, -y, 0);
    pivot.position.set(side * x, y, 0);
    pivot.scale.x = side;
    pivot.add(mesh);
    group.add(pivot);
    return { pivot, uniforms, skin, side };
  }

  window.makeWalkingPepe = (makePepe, THREE) => {
    const model = template(makePepe, THREE);
    const group = new THREE.Group(), body = new THREE.Group(), chest = new THREE.Group();
    group.scale.setScalar(model.scale);
    group.add(body);
    body.add(chest);
    chest.add(new THREE.Mesh(model.trunk, model.material));
    const head = new THREE.Mesh(model.head, model.material);
    head.position.copy(model.headPose.position);
    head.scale.copy(model.headPose.scale);
    head.rotation.copy(model.headPose.rotation);
    chest.add(head);
    const sides = [-1, 1];
    const legs = sides.map(side => limb(THREE, body, model.leg, model.material, side, true));
    const arms = sides.map(side => limb(THREE, chest, model.arm, model.material, side, false));
    let phase = 0, weight = 0, pace = 0;
    function update(dt, speed) {
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
      speed = Math.min(3, Math.abs(Number.isFinite(speed) ? speed : 0));
      const moving = speed > 0.012;
      const target = moving ? Math.min(1, Math.max(0.27, speed / 0.67)) : 0;
      weight += (target - weight) * (1 - Math.exp(-dt * (moving ? 13 : 17)));
      pace += (speed - pace) * (1 - Math.exp(-dt * 12));
      if (!moving && weight < 0.002) { weight = 0; phase = 0; }
      else phase = (phase + dt * Math.min(13.4, 6.5 + 4.2 * pace)) % (Math.PI * 2);
      const stride = Math.sin(phase), crossing = Math.cos(phase);
      body.position.y = -weight * (0.008 + 0.058 * stride * stride);
      body.position.x = weight * 0.018 * crossing;
      chest.rotation.y = weight * 0.047 * stride;
      chest.rotation.z = weight * 0.014 * crossing;
      head.rotation.y = model.headPose.rotation.y - 0.55 * chest.rotation.y;
      for (let i = 0; i < sides.length; i++) {
        const swing = sides[i] * stride;
        const recovery = Math.max(0, sides[i] * crossing);
        const hip = -0.53 * swing * weight;
        const knee = weight * (0.045 + 0.53 * recovery * recovery);
        const leg = legs[i], arm = arms[i];
        leg.pivot.rotation.x = hip;
        leg.uniforms.bend.value = knee;
        leg.uniforms.footAngle.value = -(hip + knee) * (1 - 0.50 * recovery);
        arm.pivot.rotation.x = 0.38 * swing * weight;
        arm.uniforms.bend.value = -(0.055 + 0.14 * weight * (1 - swing) * 0.5);
      }
    }
    update(0, 0);
    const eye=new THREE.Vector3();
    function eyeHeight(){return head.localToWorld(eye.set(0,2.45,.22)).y}
    return { group, update, eyeHeight, dispose() { for (const limb of [...legs, ...arms]) limb.skin.dispose(); } };
  };
})();
