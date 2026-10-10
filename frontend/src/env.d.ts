/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_OIDC_AUTHORITY: string;
  readonly VITE_OIDC_CLIENT_ID_PORTAL: string;
  readonly VITE_OIDC_CLIENT_ID_GESTION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
