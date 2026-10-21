# Guía de instalación paso a paso

Con esta guía dejas funcionando el control de conexión para tu equipo usando solo **Supabase** y **GitHub**. Calcula unos 45 minutos para la parte central y unos 5 minutos por computador.

```
 Computador de cada persona          Supabase                       GitHub Pages
 ┌──────────────────────┐  latido   ┌─────────────────────┐      ┌───────────────────┐
 │ agente.exe           │ ─cada 1m─▶│ base de datos       │◀────▶│ index.html        │ empleados
 │ internet · GitHub    │           │ + funciones seguras │      │ admin.html        │ administrador
 │ PostgreSQL · uso     │           └─────────────────────┘      └───────────────────┘
 └──────────────────────┘
```

---

## Parte 1 — Supabase (base de datos)

### Paso 1. Crear el proyecto
1. Entra a <https://supabase.com> e inicia sesión.
2. Pulsa **New project**.
3. Ponle un nombre (por ejemplo `control-conexion`) y una contraseña de base de datos. Guarda la contraseña, aunque esta guía no la usa.
4. Región: elige la más cercana a tu equipo. Para Ecuador sirven **East US** o **São Paulo**.
5. Pulsa **Create new project** y espera uno o dos minutos.

### Paso 2. Crear las tablas y funciones
1. En el menú izquierdo abre **SQL Editor** y pulsa **New query**.
2. Abre el archivo `supabase/instalar.sql`, copia **todo** su contenido y pégalo.
3. Pulsa **Run**. Al final debe aparecer: *"Instalación completa. Siguiente paso: fijar la clave de administrador."*

> Si Supabase muestra un aviso de "operación destructiva", confirma. El script no borra datos y se puede ejecutar varias veces.

### Paso 3. Fijar la clave de administrador
En una consulta nueva del SQL Editor ejecuta (cambia la clave, mínimo 12 caracteres):

```sql
select privado.fijar_clave_admin('Escribe-Aqui-Una-Clave-Larga-2026');
```

Es la clave para entrar al panel. Guárdala en un lugar seguro. Para cambiarla más adelante, ejecuta lo mismo con la clave nueva.

**Opcional, ajustes** (los valores por defecto ya sirven para Ecuador):

```sql
update privado.ajustes set
  zona_horaria        = 'America/Guayaquil',  -- define cuándo empieza "hoy"
  minutos_desconexion = 3,                    -- sin reportes por más de N min = desconectado
  minutos_inactividad = 10,                   -- sin teclado ni ratón por más de N min = inactivo
  dias_conservar      = 60;                   -- historial minuto a minuto que se guarda
```

### Paso 4. Copiar la URL y la clave pública
1. Pulsa el botón **Connect**, arriba en el proyecto, o ve a **Project Settings → API Keys**.
2. Copia la **Project URL**, que se ve así: `https://abcdefghijk.supabase.co`.
3. Copia la clave **publishable** (`sb_publishable_...`). Si tu proyecto muestra la clave **anon public** (`eyJ...`), también sirve.
4. Abre `docs/config.js` con el Bloc de notas y reemplaza los dos valores:

```js
window.CONFIG = {
  SUPABASE_URL: 'https://abcdefghijk.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxx'
};
```

> **Nunca uses la clave `secret` ni `service_role`.** La clave publishable está hecha para ser pública: los datos están protegidos por los tokens de cada persona y por la clave de administrador.

---

## Parte 2 — GitHub (código y páginas web)

### Paso 5. Crear el repositorio y subir los archivos
1. En GitHub pulsa **+ → New repository**.
2. Nombre: `control-conexion`. Visibilidad: **Public**. Con el plan gratuito de GitHub, las páginas web solo se pueden publicar desde repositorios públicos. No hay problema: el código no contiene contraseñas.
3. Pulsa **Create repository**.

Luego sube los archivos de una de estas dos formas:

**Opción A — desde el navegador (sin instalar nada)**
1. En el repositorio vacío, pulsa **uploading an existing file**.
2. Arrastra **el contenido** de la carpeta `control-conexion`: las carpetas `.github`, `agente`, `docs`, `pruebas`, `supabase` y los archivos sueltos.
   - En Mac las carpetas que empiezan con punto están ocultas: pulsa `Cmd + Shift + .` en Finder para verlas.
   - **No subas** listas reales de personas, archivos `agente.conf` ni el .zip de configuraciones.
3. Pulsa **Commit changes**.

**Opción B — con git**
```bash
cd control-conexion
git init && git add . && git commit -m "Control de conexión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/control-conexion.git
git push -u origin main
```

Revisa que la carpeta `.github/workflows` aparezca en GitHub. Sin ella no se generarán los ejecutables del paso 9.

