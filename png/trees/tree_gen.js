/* ============================================================
 * tree_gen.js — Generador procedural de árboles voxel
 * ------------------------------------------------------------
 * Extraído del bloque /*GEN_START*\/ … /*GEN_END*\/ de
 * png/trees/generador arboles.html (el visor three.js).  Solo
 * cambia UNA línea: el presupuesto de ramas (`budget`) es ahora
 * un parámetro (P.budget) para que el worldgen lo pueda bajar.
 *
 * Qué hace: ramas recursivas que se bifurcan en ángulo áureo
 * (espiral de filotaxis), radio que se afina, jitter, tropismo
 * (fototropismo/caída) y copas elipsoidales con borde irregular.
 * Dos PRNG mulberry32 separados (estructura y follaje): mover los
 * controles de hojas no cambia la forma de las ramas.
 *
 * USO:
 *   const vox = generateTree(P, seed)   // P = perfil completo, seed = int32
 *   // vox: Map clave K(x,y,z) -> {x, y, z, t}
 *   //   t === 0 -> tronco/rama    t === 1 -> hoja    t === 2 -> enredadera
 *   // Coordenadas LOCALES al árbol: tronco en (0,0,0), y crece hacia arriba.
 *
 * El volcado a bloques del mundo (tronco->oakLog, hoja->leaves,
 * enredadera->sin bloque aún) lo hace Chunk.populate() en game.js.
 * ============================================================ */
