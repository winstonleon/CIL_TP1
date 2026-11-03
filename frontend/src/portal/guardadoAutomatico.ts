// Guardado automático del borrador de la ficha (HU0005-2.0): guarda 2 s después del último cambio, y de inmediato al salir
// de la pantalla o al ocultar la pestaña. Un solo guardado a la vez; si hay cambios mientras se guarda, se guardan después.
// `guardar` devuelve false si falló: los cambios siguen pendientes y se reintentan con el próximo cambio o al salir.

export const ESPERA_GUARDADO_MS = 2000;

export interface GuardadoAutomatico {
  cambio(): void; // hubo un cambio en el formulario
  ahora(keepalive?: boolean): Promise<void>; // guarda ya, si hay cambios sin guardar
  cancelar(): void; // un guardado explícito ya incluye los cambios pendientes
  hayPendiente(): boolean;
}

export function crearGuardadoAutomatico(
  guardar: (keepalive: boolean) => Promise<boolean>,
  esperaMs = ESPERA_GUARDADO_MS,
): GuardadoAutomatico {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let pendiente = false;
  let enCurso: Promise<void> | null = null;

  const detener = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
  };

  async function ahora(keepalive = false): Promise<void> {
    detener();
    if (enCurso) await enCurso;
    if (!pendiente) return;
    pendiente = false;
    enCurso = guardar(keepalive).then(
      (ok) => {
        if (!ok) pendiente = true;
      },
      () => {
        pendiente = true;
      },
    );
    try {
      await enCurso;
    } finally {
      enCurso = null;
    }
  }

  return {
    cambio() {
      pendiente = true;
      detener();
      temporizador = setTimeout(() => void ahora(), esperaMs);
    },
    ahora,
    cancelar() {
      detener();
      pendiente = false;
    },
    hayPendiente: () => pendiente,
  };
}

// «Borrador guardado hace N minutos» (P05). Sin fecha, todavía no hay nada guardado.
export function textoGuardado(guardadoEn: string | null, ahora: Date = new Date()): string {
  if (!guardadoEn) return "";
  const minutos = Math.max(0, Math.floor((ahora.getTime() - new Date(guardadoEn).getTime()) / 60_000));
  if (minutos < 1) return "Borrador guardado hace unos segundos";
  if (minutos === 1) return "Borrador guardado hace 1 minuto";
  if (minutos < 60) return `Borrador guardado hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  return horas === 1 ? "Borrador guardado hace 1 hora" : `Borrador guardado hace ${horas} horas`;
}

// Aviso del bloque del segundo apoderado a medias (HU0005-2.0 [parte: segundo apoderado parcial], decisión i de John,
// 03/11/2026): la API no lo guarda hasta que tenga estos cinco datos (columnas NOT NULL, compromiso C43).
export const CAMPOS_BLOQUE_SEGUNDO = ["nombres", "apellidos", "telefono", "correo", "parentesco"] as const;
export const TEXTO_SEGUNDO_PARCIAL =
  "Guardado, excepto el segundo apoderado: completa nombres, apellidos, teléfono, correo y parentesco para guardarlo";

export const segundoApoderadoSinGuardar = (pendientes: { campo: string }[]): boolean =>
  pendientes.some((p) => CAMPOS_BLOQUE_SEGUNDO.some((c) => p.campo === `segundo_apoderado.${c}`));
