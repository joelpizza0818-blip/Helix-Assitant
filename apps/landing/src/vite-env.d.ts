// <reference types="vite/client" />

declare module '*.glb' {
  const assetUrl: string;
  export default assetUrl;
}
