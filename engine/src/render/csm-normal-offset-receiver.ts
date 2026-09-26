// Lite 1.31.1 exposes no hook for the CSM receiver shader: its generator registers the stock
// fragment factories in a private module, which every Standard and PBR receiver then reads. The
// Parallax receiver replaces them after the generator is created (engine package 6). The PSO
// contract pins the composed receiver WGSL, so a Lite change that bypasses this override fails
// warmup instead of silently restoring the stock receiver.
import {
  setCsmPbrReceiverFactory,
  setCsmStdReceiverFactory,
  // @ts-expect-error The pinned package does not export or declare its receiver registry.
} from "../../node_modules/@babylonjs/lite/lib/shadow/csm-receiver-registry.js";

/** Lookup offset along the receiver's geometric normal, in texels of the selected cascade. The
 * stock 5×5 PCF tent reaches about 2.5 texels, so a sloped receiver compares against its own
 * caster depth there: the grass acne bands (conform result). Three texels also let the caster
 * bias halve (`DIRECTIONAL_SHADOW_CONFIG`); 1.5 needed the old 0.12 m. */
export const CSM_NORMAL_OFFSET_TEXELS = 3;

interface CsmShadowLightSlot {
  readonly lightIndex: number;
}

/** Lite's private shader-fragment shape, as its stock CSM factory returns it. */
interface LiteShaderFragment {
  readonly _id: string;
  readonly _varyings: readonly unknown[];
  readonly _bindings: readonly unknown[];
  readonly _helperFunctions: string;
  readonly _fragmentSlots: Readonly<Record<string, string>>;
}

interface ReceiverExpressions {
  readonly worldPos: string;
  readonly normal: string;
  readonly viewZ: string;
  readonly slot: string;
}

const STAGE_FRAGMENT = 2;

/**
 * Lite's CSM receiver (`csm-shadow-fragment-core`, Apache-2.0), unchanged except that each
 * cascade lookup moves the world position along the geometric normal. The offset is the selected
 * cascade's world-space texel size, from the length of its light-space X row, times
 * `CSM_NORMAL_OFFSET_TEXELS`, scaled by the sine of the angle between the normal and the light
 * (its depth row), so surfaces facing the light barely move and contact stays attached.
 */
