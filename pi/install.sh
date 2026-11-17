#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash pi/install.sh" >&2
  exit 1
fi

PI_USER="${SUDO_USER:-}"
if [[ -z "${PI_USER}" || "${PI_USER}" == "root" ]] || ! getent passwd "${PI_USER}" >/dev/null; then
  echo "Run this with sudo from the normal Raspberry Pi OS user account." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/microlearn-pi"
VENV="${INSTALL_DIR}/.venv"

apt-get update
apt-get install -y python3-picamera2 python3-venv python3-pip
install -d -o "${PI_USER}" -g "${PI_USER}" -m 0755 "${INSTALL_DIR}"
install -o "${PI_USER}" -g "${PI_USER}" -m 0644 "${SCRIPT_DIR}/camera_agent.py" "${INSTALL_DIR}/camera_agent.py"
install -o "${PI_USER}" -g "${PI_USER}" -m 0644 "${SCRIPT_DIR}/requirements.txt" "${INSTALL_DIR}/requirements.txt"
runuser -u "${PI_USER}" -- python3 -m venv --system-site-packages "${VENV}"
runuser -u "${PI_USER}" -- "${VENV}/bin/pip" install --upgrade pip
runuser -u "${PI_USER}" -- "${VENV}/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

if [[ ! -e /etc/microlearn-pi.env ]]; then
  ROOT_ENV="${SCRIPT_DIR}/../.env"
  if [[ -f "${ROOT_ENV}" ]]; then
    PI_ENV_TMP="$(mktemp)"
    grep -E '^(MICROLEARN_API_BASE_URL|MICROLEARN_PEER_ID|CAMERA_PREVIEW_WIDTH|CAMERA_PREVIEW_HEIGHT|CAMERA_PREVIEW_FPS|MAX_STILL_BYTES|LOG_LEVEL)=' "${ROOT_ENV}" > "${PI_ENV_TMP}" || true
    install -o root -g root -m 0600 "${PI_ENV_TMP}" /etc/microlearn-pi.env
    rm -f -- "${PI_ENV_TMP}"
    echo "Created /etc/microlearn-pi.env using only Pi-safe variables from the root .env."
  else
    install -o root -g root -m 0600 /dev/null /etc/microlearn-pi.env
    echo "Created empty /etc/microlearn-pi.env. Create the root .env from .env.example and rerun setup, or configure Pi settings in /etc/microlearn-pi.env."
  fi
fi

sed "s/^User=YOUR_PI_USERNAME$/User=${PI_USER}/" "${SCRIPT_DIR}/microlearn-camera.service" \
  > /etc/systemd/system/microlearn-camera.service
chmod 0644 /etc/systemd/system/microlearn-camera.service
systemctl daemon-reload

echo "Installed to ${INSTALL_DIR}. First check the camera with: rpicam-hello -t 5000"
echo "Edit /etc/microlearn-pi.env, then enable with: sudo systemctl enable --now microlearn-camera.service"
