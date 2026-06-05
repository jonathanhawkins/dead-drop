// Minimal ambient declarations for packages that ship without TypeScript types.

declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number; // 0..1
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>;
  export default convert;
}
