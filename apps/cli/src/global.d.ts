// Declaration shims for modules without bundled @types in this workspace.
// These are minimal stubs to satisfy TypeScript when explicit "types" is set.

declare module 'prompts' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function prompts(questions: any | any[]): Promise<Record<string, any>>;
  export = prompts;
}

declare module 'jpeg-js' {
  interface RawImageData {
    width: number;
    height: number;
    data: Buffer | Uint8Array;
  }
  interface DecodeResult extends RawImageData {
    comments?: string[];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function decode(jpegData: Buffer | Uint8Array, opts?: Record<string, any>): DecodeResult;
  function encode(rawImageData: RawImageData, quality?: number): { data: Buffer; width: number; height: number };
  export { decode, encode };
}
