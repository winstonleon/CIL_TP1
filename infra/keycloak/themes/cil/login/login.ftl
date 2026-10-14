<#--
  G01 · Acceso del personal (HU0021). Se usa solo en el cliente gestion-interna (atributo login_theme).
  Conserva los ids que esperan Keycloak y las pruebas: el formulario kc-form-login (con id antes de action,
  S0-A4 y S0-A5), los campos username y password y el botón kc-login (S0-C6).
  «Colegio Internacional de Lima · Campaña 2027» está fijo: HU0022 lo reemplaza por la campaña activa (C23).
  Sin logo hasta que el colegio entregue el archivo (plan HU0021, P5).
-->
<#assign errorDeCampos = messagesPerField.existsError('username','password')>
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Gestión de Admisión · Acceso del personal</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/g01.css">
</head>
<body>
<div class="g01">
  <aside class="g01-roles" aria-label="Accesos por rol">
    <span class="g01-colegio">Colegio Internacional de Lima · Campaña 2027</span>
    <p class="g01-lema">Cada rol ve solo lo que le corresponde</p>
    <ul class="g01-lista">
      <li>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M5.5 5h13l2 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z"/></svg>
        Secretaría: expedientes, visitas y configuración
      </li>
      <li>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>
        Tesorería: pagos y documentación financiera
      </li>
      <li>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>
        Psicología: evaluaciones, entrevistas y dictámenes
      </li>
      <li>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8.5h8"/><path d="M8 12h8"/><path d="M8 15.5h5"/></svg>
        Evaluación académica: resultados
      </li>
      <li>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/></svg>
        Dirección: vacantes, indicadores y usuarios
      </li>
    </ul>
  </aside>

  <main class="g01-principal">
    <section class="g01-tarjeta" aria-labelledby="g01-titulo">
      <div class="g01-cabecera">
        <h1 id="g01-titulo">Gestión de Admisión</h1>
        <p>Acceso exclusivo para el personal del colegio.</p>
      </div>

      <#-- Mensajes globales de Keycloak (p. ej. cuenta desactivada, sesión vencida). Los de usuario o contraseña
           incorrectos van junto a los campos. -->
      <#if !errorDeCampos && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
        <div class="g01-mensaje g01-mensaje-${message.type}" role="alert" id="kc-mensaje">${message.summary}</div>
      </#if>

      <#if realm.password>
      <form id="kc-form-login" action="${url.loginAction}" method="post" novalidate="novalidate"
            onsubmit="document.getElementById('kc-login').disabled = true; return true;">
        <#if !usernameHidden??>
        <div class="g01-campo">
          <label for="username">Correo institucional <span class="g01-obligatorio" aria-hidden="true">*</span></label>
          <input id="username" name="username" type="email" value="${(login.username!'')}" autocomplete="username"
                 autofocus aria-invalid="<#if errorDeCampos>true<#else>false</#if>"
                 <#if errorDeCampos>aria-describedby="input-error"</#if>>
        </div>
        </#if>
        <div class="g01-campo">
          <label for="password">Contraseña <span class="g01-obligatorio" aria-hidden="true">*</span></label>
          <input id="password" name="password" type="password" autocomplete="current-password"
                 <#if usernameHidden??>autofocus</#if> aria-invalid="<#if errorDeCampos>true<#else>false</#if>"
                 <#if errorDeCampos>aria-describedby="input-error"</#if>>
        </div>
        <#if errorDeCampos>
          <p class="g01-error" id="input-error" aria-live="polite">${messagesPerField.getFirstError('username','password')}</p>
        </#if>
        <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
        <button id="kc-login" name="login" type="submit" class="g01-boton">Ingresar</button>
      </form>
      </#if>

      <div class="g01-aviso">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.5"/></svg>
        <p>Las cuentas las crea la Dirección. Si es tu primera vez, usa el enlace que llegó a tu correo para definir tu contraseña.</p>
      </div>

      <#-- La recuperación de contraseña se habilita en HU0023 (realm.resetPasswordAllowed). -->
      <#if realm.resetPasswordAllowed>
        <a class="g01-olvido" href="${url.loginResetCredentialsUrl}">¿Olvidaste tu contraseña?</a>
      </#if>
    </section>
  </main>
</div>
</body>
</html>
