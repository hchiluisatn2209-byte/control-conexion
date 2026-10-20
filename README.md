# Control de Conexión

Control de jornada y conexión tipo Time Doctor para equipos de ~50 personas, usando solo **Supabase** (base de datos y API) y **GitHub** (código, páginas web y ejecutables).

- **Agente** (`agente/`): corre en cada computador sin permisos de administrador. Cada minuto verifica internet, acceso a GitHub, conexión a PostgreSQL e inactividad de teclado y ratón.
- **Supabase** (`supabase/instalar.sql`): tablas en un esquema privado y funciones seguras.
- **Páginas** (`docs/`): publicadas con GitHub Pages. `index.html` para empleados y `admin.html` para el administrador.
- **GitHub Actions**: pruebas automáticas y generación de `agente.exe` para Windows, Mac y Linux.

👉 **Instalación: sigue [GUIA.md](GUIA.md).**

| Carpeta | Contenido |
|---|---|
| `supabase/` | Script único de instalación |
| `docs/` | Páginas web; edita `config.js` |
| `agente/` | Agente e instaladores |
| `pruebas/` | Pruebas automáticas de las funciones SQL |
| `.github/workflows/` | Pruebas y generación del agente |
