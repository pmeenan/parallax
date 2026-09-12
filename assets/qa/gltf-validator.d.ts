declare module "gltf-validator" {
  export function version(): string;
  export function validateBytes(
    data: Uint8Array,
    options: {
      format: "glb";
      writeTimestamp: false;
      maxIssues: number;
      externalResourceFunction: (uri: string) => Promise<Uint8Array>;
    },
  ): Promise<unknown>;
}