export function createNormalOffsetCsmFragment(
  id: string,
  shadowLights: readonly CsmShadowLightSlot[],
  expressions: ReceiverExpressions,
): LiteShaderFragment {
  const bindings: unknown[] = [];
  const helpers: string[] = [];
  const lines: string[] = [];
  for (const { lightIndex } of shadowLights) {
    const s = `_${lightIndex}`;
    bindings.push(
      {
        _name: `csmTex${s}`,
        _type: { _kind: "texture", _textureType: "texture_depth_2d_array", _sampleType: "depth" },
        _group: "shadow",
        _visibility: STAGE_FRAGMENT,
      },
      {
        _name: `csmComp${s}`,
        _type: { _kind: "sampler", _samplerType: "sampler_comparison" },
        _group: "shadow",
        _visibility: STAGE_FRAGMENT,
      },
      {
        _name: `csmInfo${s}`,
        _type: { _kind: "uniform-buffer" },
        _group: "shadow",
        _visibility: STAGE_FRAGMENT,
      },
    );
    const tap = (u: number, v: number, wu: string, wv: string) =>
      `sh+=${wu}*${wv}*textureSampleCompareLevel(csmTex${s},csmComp${s},base+vec2<f32>(u[${u}],v[${v}]),layer,depthRef);`;
    const taps = [
      tap(0, 0, "uvw0.x", "uvw0.y"),
      tap(1, 0, "uvw1.x", "uvw0.y"),
      tap(2, 0, "uvw2.x", "uvw0.y"),
      tap(0, 1, "uvw0.x", "uvw1.y"),
      tap(1, 1, "uvw1.x", "uvw1.y"),
      tap(2, 1, "uvw2.x", "uvw1.y"),
      tap(0, 2, "uvw0.x", "uvw2.y"),
      tap(1, 2, "uvw1.x", "uvw2.y"),
      tap(2, 2, "uvw2.x", "uvw2.y"),
    ].join("");
    helpers.push(
      `struct csmInfo${s}Uniforms{cascadeTransforms:array<mat4x4<f32>,4>,viewFrustumZ:vec4<f32>,frustumLengths:vec4<f32>,shadowsInfo:vec4<f32>,csmParams:vec4<f32>};`,
      `fn computeFallOffCsm${s}(value:f32,clipSpace:vec2<f32>,frustumEdgeFalloff:f32)->f32{let mask=smoothstep(1.0-frustumEdgeFalloff,1.00000012,clamp(dot(clipSpace,clipSpace),0.0,1.0));return mix(value,1.0,mask);}` +
        `fn csmSample${s}(layer:i32,worldPos:vec4<f32>,normal:vec3<f32>)->f32{let m=csmInfo${s}.cascadeTransforms[layer];let mapSz=csmInfo${s}.shadowsInfo.y;let invMapSz=csmInfo${s}.shadowsInfo.z;` +
        `let texelWorld=2.0*invMapSz/max(length(vec3<f32>(m[0].x,m[1].x,m[2].x)),1e-6);let lightAxis=normalize(vec3<f32>(m[0].z,m[1].z,m[2].z));let cosine=clamp(abs(dot(normal,lightAxis)),0.0,1.0);` +
        `let offsetPos=vec4<f32>(worldPos.xyz+normal*(texelWorld*${CSM_NORMAL_OFFSET_TEXELS.toFixed(3)}*sqrt(1.0-cosine*cosine)),1.0);` +
        `let posFromLight=m*offsetPos;let clipSpace=posFromLight.xyz/posFromLight.w;let uv=vec2<f32>(0.5*clipSpace.x+0.5,0.5-0.5*clipSpace.y);let depthRef=clamp(clipSpace.z,0.0,0.99999994);` +
        `var tc=uv*mapSz+0.5;let st=fract(tc);let base=(floor(tc)-0.5)*invMapSz;let uvw0=4.0-3.0*st;let uvw1=vec2<f32>(7.0);let uvw2=1.0+3.0*st;` +
        `let u=vec3<f32>((3.0-2.0*st.x)/uvw0.x-2.0,(3.0+st.x)/uvw1.x,st.x/uvw2.x+2.0)*invMapSz;let v=vec3<f32>((3.0-2.0*st.y)/uvw0.y-2.0,(3.0+st.y)/uvw1.y,st.y/uvw2.y+2.0)*invMapSz;` +
        `var sh=0.0;${taps}sh/=144.0;sh=mix(csmInfo${s}.shadowsInfo.x,1.0,sh);return computeFallOffCsm${s}(sh,clipSpace.xy,csmInfo${s}.shadowsInfo.w);}` +
        `fn computeShadowCSM${s}(worldPos:vec4<f32>,viewZ:f32,normal:vec3<f32>)->f32{let nCascades=i32(csmInfo${s}.csmParams.x);var idx=-1;var diff=0.0;for(var i=0;i<nCascades;i=i+1){diff=csmInfo${s}.viewFrustumZ[i]-viewZ;if(diff>=0.0){idx=i;break;}}if(idx<0){idx=nCascades-1;}` +
        `var shadow=csmSample${s}(idx,worldPos,normal);let frustumLength=csmInfo${s}.frustumLengths[idx];let diffRatio=clamp(diff/frustumLength,0.0,1.0)*csmInfo${s}.csmParams.y;` +
        `if(idx<nCascades-1&&diffRatio<1.0){let nextShadow=csmSample${s}(idx+1,worldPos,normal);shadow=mix(nextShadow,shadow,diffRatio);}return shadow;}`,
    );
    lines.push(
      `shadowFactors[${lightIndex}]=computeShadowCSM${s}(vec4<f32>(${expressions.worldPos},1.0),${expressions.viewZ},normalize(${expressions.normal}));`,
    );
  }
  return {
    _id: id,
    _varyings: [],
    _bindings: bindings,
    _helperFunctions: helpers.join("\n"),
    _fragmentSlots: { [expressions.slot]: lines.join("\n") },
  };
}

/** Standard receivers: Lite's world-position varying and the lit normal (the greybox has no bump). */
export function createStdNormalOffsetCsmFragment(shadowLights: readonly CsmShadowLightSlot[]) {
  return createNormalOffsetCsmFragment("parallax-std-csm-shadow", shadowLights, {
    worldPos: "input.vp",
    normal: "normalW",
    viewZ: "(scene.view * vec4<f32>(input.vp, 1.0)).z",
    slot: "AD",
  });
}

/** PBR receivers: the interpolated geometric normal, not the normal-mapped one. */
export function createPbrNormalOffsetCsmFragment(shadowLights: readonly CsmShadowLightSlot[]) {
  return createNormalOffsetCsmFragment("parallax-pbr-csm-shadow", shadowLights, {
    worldPos: "input.worldPos",
    normal: "N_geom",
    viewZ: "(scene.view * vec4<f32>(input.worldPos, 1.0)).z",
    slot: "AS",
  });
}

/** Call after `createCsmDirectionalShadowGenerator`, which registers the stock factories. */
export function installNormalOffsetCsmReceivers(): void {
  (setCsmStdReceiverFactory as (factory: typeof createStdNormalOffsetCsmFragment) => void)(
    createStdNormalOffsetCsmFragment,
  );
  (setCsmPbrReceiverFactory as (factory: typeof createPbrNormalOffsetCsmFragment) => void)(
    createPbrNormalOffsetCsmFragment,
  );
}
