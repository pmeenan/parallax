import type { MaterialPlugin, PluginTextureBinding, Texture2D } from "@babylonjs/lite";

/**
 * Shared tiling detail for streamed PBR surfaces (K2 delivery, house kit GPU memory round). A
 * material's unique maps carry only its macro structure at a coarse texel density; one small,
 * seamless detail tile per material class restores the grain above that density. That class is
 * plaster pits and sand, oak fibres and pores, or the stone's tooling.
 * - R, G: a tangent-space normal offset in the base normal map's own convention, 0.5 = flat.
 * - B: an albedo ratio, 0.5 = 1.0, full scale ±DETAIL_ALBEDO_RANGE.
 *
 * The tile repeats in the material's own UV space, `uv * scale`, so an atlas keeps each strip's grain
 * along its member. Its frame is the base normal map's cotangent frame, rebuilt from the same
 * derivatives, so mirrored placements shade correctly. Mipmapping averages the tile towards flat
 * with distance, so the term fades by itself where the macro maps suffice.
 *
 * Every streamed PBR material carries the plugin, so they share one pipeline variant. Surfaces
 * without detail bind a 1×1 neutral tile with zero gains.
 */
export const PBR_DETAIL_PLUGIN_NAME = "parallax-pbr-detail";
export const DETAIL_ALBEDO_RANGE = 0.5;

/** A surface's shared detail layer. */
export interface PbrDetailSurface {
  /** The class's seamless RGBA8 tile, with its full mip chain and repeat addressing. */
  readonly texture: Texture2D;
  /** Tile repeats per unit of the material's UV, in u and v. */
  readonly uvScale: readonly [number, number];
  /** Normal offset gain (1 = the tile as authored). */
  readonly normalGain: number;
  /** Albedo ratio gain (1 = the tile as authored). */
  readonly albedoGain: number;
}

// At UPDATE_DIFFUSE, Lite's PBR shader has built `N` (the macro normal map applied) and decoded
// `baseColor`, and has not yet lit either.
const DETAIL_FRAGMENT_WGSL = [
  "{",
  "let dtUv=input.uv*material.detailParams.xy;",
  "let dtS=textureSample(detailTexture,detailSampler,dtUv);",
  "let dtN=(dtS.rg*2.0-1.0)*material.detailParams.z;",
  "let dtP1=dpdx(input.worldPos);",
  "let dtP2=dpdy(input.worldPos);",
  "let dtU1=dpdx(dtUv);",
  "let dtU2=dpdy(dtUv);",
  "let dtPerp2=cross(dtP2,N);",
  "let dtPerp1=cross(N,dtP1);",
  "let dtT=dtPerp2*dtU1.x+dtPerp1*dtU2.x;",
  "let dtB=-(dtPerp2*dtU1.y+dtPerp1*dtU2.y);",
  "let dtDet=max(dot(dtT,dtT),dot(dtB,dtB));",
  "let dtInv=select(inverseSqrt(dtDet),0.0,dtDet==0.0);",
  "N=normalize(N+(dtT*dtN.x+dtB*dtN.y)*dtInv);",
  `baseColor=baseColor*max(1.0+(dtS.b*2.0-1.0)*${DETAIL_ALBEDO_RANGE.toFixed(2)}*material.detailParams.w,0.0);`,
  "}",
].join("");

export function createPbrDetailPlugin(surface: PbrDetailSurface): MaterialPlugin {
  return {
    name: PBR_DETAIL_PLUGIN_NAME,
    getCustomCode: (shaderType) =>
      shaderType === "fragment" ? { CUSTOM_FRAGMENT_UPDATE_DIFFUSE: DETAIL_FRAGMENT_WGSL } : null,
    getUniforms: () => ({ ubo: [{ name: "detailParams", type: "vec4<f32>" }] }),
    getSamplers: () => [{ texture: "detailTexture", sampler: "detailSampler" }],
    writeUbo: (data, offsets) => {
      const at = (offsets.get("detailParams") ?? 0) / 4;
      data[at] = surface.uvScale[0];
      data[at + 1] = surface.uvScale[1];
      data[at + 2] = surface.normalGain;
      data[at + 3] = surface.albedoGain;
    },
    bindTextures: (out: PluginTextureBinding[]) => {
      out.push({ texture: surface.texture });
    },
    getActiveTextures: (out) => {
      out.push(surface.texture);
    },
  };
}
