// Navegación de la gestión interna por rol (rules/frontend.md: la barra lateral muestra solo las opciones del
// rol de la sesión). Etiquetas, íconos y áreas tomados de los mockups G02–G11. Las opciones sin `ruta` todavía
// no tienen pantalla (llegan con sus HU) y se muestran como texto no navegable (plan HU0021, P4).
// Cada opción declara qué columnas de la matriz «Permisos por rol» de G10 habilita. Las columnas de información
// restringida (documentación financiera e informe psicológico) no salen de aquí sino de la política de la API.

export const ROLES_PERSONAL = ["secretaria", "tesoreria", "psicologa", "evaluador_academico", "directora"] as const;
export type RolPersonal = (typeof ROLES_PERSONAL)[number];

export type ColumnaMenu = "datos_postulante" | "documentos" | "visitas" | "configuracion" | "usuarios_indicadores";
export type ColumnaRestringida = "documentacion_financiera" | "informe_psicologico";
export type ColumnaPermiso = ColumnaMenu | ColumnaRestringida;

export interface OpcionMenu {
  etiqueta: string;
  icono: string; // contenido del <svg viewBox="0 0 24 24"> del mockup
  ruta?: string;
  columnas: ColumnaMenu[];
}

// Etiqueta corta del rol (tabla y formulario de G10).
export const ETIQUETA_ROL: Record<RolPersonal, string> = {
  secretaria: "Secretaría",
  tesoreria: "Tesorería",
  psicologa: "Psicología",
  evaluador_academico: "Evaluación académica",
  directora: "Dirección",
};

// Área que muestran la barra lateral y el encabezado (G02–G11).
export const AREA_ROL: Record<RolPersonal, string> = {
  secretaria: "Secretaría de Admisión",
  tesoreria: "Tesorería",
  psicologa: "Psicología",
  evaluador_academico: "Evaluación académica",
  directora: "Dirección",
};

const ICONO = {
  bandeja: '<path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M5.5 5h13l2 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z"/>',
  visitas: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  configuracion:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3"/><path d="M12 18.5v3"/><path d="M2.5 12h3"/><path d="M18.5 12h3"/><path d="M5.3 5.3l2.1 2.1"/><path d="M16.6 16.6l2.1 2.1"/><path d="M5.3 18.7l2.1-2.1"/><path d="M16.6 7.4l2.1-2.1"/>',
  tesoreria: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
  psicologia: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  vacantes: '<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/>',
  indicadores: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  usuarios:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4"/><path d="M18 14.8c1.8.7 3 2.3 3.5 4.7"/>',
  evaluacion: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8.5h8"/><path d="M8 12h8"/><path d="M8 15.5h5"/>',
};

export const MENU: Record<RolPersonal, OpcionMenu[]> = {
  secretaria: [
    { etiqueta: "Bandeja de expedientes", icono: ICONO.bandeja, columnas: ["datos_postulante", "documentos"] },
    { etiqueta: "Visitas guiadas", icono: ICONO.visitas, columnas: ["visitas"] },
    { etiqueta: "Configuración de campaña", icono: ICONO.configuracion, columnas: ["configuracion"] },
  ],
  tesoreria: [{ etiqueta: "Validaciones de Tesorería", icono: ICONO.tesoreria, columnas: ["datos_postulante"] }],
  psicologa: [{ etiqueta: "Agenda y dictámenes", icono: ICONO.psicologia, columnas: ["datos_postulante"] }],
  evaluador_academico: [{ etiqueta: "Evaluaciones académicas", icono: ICONO.evaluacion, columnas: ["datos_postulante"] }],
  directora: [
    { etiqueta: "Adjudicación de vacantes", icono: ICONO.vacantes, columnas: ["datos_postulante"] },
    { etiqueta: "Indicadores", icono: ICONO.indicadores, columnas: ["usuarios_indicadores"] },
    { etiqueta: "Usuarios y roles", icono: ICONO.usuarios, ruta: "/gestion/usuarios", columnas: ["usuarios_indicadores"] },
  ],
};

// Rol de personal de la sesión (cada cuenta del personal tiene uno solo), o null si no es personal.
export function rolPersonalDe(roles: readonly string[]): RolPersonal | null {
  return ROLES_PERSONAL.find((r) => roles.includes(r)) ?? null;
}

// Columnas de la matriz «Permisos por rol» de G10, en el orden del mockup.
export const COLUMNAS_PERMISOS: { columna: ColumnaPermiso; etiqueta: string }[] = [
  { columna: "datos_postulante", etiqueta: "Datos del postulante" },
  { columna: "documentos", etiqueta: "Documentos" },
  { columna: "documentacion_financiera", etiqueta: "Doc. financiera" },
  { columna: "informe_psicologico", etiqueta: "Informe psicológico" },
  { columna: "visitas", etiqueta: "Visitas" },
  { columna: "configuracion", etiqueta: "Configuración" },
  { columna: "usuarios_indicadores", etiqueta: "Usuarios e indicadores" },
];

export type PoliticaRestringida = Record<ColumnaRestringida, string[]>;

// Genera la matriz: las columnas restringidas salen de la política de la API (GET /personal/permisos, R2 y R3);
// las demás, de las opciones de menú de cada rol.
export function matrizPermisos(politica: PoliticaRestringida): { rol: RolPersonal; permisos: Record<ColumnaPermiso, boolean> }[] {
  return ROLES_PERSONAL.map((rol) => {
    const deMenu = new Set(MENU[rol].flatMap((o) => o.columnas));
    const permisos = Object.fromEntries(
      COLUMNAS_PERMISOS.map(({ columna }) => [
        columna,
        columna === "documentacion_financiera" || columna === "informe_psicologico"
          ? (politica[columna] ?? []).includes(rol)
          : deMenu.has(columna),
      ]),
    ) as Record<ColumnaPermiso, boolean>;
    return { rol, permisos };
  });
}
