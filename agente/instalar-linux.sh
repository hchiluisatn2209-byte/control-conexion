#!/bin/bash
# Instala el agente para el usuario actual en Linux (systemd de usuario). Sin sudo.
# Para medir inactividad instala xprintidle (esto sí requiere sudo):  sudo apt install xprintidle
set -e
cd "$(dirname "$0")"
DEST="$HOME/.local/share/control-conexion"
[ -f agente-linux ] || { echo "No encuentro agente-linux en esta carpeta"; exit 1; }
[ -f agente.conf ]  || { echo "Falta agente.conf"; exit 1; }
mkdir -p "$DEST" "$HOME/.config/systemd/user"
cp agente-linux agente.conf "$DEST/" && chmod +x "$DEST/agente-linux"
cat > "$HOME/.config/systemd/user/control-conexion.service" <<SV
[Unit]
Description=Agente Control de Conexion
[Service]
ExecStart=$DEST/agente-linux
Restart=always
RestartSec=30
[Install]
WantedBy=default.target
SV
systemctl --user daemon-reload
systemctl --user enable --now control-conexion.service
echo "Agente instalado. Registro: $DEST/agente.log"