### Paso 6. Publicar las páginas (GitHub Pages)
1. En el repositorio ve a **Settings → Pages**.
2. En **Source** elige **Deploy from a branch**.
3. En **Branch** elige `main` y la carpeta **`/docs`**, y pulsa **Save**.
4. Espera uno o dos minutos y recarga la página. Arriba aparecerá la dirección, del tipo `https://TU-USUARIO.github.io/control-conexion/`.

Esas son tus dos páginas:
- **Empleados:** `https://TU-USUARIO.github.io/control-conexion/`
- **Administrador:** `https://TU-USUARIO.github.io/control-conexion/admin.html`

### Paso 7. Probar el panel
Abre `admin.html` y entra con la clave del paso 3. Debe aparecer el panel vacío.

| Si ves… | Solución |
|---|---|
| "Falta configurar config.js" | No guardaste el paso 4, o GitHub Pages aún no se actualizó (espera 1–2 min) |
| "Supabase no encuentra las funciones" | Repite el paso 2 |
| "Aún no se ha fijado la clave de administrador" | Repite el paso 3 |
| "La clave de Supabase no es válida" | Revisa la clave en `config.js` (paso 4) |

---

## Parte 3 — Personas y agentes

### Paso 8. Cargar a las personas
1. Prepara la lista en Excel con estas columnas en la primera fila: `ciudad`, `nombre`, `email`, `equipo`, `github_user`. La última es opcional; si la llenas, el panel cuenta los commits del día. Usa `empleados.ejemplo.csv` como modelo.
2. Guárdala como **CSV**. Excel en español la guarda con `;` y el panel lo acepta.
3. En el panel pulsa **Ajustes del agente** y llena:
   - **PG_URL:** la base PostgreSQL de trabajo que cada computador debe poder alcanzar. Déjalo vacío si no quieres revisarla.
   - **GITHUB_REPO:** el repositorio que deben poder leer, por ejemplo `miempresa/backend`.
   - **Token de GitHub (opcional):** sirve para que el panel cuente commits más rápido. Basta un token de solo lectura.

   Pulsa **Guardar**. Estos datos se guardan solo en tu navegador.
4. Pulsa **Cargar CSV** y elige el archivo.
5. Pulsa **Descargar configuraciones (.zip)**. Obtienes una carpeta por persona, cada una con su `agente.conf`.

> Para agregar a una sola persona usa **+ Persona → Descargar agente.conf**.
> Para volver a descargar la configuración de alguien, haz clic en su fila → **Descargar agente.conf**.

### Paso 9. Generar el agente (una sola vez)
1. En GitHub abre la pestaña **Actions**. Si pide habilitar los workflows, acepta.
2. A la izquierda elige **Generar agente** y pulsa **Run workflow → Run workflow**.
3. Espera unos 5 minutos hasta que salga el check verde.
4. En la página principal del repositorio, a la derecha, abre **Releases**. Encontrarás:
   - `agente-windows.zip`, con `agente.exe` y el instalador
   - `agente-mac.zip`, para Mac con chip Apple
   - `agente-linux.zip`

### Paso 10. Instalar en cada computador (unos 5 minutos cada uno, **sin permisos de administrador**)

**Windows**
1. Descomprime `agente-windows.zip` en cualquier carpeta, por ejemplo en Descargas.
2. Copia a esa misma carpeta el `agente.conf` **de esa persona**.
3. Haz doble clic en **`instalar-windows.bat`**.
   - Si aparece "Windows protegió su PC", pulsa **Más información → Ejecutar de todas formas**. Ocurre porque el programa no tiene firma digital.
   - Si el antivirus lo bloquea, agrega una excepción para `agente.exe`.
4. Listo. El agente corre en segundo plano, sin ventana, y se inicia solo al encender sesión.
5. En menos de un minuto la persona aparece en el panel.

Para quitarlo, usa `desinstalar-windows.bat`.

**Mac**
1. Descomprime `agente-mac.zip` y copia ahí el `agente.conf` de la persona.
2. Abre **Terminal**, escribe `bash ` (con un espacio), arrastra `instalar-mac.sh` a la ventana y pulsa Enter.

**Linux**
Igual que en Mac, con `bash instalar-linux.sh`. Para medir inactividad instala `xprintidle`; esto sí necesita sudo.

### Paso 11. Uso diario
- Cada persona abre la página de empleados e ingresa su **token**. Es la línea `TOKEN=` de su `agente.conf`; también puedes copiarlo desde el panel.
- Pulsa **Iniciar jornada** al empezar y **Terminar jornada** al salir. El navegador recuerda el token.
- El administrador ve todo en `admin.html`, que se actualiza cada 30 segundos.

---

## Paso 12 (recomendado). Limpieza automática
Cada día se guardan unas 27.000 filas, una por persona y minuto. Para que el plan gratuito de Supabase no se llene:

