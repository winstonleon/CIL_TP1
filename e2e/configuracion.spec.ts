// HU0022 · G09 (configuración de la campaña) contra el entorno dev, como secretaria.prueba. Requiere los grados de la
// campaña activa (npm run db:seed) y los usuarios de prueba.
// Limpieza (C16): cada prueba restaura el grado que modifica y quita el requisito y el horario que crea, en un finally
// por la API. Los eventos cambio_configuracion quedan en la bitácora, que es de solo inserción.
// La 2.0 no tiene E2E: en dev no hay vacantes adjudicadas y crearlas sería inventarlas (C25, HU0012).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { entrarEnGestion, FRONTEND, iniciarSesion, llamarApi } from "./ayudantes";

const usuarios: { username: string; firstName: string; lastName: string; rol: string }[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../infra/keycloak/usuarios-prueba.json"), "utf8"),
);
const usuarioDeRol = (rol: string) => usuarios.find((u) => u.rol === rol)!;
const CONTRASENA = process.env.KEYCLOAK_TEST_USER_PASSWORD!;
const CAMPANA = process.env.CAMPANA_ACTIVA!;
const marca = () => `${Date.now()}-${randomBytes(2).toString("hex")}`;

interface Grado {
  id_grado: number;
  nombre_grado: string;
  vacantes_autorizadas: number;
  requiere_jornada_observacion: boolean;
  requiere_evaluacion_psicologica: boolean;
  requiere_evaluacion_academica: boolean;
  monto_cuota_ingreso: string;
  max_fracciones: number;
}

// Token de la secretaria de prueba, para preparar y limpiar por la API.
async function tokenSecretaria(browser: Browser): Promise<string> {
  const token = await iniciarSesion(browser, usuarioDeRol("secretaria").username, CONTRASENA);
  expect(token, "la secretaria de prueba no pudo iniciar sesión").toBeTruthy();
  return token!;
}

async function abrirG09(page: Page) {
  await entrarEnGestion(page, usuarioDeRol("secretaria").username, CONTRASENA);
  await page.getByRole("link", { name: "Configuración de campaña" }).click();
  await expect(page).toHaveURL(`${FRONTEND}/gestion/configuracion`);
  await expect(page.getByRole("tab", { name: "Grados, vacantes y evaluaciones" })).toHaveAttribute("aria-selected", "true");
}

