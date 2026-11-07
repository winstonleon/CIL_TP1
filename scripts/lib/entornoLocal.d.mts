// Tipos de scripts/lib/entornoLocal.mjs para importarlo desde TypeScript (api/scripts).
export declare function motivoNoLocal(entorno?: NodeJS.ProcessEnv): string | null;
export declare function motivoFueraDeDev(entorno?: NodeJS.ProcessEnv): string | null;
export declare function prepararEntornoHost(entorno?: NodeJS.ProcessEnv): void;
