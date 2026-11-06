// Lógica de G06 y G11 sin pantalla (HU0010 y HU0025): estados de las citas y de los componentes con los textos de los
// mockups, y la validación de los formularios de resultado y de dictamen.
import { describe, expect, it } from "vitest";
import { erroresDictamen, erroresResultado, etiquetaCita, etiquetaComponente, horaCorta, nombreComponente, sumarDias, tituloDia } from "./dictamen";

const cita = (o: Partial<{ estado: string; resultado_registrado: boolean; hora_inicio: string; hora_fin: string }> = {}) => ({
  estado: "reservada",
  fecha: "2027-10-27",
  hora_inicio: "08:00",
  hora_fin: "09:00",
  resultado_registrado: false,
  ...o,
});

describe("HU0025-1.0 estados de la agenda de G11 y G06", () => {
  it("HU0025-1.0 una cita es «Programada» antes de su hora, «En curso» durante ella, «Registrada» con resultado y «No asistió» con la inasistencia (hora de Lima)", () => {
    expect(etiquetaCita(cita(), new Date("2027-10-27T12:59:00Z"))).toEqual({ texto: "Programada", tono: "revision" });
    expect(etiquetaCita(cita(), new Date("2027-10-27T13:30:00Z"))).toEqual({ texto: "En curso", tono: "subsanado" });
    expect(etiquetaCita(cita(), new Date("2027-10-27T14:00:00Z"))).toEqual({ texto: "Programada", tono: "revision" });
    expect(etiquetaCita(cita({ estado: "asistio", resultado_registrado: true }))).toEqual({ texto: "Registrada", tono: "conforme" });
    expect(etiquetaCita(cita({ estado: "no_asistio", resultado_registrado: true }))).toEqual({ texto: "No asistió", tono: "observado" });
  });

  it("HU0025-1.0 el título del día, la hora corta de G06 y el día siguiente o anterior", () => {
    expect(tituloDia("2027-10-26")).toBe("Martes 26 de octubre");
    expect(horaCorta("08:00")).toBe("8:00");
    expect(horaCorta("14:30")).toBe("2:30");
    expect(horaCorta("12:00")).toBe("12:00");
    expect(sumarDias("2027-12-31", 1)).toBe("2028-01-01");
    expect(sumarDias("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("HU0025-1.0 el resultado y las observaciones son obligatorios, el resultado tiene hasta 50 caracteres y la inasistencia va por su botón", () => {
    expect(erroresResultado({ resultado: "", observaciones: " " })).toEqual({ resultado: "Ingresa el resultado", observaciones: "Ingresa las observaciones" });
    expect(erroresResultado({ resultado: "x".repeat(51), observaciones: "Bien" }).resultado).toBe("Máximo 50 caracteres");
    expect(erroresResultado({ resultado: "Inasistencia", observaciones: "No vino" }).resultado).toContain("No asistió");
    expect(erroresResultado({ resultado: "Logrado", observaciones: "Bien" })).toEqual({});
  });
});

describe("HU0010-1.0 componentes y validación del dictamen (G06)", () => {
  it("HU0010-1.0 [parte: dictamen, informe restringido y estado] cada componente muestra «Registrada» o, la entrevista, «Realizada» con su fecha; sin resultado, «Pendiente»", () => {
    const c = { id_cita: 1, fecha: "2027-10-29", hora_inicio: "15:00", resultado: "Adecuado", observaciones: null };
    expect(etiquetaComponente({ ...c, tipo_cita: "evaluacion_academica", estado: "asistio" })).toEqual({ texto: "Registrada", tono: "conforme" });
    expect(etiquetaComponente({ ...c, tipo_cita: "entrevista_padres", estado: "asistio" })).toEqual({ texto: "Realizada", tono: "conforme" });
    expect(etiquetaComponente({ ...c, tipo_cita: "evaluacion_psicologica", estado: "reservada", resultado: null })).toEqual({ texto: "Pendiente", tono: "revision" });
    expect(nombreComponente("entrevista_padres", { ...c, tipo_cita: "entrevista_padres", estado: "asistio" })).toBe("Entrevista a los padres (29 oct.)");
    expect(nombreComponente("evaluacion_academica")).toBe("Evaluación académica (Evaluador académico)");
  });

  it("HU0010-2.0 los requisitos complementarios se exigen solo con «En observación»; el resultado y las conclusiones, siempre", () => {
    expect(erroresDictamen({ dictamen: null, conclusiones: "", requisitos: "" })).toEqual({ dictamen: "Elige el resultado del dictamen", conclusiones: "Ingresa las conclusiones" });
    expect(erroresDictamen({ dictamen: "en_observacion", conclusiones: "C", requisitos: " " })).toEqual({ requisitos: "Detalla los requisitos complementarios" });
    expect(erroresDictamen({ dictamen: "no_apto", conclusiones: "C", requisitos: "" })).toEqual({});
    expect(erroresDictamen({ dictamen: "apto", conclusiones: "C", requisitos: "" })).toEqual({});
  });
});