1. En Supabase ve a **Integrations → Cron** y habilítalo. En proyectos antiguos está en **Database → Extensions → pg_cron**.
2. En el SQL Editor ejecuta:

```sql
select cron.schedule('limpiar-latidos', '0 8 * * *', 'select privado.limpiar()');
```

La limpieza corre todos los días a las 03:00 de Ecuador (08:00 UTC) y borra el detalle minuto a minuto con más de 60 días de antigüedad. Las horas trabajadas no se borran.

---

## Problemas frecuentes

| Problema | Causa y solución |
|---|---|
| La persona sale **desconectada** | El agente no corre o no llega a Supabase. Revisa el archivo `agente.log` en `%LOCALAPPDATA%\ControlConexion` (escríbelo en la barra del Explorador de Windows). |
| `agente.log` dice "Token no válido" | El `agente.conf` es de otra persona, o se generó un token nuevo. Descárgalo de nuevo desde el panel. |
| GitHub en **Falla**, "Sin acceso a…" | El repositorio es privado: pon un token personal de GitHub en `GITHUB_TOKEN` de su `agente.conf`. |
| PostgreSQL en **Falla** | Esa persona no llega a la base de trabajo (VPN, firewall, contraseña). El mensaje exacto aparece en el detalle del panel. |
| Internet en Falla, pero sí navega | La red usa un proxy corporativo. Consulta con TI. |
| Inactividad "Sin dato" | En Linux falta `xprintidle`. En Windows y Mac funciona sin instalar nada. |
| La persona cerró el agente | Aparece desconectada a los 3 minutos. Para impedir que pueda cerrarlo, hay que instalarlo como servicio, y eso sí requiere permisos de administrador. |
| Supabase "pausó" el proyecto | Los proyectos gratuitos se pausan tras días sin uso. Con los agentes enviando datos no debería pasar. Si ocurre, reactívalo desde el panel de Supabase. |

## Seguridad y privacidad
- Las tablas están en un esquema privado que la API de Supabase no publica. Solo se accede a través de funciones que exigen el token de la persona o la clave de administrador.
- Cada intento fallido de clave de administrador espera 1 segundo, para frenar a quien intente adivinarla.
- Si un `agente.conf` se filtra, haz clic en la persona → **Generar token nuevo**.
- El sistema **no** toma capturas de pantalla ni registra lo que se escribe. Solo mide conexión y si hubo actividad. Informa a tu equipo antes de instalarlo y revisa la normativa laboral y de protección de datos aplicable.

---

## Versión 2: tiempo conectado, páginas de trabajo y uso de aplicaciones

**Qué agrega**
- **Tiempo conectado del día:** cuánto tiempo estuvo el computador reportando, cuánto de ese tiempo hubo actividad y a qué hora fue la primera conexión.
- **Páginas de trabajo:** el agente revisa cada minuto si las páginas que definas responden y en cuántos milisegundos.
- **Aplicaciones y sitios:** tiempo por aplicación (Excel, Teams…) y por sitio web (GitHub, Outlook…). Solo cuenta el tiempo con actividad. Se guarda únicamente el nombre del sitio, sacado del título de la pestaña: no la dirección, ni el contenido, ni lo que se escribe. Cada empleado ve su propio resumen.

**Configuración** (en el panel → **Ajustes** → *Ajustes generales*)
- Escribe las páginas de trabajo, una por línea (máximo 10), por ejemplo `https://sistema.telconet.ec`.
- Activa o desactiva *Registrar tiempo por aplicación y sitio web*.
- Los agentes aplican los cambios solos en su siguiente reporte, sin reinstalar.

**Privacidad:** antes de activar el registro de aplicaciones y sitios, informa a tu equipo qué se mide y para qué. En Ecuador aplica la Ley Orgánica de Protección de Datos Personales; consulta con tu área legal o de talento humano.

---

## Versión 3: fecha, reporte histórico y exportación a Excel

- **Selector de fecha** en el panel (filtro **Fecha**). En "hoy" el panel va en vivo y se refresca cada 30 s; al elegir un día anterior muestra el **reporte histórico** de ese día: horas de jornada, horas conectado, quién trabajó y las aplicaciones y sitios usados.
- **Exportar** genera un archivo **Excel (.xlsx)** de la fecha elegida, con dos hojas:
  - **Resumen:** una fila por persona (ciudad, equipo, jornada, conectado, activo, primera y última conexión, fallas, computador).
  - **Aplicaciones:** una fila por persona y aplicación/sitio, con el tiempo.
- El historial se conserva. La limpieza automática (paso 12) solo borra el detalle minuto a minuto de más de 60 días; los resúmenes por día de uso se guardan un año.

Esta versión **no cambia el agente**: no hace falta regenerar ni reinstalar nada en los computadores. Solo se actualizan Supabase y las páginas.
