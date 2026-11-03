// Identificador de usuario de Keycloak (sub del token). Se valida antes de usarlo como uuid en SQL: un valor mal formado
// daría un error de pg en vez de «no existe».
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
