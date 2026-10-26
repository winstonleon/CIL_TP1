# Documentos protegidos y configuración de Claude Code

- No se escribe en `CLAUDE.md`, en la memoria de Claude Code ni en `.claude/` sin pedírselo antes a John, salvo en `.claude/rules/` cuando el plan de la HU lo indique.

Los documentos protegidos (`docs/backlog/**`, `docs/tesis/**`, `docs/decisiones.md`, `docs/der/**`, `docs/ui/**`, con `Edit` denegado en `.claude/settings.json`) no se editan: el cambio se entrega como parche en `test-results/parches/HUxxxx-….patch` (carpeta ignorada por git), verificado con `git check-ignore -v` y `git apply --check -v`. Lo aplica John, sin commit, y él decide cuándo.

Si el parche debe ir sobre una copia ya parcheada, se arma desde la copia actual. Un `cp` de Bash que nombra la ruta protegida puede quedar bloqueado por la regla `deny` aunque solo lea el archivo: en ese caso se arma el parche a mano con el contexto que da Read o Grep (líneas con número) y se valida igual con `git apply --check`. No reintentar el `cp`.

**Por qué:** John pide que los documentos fuente de verdad solo cambien por decisión explícita suya (HU0022 y HU0001, 23/10/2026).
**Cómo se aplica:** en cada plan que toque un documento protegido, listar el parche y su verificación; al cerrar el tramo, decir qué parches quedan por aplicar.