test.describe("HU0022 G09 · configuración de la campaña", () => {
  test("HU0022-1.0 [parte: almacenamiento] la secretaría cambia en G09 vacantes, una evaluación, la cuota y el máximo de fracciones de un grado, y siguen al recargar", async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    const token = await tokenSecretaria(browser);
    const configuracion = await llamarApi(request, "get", "/configuracion", token);
    expect(configuracion.status()).toBe(200);
    const original: Grado = (await configuracion.json()).grados.find((g: Grado) => g.nombre_grado === "4 años");
    expect(original, "falta el grado «4 años» de la campaña activa: ejecuta npm run db:seed").toBeTruthy();
    const nombre = original.nombre_grado;

    try {
      await abrirG09(page);
      const grados = page.locator("#g09-panel-grados");
      await grados.getByLabel(`Vacantes autorizadas de ${nombre}`).fill(String(original.vacantes_autorizadas + 1));
      const academica = grados.getByRole("button", { name: `Académica · ${nombre}` });
      await academica.click();
      await expect(academica).toHaveAttribute("aria-pressed", String(!original.requiere_evaluacion_academica));
      await grados.getByRole("button", { name: "Guardar" }).click();
      await expect(grados.getByRole("status")).toHaveText("Cambios guardados.");

      await page.getByRole("tab", { name: "Cuota de ingreso" }).click();
      const cuota = page.locator("#g09-panel-cuota");
      await cuota.getByLabel(`Cuota de ingreso de ${nombre}`).fill(String(Number(original.monto_cuota_ingreso) + 100));
      await cuota.getByLabel(`Máximo de fracciones de ${nombre}`).fill(String(original.max_fracciones + 1));
      await cuota.getByRole("button", { name: "Guardar" }).click();
      await expect(cuota.getByRole("status")).toHaveText("Cambios guardados.");

      await page.reload();
      await expect(grados.getByLabel(`Vacantes autorizadas de ${nombre}`)).toHaveValue(String(original.vacantes_autorizadas + 1));
      await expect(grados.getByRole("button", { name: `Académica · ${nombre}` })).toHaveAttribute("aria-pressed", String(!original.requiere_evaluacion_academica));
      await page.getByRole("tab", { name: "Cuota de ingreso" }).click();
      await expect(cuota.getByLabel(`Cuota de ingreso de ${nombre}`)).toHaveValue(String(Number(original.monto_cuota_ingreso) + 100));
      await expect(cuota.getByLabel(`Máximo de fracciones de ${nombre}`)).toHaveValue(String(original.max_fracciones + 1));
    } finally {
      const restaurado = await llamarApi(request, "patch", "/configuracion/grados", token, {
        grados: [
          {
            id_grado: original.id_grado,
            vacantes_autorizadas: original.vacantes_autorizadas,
            requiere_jornada_observacion: original.requiere_jornada_observacion,
            requiere_evaluacion_psicologica: original.requiere_evaluacion_psicologica,
            requiere_evaluacion_academica: original.requiere_evaluacion_academica,
            monto_cuota_ingreso: Number(original.monto_cuota_ingreso),
            max_fracciones: original.max_fracciones,
          },
        ],
      });
      expect(restaurado.status(), "no se pudo restaurar el grado").toBe(200);
    }
  });

  test("HU0022-1.0 [parte: almacenamiento] la secretaría registra, edita y quita un requisito con su condición; un nombre repetido (sin distinguir mayúsculas) se rechaza", async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    const token = await tokenSecretaria(browser);
    const grado: Grado = (await (await llamarApi(request, "get", "/configuracion", token)).json()).grados.find((g: Grado) => g.nombre_grado === "4 años");
    const documento = `E2E hu0022-${marca()}`;

    try {
      await abrirG09(page);
      await page.getByRole("tab", { name: "Requisitos documentales" }).click();
      const panel = page.locator("#g09-panel-requisitos");
      await panel.getByLabel("Grado").selectOption({ label: grado.nombre_grado });

      await panel.getByLabel("Documento").fill(documento);
      await panel.getByLabel("Categoría").selectOption({ label: "Financiero · solo Tesorería" });
      await panel.getByLabel("Condición de aplicación").selectOption({ label: "Si es dependiente" });
      await expect(panel.getByLabel("Se exige a cada apoderado")).toBeChecked();
      await expect(panel.getByLabel("Se exige a cada apoderado")).toBeDisabled();
      await panel.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(panel.getByRole("status")).toHaveText("Requisito agregado.");
      const fila = panel.getByRole("row").filter({ hasText: documento });
      await expect(fila).toContainText("Si es dependiente");

      // Nombre repetido con otras mayúsculas: la API responde 409 y el mensaje queda junto al campo.
      await panel.getByLabel("Documento").fill(documento.toUpperCase());
      await panel.getByLabel("Categoría").selectOption({ label: "Postulante y padres" });
      await panel.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(panel.getByLabel("Documento")).toHaveAttribute("aria-invalid", "true");
      await expect(panel.locator("#g09-req-documento-error")).toHaveText("El grado ya tiene un requisito con ese nombre (sin distinguir mayúsculas)");

      await panel.getByRole("button", { name: `Editar ${documento}` }).click();
      await panel.getByLabel("Obligatorio").uncheck();
      await panel.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(panel.getByRole("status")).toHaveText("Cambios guardados.");
      await expect(fila.getByRole("cell").nth(3)).toHaveText("No");

      await panel.getByRole("button", { name: `Quitar ${documento}` }).click();
      await expect(panel.getByRole("dialog")).toContainText(`¿Quitar el requisito ${documento} de ${grado.nombre_grado}?`);
      await panel.getByRole("dialog").getByRole("button", { name: "Quitar" }).click();
      await expect(panel.getByRole("status")).toHaveText("Requisito quitado.");
      await expect(fila).toHaveCount(0);
    } finally {
      const lista: { id_requisito: number; tipo_documento: string }[] = await (
        await llamarApi(request, "get", `/configuracion/grados/${grado.id_grado}/requisitos`, token)
      ).json();
      for (const r of lista.filter((x) => x.tipo_documento.toLowerCase() === documento.toLowerCase())) {
        expect((await llamarApi(request, "delete", `/configuracion/requisitos/${r.id_requisito}`, token)).status()).toBe(204);
      }
    }
  });

  test("HU0022-1.0 [parte: almacenamiento] la secretaría registra un horario de visita con la directora, se rechaza uno superpuesto y lo quita", async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    const token = await tokenSecretaria(browser);
    const directora = usuarioDeRol("directora");
    const nombreDirectora = `${directora.firstName} ${directora.lastName}`;
    // Fecha lejana y distinta en cada corrida: no se cruza con horarios de demostración ni con corridas anteriores.
    const dia = 1 + Math.floor(Math.random() * 28);
    const fecha = `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const [anio, mes, d] = fecha.split("-");
    const fechaVisible = `${d}/${mes}/${anio}`;
    let idDirectora: number | undefined;

    try {
      const responsables: { id_personal: number; nombre: string; rol: string }[] = await (
        await llamarApi(request, "get", "/configuracion/responsables", token)
      ).json();
      idDirectora = responsables.find((r) => r.rol === "directora" && r.nombre === nombreDirectora)?.id_personal;
      expect(idDirectora, "la directora de prueba no figura entre los responsables: ejecuta npm run db:seed").toBeTruthy();

      await abrirG09(page);
      await page.getByRole("tab", { name: "Horarios" }).click();
      const panel = page.locator("#g09-panel-horarios");
      const llenar = async (inicio: string, fin: string) => {
        // «Tipo de cita» es también el filtro de la tabla: se usa el campo del formulario.
        await panel.locator("#g09-hor-tipo").selectOption({ label: "Visita guiada" });
        await panel.locator("#g09-hor-responsable").selectOption({ label: nombreDirectora });
        await panel.getByLabel("Fecha").fill(fecha);
        await panel.getByLabel("Hora de inicio").fill(inicio);
        await panel.getByLabel("Hora de fin").fill(fin);
        await panel.getByRole("button", { name: "Guardar" }).click();
      };

      await llenar("09:00", "10:00");
      await expect(panel.getByRole("status")).toHaveText("Horario agregado.");
      const fila = panel.getByRole("row").filter({ hasText: fechaVisible });
      await expect(fila).toContainText("09:00 – 10:00");
      await expect(fila).toContainText(nombreDirectora);

      await llenar("09:30", "10:30");
      await expect(panel.locator("#g09-hor-inicio-error")).toHaveText(`${nombreDirectora} ya tiene un horario que se cruza con este el ${fechaVisible}.`);
      await expect(fila).toHaveCount(1);

      await fila.getByRole("button", { name: `Quitar el horario del ${fechaVisible}, 09:00 – 10:00` }).click();
      await panel.getByRole("dialog").getByRole("button", { name: "Quitar" }).click();
      await expect(panel.getByRole("status")).toHaveText("Horario quitado.");
      await expect(fila).toHaveCount(0);
    } finally {
      const lista: { id_horario: number; id_personal: number; fecha: string }[] = await (await llamarApi(request, "get", "/configuracion/horarios", token)).json();
      for (const h of lista.filter((x) => x.id_personal === idDirectora && x.fecha === fecha)) {
        expect((await llamarApi(request, "delete", `/configuracion/horarios/${h.id_horario}`, token)).status()).toBe(204);
      }
    }
  });

  test("G09 la directora no ve «Configuración de campaña» y /gestion/configuracion la devuelve a /gestion", async ({ page }) => {
    await entrarEnGestion(page, usuarioDeRol("directora").username, CONTRASENA);
    await expect(page.getByTestId("menu-rol")).not.toContainText("Configuración de campaña");
    await page.goto(`${FRONTEND}/gestion/configuracion`);
    await expect(page).toHaveURL(`${FRONTEND}/gestion`);
    await expect(page.getByRole("tablist", { name: "Configuración de la campaña" })).toHaveCount(0);
  });

  test("C23 la barra lateral y el título de G09 muestran la campaña activa (CAMPANA_ACTIVA)", async ({ page }) => {
    await abrirG09(page);
    await expect(page.getByTestId("marca-campana")).toHaveText(`CIL · Campaña ${CAMPANA}`);
    await expect(page.getByTestId("titulo-pantalla")).toHaveText(`Configuración de la campaña ${CAMPANA}`);
  });
});
