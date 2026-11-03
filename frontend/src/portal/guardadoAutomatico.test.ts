// Guardado automático del borrador de la ficha (HU0005-2.0): lógica propia del cliente, probada con temporizadores falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearGuardadoAutomatico, segundoApoderadoSinGuardar, textoGuardado } from "./guardadoAutomatico";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HU0005-2.0 guardado automático del borrador", () => {
  it("HU0005-2.0 [parte: borrador] guarda 2 s después del último cambio y varios cambios seguidos hacen un solo guardado", async () => {
    const guardar = vi.fn(async () => true);
    const auto = crearGuardadoAutomatico(guardar);

    auto.cambio();
    await vi.advanceTimersByTimeAsync(1500);
    auto.cambio(); // reinicia la espera
    await vi.advanceTimersByTimeAsync(1999);
    expect(guardar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar).toHaveBeenCalledWith(false);
    expect(auto.hayPendiente()).toBe(false);
  });

  it("HU0005-2.0 [parte: borrador] al salir guarda de inmediato lo pendiente, con keepalive si la pestaña se oculta, y sin cambios no guarda", async () => {
    const guardar = vi.fn(async () => true);
    const auto = crearGuardadoAutomatico(guardar);

    await auto.ahora();
    expect(guardar).not.toHaveBeenCalled(); // nada que guardar

    auto.cambio();
    await auto.ahora(true);
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(guardar).toHaveBeenCalledTimes(1); // el temporizador ya no guarda otra vez
  });

  it("HU0005-2.0 [parte: borrador] si el guardado falla, los cambios siguen pendientes y se reintentan al salir", async () => {
    const guardar = vi.fn<(keepalive: boolean) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const auto = crearGuardadoAutomatico(guardar);

    auto.cambio();
    await vi.advanceTimersByTimeAsync(2000);
    expect(auto.hayPendiente()).toBe(true);

    await auto.ahora();
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(auto.hayPendiente()).toBe(false);
  });

  it("HU0005-2.0 [parte: borrador] un guardado explícito cancela el guardado automático pendiente: no se guarda dos veces lo mismo", async () => {
    const guardar = vi.fn(async () => true);
    const auto = crearGuardadoAutomatico(guardar);

    auto.cambio();
    auto.cancelar();
    await vi.advanceTimersByTimeAsync(5000);

    expect(guardar).not.toHaveBeenCalled();
  });

  it("HU0005-2.0 [parte: borrador] con cambios mientras se guarda, los nuevos se guardan después sin solaparse", async () => {
    let liberar: (ok: boolean) => void = () => undefined;
    const guardar = vi.fn(() => new Promise<boolean>((r) => (liberar = r)));
    const auto = crearGuardadoAutomatico(guardar);

    auto.cambio();
    await vi.advanceTimersByTimeAsync(2000); // empieza el primero y queda en curso
    auto.cambio();
    await vi.advanceTimersByTimeAsync(2000); // el segundo espera al primero
    expect(guardar).toHaveBeenCalledTimes(1);
    liberar(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(guardar).toHaveBeenCalledTimes(2);
  });
});

describe("HU0005-2.0 textos del indicador de guardado", () => {
  const base = new Date("2026-11-03T10:00:00Z");
  const hace = (min: number) => new Date(base.getTime() - min * 60_000).toISOString();

  it("HU0005-2.0 [parte: borrador] «Borrador guardado hace N minutos», como en el mockup P05", () => {
    expect(textoGuardado(null, base)).toBe("");
    expect(textoGuardado(hace(0), base)).toBe("Borrador guardado hace unos segundos");
    expect(textoGuardado(hace(1), base)).toBe("Borrador guardado hace 1 minuto");
    expect(textoGuardado(hace(2), base)).toBe("Borrador guardado hace 2 minutos");
    expect(textoGuardado(hace(60), base)).toBe("Borrador guardado hace 1 hora");
    expect(textoGuardado(hace(180), base)).toBe("Borrador guardado hace 3 horas");
  });

  it("HU0005-2.0 [parte: segundo apoderado parcial] el bloque no se guardó solo si falta alguno de los cinco datos que la base exige", () => {
    expect(segundoApoderadoSinGuardar([{ campo: "segundo_apoderado.nombres" }])).toBe(true);
    expect(segundoApoderadoSinGuardar([{ campo: "segundo_apoderado.apellidos" }])).toBe(true);
    expect(segundoApoderadoSinGuardar([{ campo: "segundo_apoderado.parentesco" }])).toBe(true);
    expect(segundoApoderadoSinGuardar([{ campo: "segundo_apoderado.telefono" }])).toBe(true);
    expect(segundoApoderadoSinGuardar([{ campo: "segundo_apoderado.correo" }])).toBe(true);
    // El DNI y la condición laboral admiten nulos: con ellos pendientes el bloque sí se guardó.
    expect(segundoApoderadoSinGuardar([{ campo: "segundo_apoderado.dni" }, { campo: "segundo_apoderado.condicion_laboral" }])).toBe(false);
    expect(segundoApoderadoSinGuardar([{ campo: "postulante.nombres" }])).toBe(false);
  });
});
