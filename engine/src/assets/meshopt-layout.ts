export interface MeshoptCompressionExtension {
  readonly buffer?: number;
}

export interface MeshoptBufferView {
  readonly buffer?: number;
  readonly extensions?: Readonly<{
    readonly EXT_meshopt_compression?: MeshoptCompressionExtension;
  }>;
}

export interface MeshoptDocumentLayout {
  readonly buffers?: readonly unknown[];
  readonly bufferViews?: readonly MeshoptBufferView[];
}

/** Reports violations of the canonical single-buffer shape supported by Babylon Lite 1.12.0. */
export function canonicalMeshoptLayoutErrors(document: MeshoptDocumentLayout): readonly string[] {
  const errors: string[] = [];
  if ((document.buffers?.length ?? 0) !== 1) {
    errors.push(`expected exactly one glTF buffer; received ${document.buffers?.length ?? 0}`);
  }
  for (const [index, view] of (document.bufferViews ?? []).entries()) {
    const extension = view.extensions?.EXT_meshopt_compression;
    if (extension !== undefined && (extension.buffer ?? 0) !== 0) {
      errors.push(`bufferView ${index} has meshopt source buffer ${extension.buffer}; expected 0`);
    }
    if (extension === undefined && (view.buffer ?? 0) !== 0) {
      errors.push(`bufferView ${index} has uncompressed buffer ${view.buffer}; expected 0`);
    }
  }
  return Object.freeze(errors);
}
