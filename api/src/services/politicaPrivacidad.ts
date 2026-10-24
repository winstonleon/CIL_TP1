// Política de privacidad vigente (ADR-17; plan HU0001, P4). P01 la recibe de GET /publico/solicitud-informacion y el
// servidor guarda esta versión en consentimiento.version_politica (varchar(20)) al registrar la solicitud.
// PROVISIONAL (compromiso C29): el colegio debe entregar el texto y la versión reales antes del despliegue al VPS.
// Los consentimientos con la versión «borrador-1» no valen como evidencia en producción. No se inventa el texto legal:
// va entre corchetes, como en los mockups. Cambiar la política exige un commit y un despliegue.
export const POLITICA_PRIVACIDAD = {
  version: "borrador-1",
  texto: "[Texto de la Política de privacidad del CIL: por definir con el colegio]",
} as const;
