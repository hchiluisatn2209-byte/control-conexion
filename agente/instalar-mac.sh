#!/bin/bash
# Instala el agente para el usuario actual en macOS. NO necesita permisos de administrador.
# Uso: abre Terminal en esta carpeta y ejecuta:  bash instalar-mac.sh
set -e
cd "$(dirname "$0")"
DEST="$HOME/Library/Application Support/ControlConexion"
PLIST="$HOME/Library/LaunchAgents/com.controlconexion.agente.plist"
[ -f agente-macos ] || { echo "No encuentro agente-macos en esta carpeta"; exit 1; }
[ -f agente.conf ]  || { echo "Falta agente.conf (descárgalo del panel de administración)"; exit 1; }

launchctl unload "$PLIST" 2>/dev/null || true
mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
cp agente-macos agente.conf "$DEST/"
chmod +x "$DEST/agente-macos"
xattr -d com.apple.quarantine "$DEST/agente-macos" 2>/dev/null || true

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.controlconexion.agente</string>
  <key>ProgramArguments</key><array><string>$DEST/agente-macos</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PL
launchctl load "$PLIST"
echo "Agente instalado. Registro: $DEST/agente.log"