(function (root) {
	'use strict';

	/*GEN_START*/
	function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
	const K=(x,y,z)=>(x+128)|((y+128)<<8)|((z+128)<<16);
	const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
	function norm(a){const l=Math.hypot(a[0],a[1],a[2])||1;a[0]/=l;a[1]/=l;a[2]/=l;return a}

	/* Genera el árbol como un Map de voxels {x,y,z,t}  t:0 = tronco/rama, t:1 = hoja.
	   Dos generadores aleatorios separados: uno para la estructura y otro para las hojas,
	   así mover los controles de follaje no cambia la forma de las ramas. */
	function generateTree(P, seed){
	  const rb=mulberry32(seed|0);            // estructura
	  const rl=mulberry32((seed|0)*31+977);   // hojas
	  const vox=new Map();
	  const inb=(x,y,z)=>x>-100&&x<100&&z>-100&&z<100&&y<120;
	  const putLog=(x,y,z)=>{ if(y<0||!inb(x,y,z))return; vox.set(K(x,y,z),{x,y,z,t:0}); };
	  const putLeaf=(x,y,z)=>{
	    if(y<2||!inb(x,y,z))return false;
	    const k=K(x,y,z); if(vox.has(k))return false;
	    vox.set(k,{x,y,z,t:1}); return true;
	  };

	  // Todo el leño es de 1 bloque, como en Minecraft. Se rellenan los saltos
	  // diagonales para que cada bloque quede unido por una cara al anterior.
	  const putVine=(x,y,z)=>{
	    if(y<1||!inb(x,y,z))return false;
	    const k=K(x,y,z); if(vox.has(k))return false;
	    vox.set(k,{x,y,z,t:2}); return true;
	  };
  function logStep(c,pv){
    const q=[Math.round(c[0]),Math.round(c[1]),Math.round(c[2])];
    if(pv){
      const dx=q[0]-pv[0],dy=q[1]-pv[1],dz=q[2]-pv[2];
      if(Math.abs(dx)+Math.abs(dy)+Math.abs(dz)>1){
        if(dy!==0) putLog(pv[0],q[1],pv[2]);
        if(dx!==0&&dz!==0) putLog(q[0],q[1],pv[2]);
        else if(dy===0) putLog(q[0],q[1],pv[2]);
      }
    }
    putLog(q[0],q[1],q[2]);
    return q;
  }

	  // Los árboles bajos (jóvenes) tienen la copa a escala de su altura
	  const sizeF=Math.max(0.4,Math.min(1,P.height/(P.refH||P.height)));
	  function leafBlob(c,R,squash){
	    if(R<0.9)return;
	    R=Math.max(1.7,R*sizeF);          // copa mínima: un árbol joven siempre tiene follaje
	    const ry=Math.max(0.9,R*squash);
	    const x0=Math.round(c[0]),y0=Math.round(c[1]),z0=Math.round(c[2]);
	    const Rx=Math.ceil(R),Ry=Math.ceil(ry);
	    for(let dx=-Rx;dx<=Rx;dx++)for(let dy=-Ry;dy<=Ry;dy++)for(let dz=-Rx;dz<=Rx;dz++){
	      const ex=(x0+dx-c[0])/R, ey=(y0+dy-c[1])/ry, ez=(z0+dz-c[2])/R;
	      const q=ex*ex+ey*ey+ez*ez;
	      if(q>1)continue;
	      if(rl()>P.leafDensity*(1.5-1.2*q))continue;   // borde irregular
	      const placed=putLeaf(x0+dx,y0+dy,z0+dz);
	      if(placed && P.hang>0 && dy<=0 && rl()<P.hang){
	        const l=2+Math.floor(rl()*P.hangLen);
	        for(let k=1;k<=l;k++) putLeaf(x0+dx,y0+dy-k,z0+dz);
	      }
	    }
	  }

	  let budget=P.budget||7000; // tope de ramas (el worldgen lo baja)
	  const lean=[(rb()-0.5)*2,(rb()-0.5)*2];

	  function branch(start,dir,len,r0,depth){
	    if(budget--<=0)return;
	    const pos=start.slice(), d=norm(dir.slice());
	    const steps=Math.max(2,Math.ceil(len*2));
	    const rEnd=depth===0? r0*0.5 : Math.max(0.45,r0*0.4);
	    let pv=null;

	    // Puntos donde nacen las ramas hijas (azimut en ángulo áureo => espiral natural)
	    const kids=[];
	    if(depth<P.levels && (depth===0||len>3)){
	      const n= depth===0 ? P.branches
	             : Math.round(P.subBranches*Math.pow(0.75,depth-1));
	      const s0= depth===0 ? P.branchStart : 0.3;
	      for(let i=0;i<n;i++){
	        const u=(i+0.25+rb()*0.5)/n;
	        const t=Math.min(1,s0+(1-s0)*u);
	        kids.push({step:Math.min(steps,Math.floor(t*steps)),u,az:i*2.39996+rb()*0.9+depth*1.3});
	      }
	    }

	    for(let i=0;i<=steps;i++){
	      const t=i/steps;
	      const r=Math.max(0.5,r0+(rEnd-r0)*t);
	      pv=logStep(pos,pv);
	      if(depth===0&&P.thick){putLog(pv[0]+1,pv[1],pv[2]);putLog(pv[0],pv[1],pv[2]+1);putLog(pv[0]+1,pv[1],pv[2]+1);}

	      if(P.leafAlong && depth>=1 && i%2===0 && t>0.12)
	        leafBlob(pos,P.leafR*(1-0.55*t),P.leafSquash);

	      for(const k of kids){
	        if(k.step!==i)continue;
	        const up=Math.abs(d[1])>0.95?[1,0,0]:[0,1,0];
	        const U=norm(cross(d,up)), V=cross(d,U);
	        let ang,clen;
	        if(depth===0){
	          ang=P.angle*(1.15-0.35*k.u)*(0.85+rb()*0.3);
	          const f=P.conical ? (1-k.u)*0.95+0.1 : 1-0.5*k.u;
	          clen=P.height*P.lenBase*f*(0.85+rb()*0.3);
	        }else{
	          ang=P.angle*(0.75+rb()*0.5);
	          clen=len*P.lenFactor*(0.75+rb()*0.5);
	        }
	        const a=ang*Math.PI/180, s=Math.sin(a), c=Math.cos(a);
	        const cd=[
	          d[0]*c+(U[0]*Math.cos(k.az)+V[0]*Math.sin(k.az))*s,
	          d[1]*c+(U[1]*Math.cos(k.az)+V[1]*Math.sin(k.az))*s,
	          d[2]*c+(U[2]*Math.cos(k.az)+V[2]*Math.sin(k.az))*s];
	        // las sub-ramas no se doblan hacia el suelo salvo en árboles de ramas caídas
	        if(depth>=1 && P.tropism>-0.3 && cd[1]<0.05) cd[1]=Math.abs(cd[1])*0.5+0.05;
	        branch(pos,cd,clen,Math.max(0.5,r*P.childRadius),depth+1);
	      }

	      // avanzar y orientar
	      pos[0]+=d[0]*0.5; pos[1]+=d[1]*0.5; pos[2]+=d[2]*0.5;
	      const j=P.jitter*(depth===0?0.5:1);
	      d[0]+=(rb()-0.5)*j; d[1]+=(rb()-0.5)*j*0.6; d[2]+=(rb()-0.5)*j;
	      if(depth>0) d[1]+=P.tropism*0.1;                 // fototropismo / caída
	      else { d[0]+=lean[0]*P.lean*0.004; d[2]+=lean[1]*P.lean*0.004; }
	      norm(d);
	    }

	    // Las ramas finales siempre llevan hojas (así los árboles bajos no quedan pelados)
	    if(P.leafR>0 && (depth>=P.leafMinDepth || kids.length===0)){
	      const f=(depth>=P.levels?1:0.7)*(depth===0?0.8:1);
	      leafBlob(pos,P.leafR*f*(0.8+rl()*0.4),P.leafSquash);
	    }
	  }

	  const tilt=0.12*P.lean;
	  branch([0,0,0],[lean[0]*tilt,1,lean[1]*tilt],P.height,P.trunkR,0);
	  if(P.vines>0){
	    const logs=[],leaves=[];
	    for(const o of vox.values()) (o.t===0?logs:leaves).push(o);
	    for(const o of logs){
	      if(o.y<3)continue;
	      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
	        if(vox.has(K(o.x+dx,o.y,o.z+dz)))continue;
	        if(rl()<P.vines*0.06){
	          const l=3+Math.floor(rl()*9);
	          for(let k=0;k<l;k++) if(!putVine(o.x+dx,o.y-k,o.z+dz))break;
	        }
	      }
	    }
	    for(const o of leaves){
	      if(vox.has(K(o.x,o.y-1,o.z)))continue;
	      if(rl()<P.vines*0.05){
	        const l=1+Math.floor(rl()*7);
	        for(let k=1;k<=l;k++) if(!putVine(o.x,o.y-k,o.z))break;
	      }
	    }
	  }
	  return vox;
	}
	/*GEN_END*/

	/* ------------------------------------------------------------
	 * Perfiles WORLDGEN — copias completas y autocontenidas de los
	 * presets del visor (png/trees/generador arboles.html), retocadas
	 * para el mundo:
	 *   - vines: 0  (aún no hay bloque de enredadera; t===2 se ignora)
	 *   - budget: 1500 (no hace falta el tope de 7000 del visor)
	 *   - refH: altura de referencia de la especie adulta.  populate()
	 *     varía P.height por árbol; refH fijo hace que los ejemplares
	 *     bajos saquen copa de escalden (árbol joven), como en el visor.
	 *   - heightVar: rango extra de altura que añade populate() con
	 *     el hash de la columna (generateTree no lo lee).
	 * Mapa de bloques (lo hace game.js):
	 *   roble  -> oakLog    + leaves   (1/8 blossomLeaves)
	 *   abedul -> birchLog  + birchLeaves
	 *   sauce  -> darkOakLog + follaje de pantano
	 * ------------------------------------------------------------ */
	const WORLDGEN = {
		roble: {
			height: 9, heightVar: 2, refH: 9,
			trunkR: 2.3, branches: 6, subBranches: 3, levels: 3, angle: 62,
			tropism: .08, jitter: .3, leafR: 2.6, leafDensity: .85, lenBase: .58,
			lenFactor: .72, branchStart: .26, childRadius: .55, leafSquash: .75,
			leafAlong: false, conical: false, lean: .9, hang: 0, hangLen: 6,
			leafMinDepth: 3, swamp: false, thick: false, vines: 0, budget: 1500,
		},
		abedul: {
			height: 13, heightVar: 3, refH: 13,
			trunkR: 1.1, branches: 9, subBranches: 3, levels: 2, angle: 34,
			tropism: .5, jitter: .1, leafR: 2.6, leafDensity: .7, lenBase: .3,
			lenFactor: .6, branchStart: .4, childRadius: .55, leafSquash: 1.1,
			leafAlong: false, conical: false, lean: .5, hang: 0, hangLen: 6,
			leafMinDepth: 1, swamp: false, thick: false, vines: 0, budget: 1500,
		},
		sauce: {
			height: 7, heightVar: 2, refH: 7,
			trunkR: 1.9, branches: 7, subBranches: 4, levels: 2, angle: 60,
			tropism: -.45, jitter: .14, leafR: 2.8, leafDensity: .8, lenBase: .42,
			lenFactor: .7, branchStart: .5, childRadius: .55, leafSquash: .9,
			leafAlong: false, conical: false, lean: .4, hang: .12, hangLen: 6,
			leafMinDepth: 1, swamp: true, thick: false, vines: 0, budget: 1500,
		},
	};

	const api = { generateTree, mulberry32, WORLDGEN };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.TreeGen = api;
})(typeof self !== 'undefined' ? self : this);
