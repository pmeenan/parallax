declare module "parallax:draco-decoder-factory" {
  interface DracoFactoryOptions {
    readonly locateFile?: (fileName: string) => string;
    readonly [key: string]: unknown;
  }

  type DracoDecoderFactory = (options: DracoFactoryOptions) => Promise<unknown>;
  const factory: DracoDecoderFactory;
  export default factory;
}

declare module "parallax:msc-transcoder-factory" {
  interface MscFactoryOptions {
    readonly wasmBinary: ArrayBuffer;
    readonly [key: string]: unknown;
  }

  type MscTranscoderFactory = (options: MscFactoryOptions) => Promise<unknown>;
  const factory: MscTranscoderFactory;
  export default factory;
}
