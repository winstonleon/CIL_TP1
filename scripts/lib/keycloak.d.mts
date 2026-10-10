// Tipos de scripts/lib/keycloak.mjs para importarlo desde TypeScript (api/scripts/seed.ts).
export declare const RAIZ: string;
export declare function cargarEntorno(): void;
export declare function requerida(nombre: string): string;
export declare function urlKeycloak(): string;
export declare function tokenAdmin(): Promise<string>;
export declare function adminApi(
  token: string,
): (metodo: string, ruta: string, cuerpo?: unknown) => Promise<{ res: Response; datos: any }>;
