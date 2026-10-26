// Fallos de los flujos de n8n que avisa el workflow técnico registro-errores (C2, ADR-06). Solo quedan en el log de la
// API, con identificadores: el mensaje del error de n8n puede traer correos u otros datos personales y no se recibe.
// No hay tabla para esto (sin tablas nuevas): la ejecución fallida se revisa en n8n con su id.
export interface ErrorFlujo {
  flujo: string;
  nodo: string;
  id_ejecucion: string;
}

export function registrarErrorFlujo(e: ErrorFlujo): void {
  console.warn(`Fallo en n8n (flujo=${e.flujo}, nodo=${e.nodo}, ejecución=${e.id_ejecucion})`);
}
