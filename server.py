#!/usr/bin/env python3
"""
Servidor Web Local para Controle do Braço Direito InMoov (PCA9685 + Raspberry Pi 5).

Executa um servidor HTTP multithread leve sem depender de bibliotecas externas para web,
servindo a interface gráfica interativa e uma API REST JSON de baixa latência.
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import signal
import socket
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from inmoov_web_control.servo_controller import InMoovServoController

STATIC_DIR = Path(__file__).resolve().parent / "static"


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    """Servidor HTTP multithread com reutilização imediata de porta e threads daemon."""

    allow_reuse_address = True
    daemon_threads = True


class InMoovRequestHandler(BaseHTTPRequestHandler):
    """Manipulador HTTP para arquivos estáticos e endpoints da API de controle."""

    controller: InMoovServoController

    def log_message(self, format: str, *args: Any) -> None:
        if self.path.startswith("/api/servo"):
            return
        super().log_message(format, *args)

    def _send_json(self, data: Dict[str, Any], status: int = HTTPStatus.OK) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path

        if route == "/api/state":
            self._send_json(self.controller.get_state())
            return

        if route == "/" or route == "":
            file_path = STATIC_DIR / "index.html"
        else:
            rel_path = route.lstrip("/")
            file_path = (STATIC_DIR / rel_path).resolve()
            if not str(file_path).startswith(str(STATIC_DIR.resolve())):
                self._send_json({"error": "Acesso negado."}, HTTPStatus.FORBIDDEN)
                return

        if not file_path.is_file():
            self._send_json({"error": "Arquivo não encontrado."}, HTTPStatus.NOT_FOUND)
            return

        mime_type, _ = mimetypes.guess_type(str(file_path))
        content = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path

        try:
            body = self._read_json_body()
        except Exception as exc:
            self._send_json(
                {"error": f"JSON inválido: {exc}"},
                HTTPStatus.BAD_REQUEST,
            )
            return

        try:
            if route == "/api/servo":
                identifier = body.get("id", body.get("channel"))
                if identifier is None or "angle" not in body:
                    self._send_json(
                        {"error": "Informe 'id' (ou 'channel') e 'angle'."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                result = self.controller.set_servo_angle(identifier, float(body["angle"]))
                self._send_json({"ok": True, "result": result})
                return

            if route == "/api/servos":
                angles = body.get("angles", {})
                if not isinstance(angles, dict):
                    self._send_json(
                        {"error": "O campo 'angles' deve ser um objeto JSON."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                result = self.controller.set_multiple_angles(angles)
                self._send_json({"ok": True, **result})
                return

            if route == "/api/hand":
                if "closure_percent" not in body:
                    self._send_json(
                        {"error": "Informe 'closure_percent' (0 a 100)."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                result = self.controller.set_hand_closure(float(body["closure_percent"]))
                self._send_json({"ok": True, **result})
                return

            if route == "/api/preset":
                preset = body.get("preset")
                if not preset:
                    self._send_json(
                        {"error": "Informe o nome do 'preset'."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                result = self.controller.apply_preset(str(preset))
                self._send_json({"ok": True, **result})
                return

            if route == "/api/release":
                state = self.controller.release_all()
                self._send_json({"ok": True, "state": state})
                return

            self._send_json({"error": "Endpoint não encontrado."}, HTTPStatus.NOT_FOUND)

        except KeyError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            logging.exception("Erro interno ao processar requisição:")
            self._send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def get_local_ip() -> str:
    """Descobre o IP na rede local para facilitar o acesso."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Interface Web Local para Controle do Braço Direito InMoov (PCA9685)"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Endereço IP para escutar conexões (padrão: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Porta HTTP do servidor web (padrão: 8000)",
    )
    parser.add_argument(
        "--i2c-address",
        type=lambda x: int(x, 0),
        default=0x40,
        help="Endereço I2C do PCA9685 (padrão: 0x40)",
    )
    parser.add_argument(
        "--sim",
        action="store_true",
        help="Forçar modo de simulação mesmo se o PCA9685 estiver conectado",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    controller = InMoovServoController(
        i2c_address=args.i2c_address,
        force_simulation=args.sim,
    )
    InMoovRequestHandler.controller = controller

    server = ReusableThreadingHTTPServer((args.host, args.port), InMoovRequestHandler)
    local_ip = get_local_ip()

    def handle_shutdown_signal(signum: int, _frame: Any) -> None:
        sig_name = signal.Signals(signum).name
        logging.info("Sinal %s recebido. Encerrando servidor e liberando porta %d...", sig_name, args.port)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, handle_shutdown_signal)
    signal.signal(signal.SIGINT, handle_shutdown_signal)

    mode_str = (
        "MODO SIMULAÇÃO (sem hardware PCA9685 ativo)"
        if controller.simulation_mode
        else f"HARDWARE PCA9685 ATIVO (I2C 0x{args.i2c_address:02X})"
    )
    print("=" * 68)
    print("  InMoov Braço Direito - Interface Web de Controle (PCA9685)")
    print("=" * 68)
    print(f"  Status Hardware : {mode_str}")
    print(f"  Acesso Local    : http://localhost:{args.port}")
    print(f"  Acesso na Rede  : http://{local_ip}:{args.port}")
    print("=" * 68)
    print("Pressione Ctrl+C para encerrar o servidor.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor web InMoov...")
    finally:
        logging.info("Desativando pulsos PWM dos servos e liberando socket HTTP...")
        controller.release_all()
        server.server_close()
        logging.info("Servidor encerrado com sucesso.")


if __name__ == "__main__":
    main()
