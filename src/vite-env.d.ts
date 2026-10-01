// Vite env read by this package. Consumers get `import.meta.env` from
// vite/client; this declares the same shape for the package's own typecheck.

interface ImportMetaEnv {
  readonly VITE_CORS_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
