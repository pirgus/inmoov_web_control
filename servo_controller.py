"""
Controlador de Servos PCA9685 para o Braço Direito Humanoide InMoov.

Gerencia a comunicação via I2C na Raspberry Pi 5 utilizando
`adafruit-circuitpython-servokit` (com fallback automático para modo de simulação
caso o hardware/biblioteca não esteja disponível no ambiente de desenvolvimento).
Garante que os limites angulares físicos de cada canal sejam estritamente respeitados.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ServoConfig:
    """Configuração e limites físicos de um canal do PCA9685."""
    id: str
    name: str
    group: str  # "hand" ou "arm"
    channel: int
    min_angle: float
    max_angle: float
    default_angle: float
    inverted: bool
    min_label: str
    max_label: str
    neutral_label: Optional[str] = None
    description: str = ""
    # Faixa de largura de pulso (µs) mapeada para 0°..180° neste servo.
    # Ajuste por servo para que 0°/180° não empurrem o motor contra o batente interno.
    min_pulse_us: int = 500
    max_pulse_us: int = 2500
    servo_model: str = ""


# Faixas de pulso padrão por modelo de servo
MG996R_PULSE = {"min_pulse_us": 600, "max_pulse_us": 2400, "servo_model": "MG996R"}
LF20MG_PULSE = {"min_pulse_us": 500, "max_pulse_us": 2500, "servo_model": "Power HD LF-20MG"}

# Especificação completa dos 9 servos do braço direito InMoov
SERVO_DEFINITIONS: Dict[str, ServoConfig] = {
    "thumb": ServoConfig(
        id="thumb",
        name="Polegar (Invertido)",
        group="hand",
        channel=0,
        **MG996R_PULSE,
        min_angle=50.0,
        max_angle=140.0,
        default_angle=140.0,
        inverted=True,
        min_label="50° (Fechado)",
        max_label="140° (Esticado)",
        description="Flexão do polegar direito (relação inversa: 50° fechado, 140° esticado).",
    ),
    "index": ServoConfig(
        id="index",
        name="Indicador",
        group="hand",
        channel=1,
        **MG996R_PULSE,
        min_angle=50.0,
        max_angle=140.0,
        default_angle=50.0,
        inverted=False,
        min_label="50° (Esticado)",
        max_label="140° (Fechado)",
        description="Flexão do dedo indicador (50° aberto/esticado, 140° fechado).",
    ),
    "middle": ServoConfig(
        id="middle",
        name="Médio",
        group="hand",
        channel=3,
        **MG996R_PULSE,
        min_angle=50.0,
        max_angle=140.0,
        default_angle=50.0,
        inverted=False,
        min_label="50° (Esticado)",
        max_label="140° (Fechado)",
        description="Flexão do dedo médio (50° aberto/esticado, 140° fechado).",
    ),
    "ring": ServoConfig(
        id="ring",
        name="Anelar",
        group="hand",
        channel=4,
        **MG996R_PULSE,
        min_angle=50.0,
        max_angle=140.0,
        default_angle=50.0,
        inverted=False,
        min_label="50° (Esticado)",
        max_label="140° (Fechado)",
        description="Flexão do dedo anelar (50° aberto/esticado, 140° fechado).",
    ),
    "pinky": ServoConfig(
        id="pinky",
        name="Mindinho (Invertido)",
        group="hand",
        channel=5,
        **MG996R_PULSE,
        min_angle=50.0,
        max_angle=140.0,
        default_angle=140.0,
        inverted=True,
        min_label="50° (Fechado)",
        max_label="140° (Esticado)",
        description="Flexão do dedo mínimo (relação inversa: 50° fechado, 140° esticado).",
    ),
    "elbow": ServoConfig(
        id="elbow",
        name="Cotovelo (Flexão/Extensão)",
        group="arm",
        channel=8,
        **LF20MG_PULSE,
        min_angle=125.0,
        max_angle=180.0,
        default_angle=180.0,
        inverted=False,
        min_label="125° (Fechado)",
        max_label="180° (Esticado)",
        description="Flexão do cotovelo direito (125° fechado/fletido, 180° esticado).",
    ),
    "arm_roll": ServoConfig(
        id="arm_roll",
        name="Rotação do Braço (Eixo Próprio)",
        group="arm",
        channel=9,
        **LF20MG_PULSE,
        min_angle=0.0,
        max_angle=180.0,
        default_angle=90.0,
        inverted=False,
        min_label="0° (Rot. Interna)",
        max_label="180° (Rot. Externa)",
        neutral_label="90° (Reto p/ Frente)",
        description="Rotação axial do bíceps/braço em seu próprio eixo (90° = reto para frente).",
    ),
    "shoulder_pitch": ServoConfig(
        id="shoulder_pitch",
        name="Rotação do Ombro",
        group="arm",
        channel=11,
        **LF20MG_PULSE,
        min_angle=0.0,
        max_angle=180.0,
        default_angle=90.0,
        inverted=False,
        min_label="0° (Para Trás)",
        max_label="180° (Para Frente)",
        neutral_label="90° (Central / Reto ao Chão)",
        description="Rotação do ombro (0° para trás, 90° posição central reto ao chão, 180° para frente).",
    ),
    "shoulder_abduction": ServoConfig(
        id="shoulder_abduction",
        name="Abdução / Adução do Ombro",
        group="arm",
        channel=12,
        **LF20MG_PULSE,
        min_angle=30.0,
        max_angle=85.0,
        default_angle=85.0,
        inverted=True,
        min_label="30° (Levantado)",
        max_label="85° (Abaixado)",
        description="Movimento lateral do ombro/omoplata (85° braço abaixado junto ao corpo, 30° braço levantado).",
    ),
}


# Presets seguros que respeitam todos os limites configurados
PRESETS: Dict[str, Dict[str, Any]] = {
    "neutral": {
        "label": "Posição Neutra / Inicial",
        "angles": {
            "thumb": 140.0,
            "index": 50.0,
            "middle": 50.0,
            "ring": 50.0,
            "pinky": 140.0,
            "elbow": 180.0,
            "arm_roll": 90.0,
            "shoulder_pitch": 90.0,
            "shoulder_abduction": 85.0,
        },
    },
    "hand_open": {
        "label": "Mão Aberta (Dedos Esticados)",
        "angles": {
            "thumb": 140.0,
            "index": 50.0,
            "middle": 50.0,
            "ring": 50.0,
            "pinky": 140.0,
        },
    },
    "hand_closed": {
        "label": "Mão Fechada (Punho)",
        # O polegar fecha somente após os demais dedos para não bloqueá-los.
        "thumb_delay_s": 0.8,
        "angles": {
            "thumb": 50.0,
            "index": 140.0,
            "middle": 140.0,
            "ring": 140.0,
            "pinky": 50.0,
        },
    },
    "pinch": {
        "label": "Pinça (Polegar + Indicador)",
        "angles": {
            "thumb": 50.0,
            "index": 140.0,
            "middle": 50.0,
            "ring": 50.0,
            "pinky": 140.0,
        },
    },
    "point": {
        "label": "Apontar (Indicador Esticado)",
        "thumb_delay_s": 0.8,
        "angles": {
            "thumb": 50.0,
            "index": 50.0,
            "middle": 140.0,
            "ring": 140.0,
            "pinky": 50.0,
        },
    },
    "peace": {
        "label": "Sinal de Paz (Indicador + Médio)",
        "thumb_delay_s": 0.8,
        "angles": {
            "thumb": 50.0,
            "index": 50.0,
            "middle": 50.0,
            "ring": 140.0,
            "pinky": 50.0,
        },
    },
    "rock": {
        "label": "Sinal de Rock (Indicador + Mindinho)",
        "thumb_delay_s": 0.8,
        "angles": {
            "thumb": 50.0,
            "index": 50.0,
            "middle": 140.0,
            "ring": 140.0,
            "pinky": 140.0,
        },
    },
    "secret": {
        "label": "Movimento Secreto (Dedo Médio)",
        "thumb_delay_s": 0.8,
        "angles": {
            "thumb": 50.0,
            "index": 140.0,
            "middle": 50.0,
            "ring": 140.0,
            "pinky": 50.0,
        },
    },
    "wave_pose": {
        "label": "Posição de Cumprimento",
        "angles": {
            "thumb": 140.0,
            "index": 50.0,
            "middle": 50.0,
            "ring": 50.0,
            "pinky": 140.0,
            "elbow": 135.0,
            "arm_roll": 90.0,
            "shoulder_pitch": 115.0,
            "shoulder_abduction": 45.0,
        },
    },
}


class InMoovServoController:
    """
    Controlador thread-safe para os servos do braço direito InMoov via PCA9685.
    """

    def __init__(
        self,
        i2c_address: int = 0x40,
        frequency: int = 50,
        force_simulation: bool = False,
    ) -> None:
        self._lock = threading.Lock()
        self.i2c_address = i2c_address
        self.frequency = frequency
        self.simulation_mode = True
        self.hardware_error: Optional[str] = None
        self._kit = None

        self._configs: Dict[str, ServoConfig] = dict(SERVO_DEFINITIONS)
        self._channel_to_id: Dict[int, str] = {
            cfg.channel: servo_id for servo_id, cfg in self._configs.items()
        }
        self._current_angles: Dict[str, float] = {
            servo_id: cfg.default_angle for servo_id, cfg in self._configs.items()
        }

        if not force_simulation:
            self._init_hardware()
        else:
            logger.info("Modo de simulação forçado ativado.")

        # Aplica ângulos iniciais
        for servo_id, angle in self._current_angles.items():
            self._write_servo_hardware(self._configs[servo_id].channel, angle)

    def _init_hardware(self) -> None:
        """Tenta inicializar o PCA9685 via adafruit_servokit."""
        try:
            from adafruit_servokit import ServoKit  # type: ignore

            self._kit = ServoKit(
                channels=16,
                address=self.i2c_address,
                frequency=self.frequency,
            )
            for cfg in self._configs.values():
                self._kit.servo[cfg.channel].actuation_range = 180
                self._kit.servo[cfg.channel].set_pulse_width_range(
                    cfg.min_pulse_us, cfg.max_pulse_us
                )
                logger.info(
                    "Canal %d (%s, %s): pulso %d–%d µs",
                    cfg.channel, cfg.id, cfg.servo_model or "?",
                    cfg.min_pulse_us, cfg.max_pulse_us,
                )
            self.simulation_mode = False
            self.hardware_error = None
            logger.info(
                "PCA9685 inicializado com sucesso no endereço I2C 0x%02X (%d Hz).",
                self.i2c_address,
                self.frequency,
            )
        except Exception as exc:
            self._kit = None
            self.simulation_mode = True
            self.hardware_error = str(exc)
            logger.warning(
                "PCA9685 não detectado (%s). Executando em modo de simulação.",
                exc,
            )

    def _write_servo_hardware(self, channel: int, angle: float) -> None:
        """Envia o comando angular para o canal físico do PCA9685 se ativo."""
        if not self.simulation_mode and self._kit is not None:
            try:
                self._kit.servo[channel].angle = float(angle)
            except Exception as exc:
                logger.error("Erro ao escrever no canal %d do PCA9685: %s", channel, exc)
                self.hardware_error = str(exc)

    @staticmethod
    def clamp_angle(angle: float, min_angle: float, max_angle: float) -> float:
        """Garante que o ângulo permaneça estritamente dentro de [min_angle, max_angle]."""
        return float(max(min_angle, min(max_angle, float(angle))))

    def get_normalized_flexion(self, servo_id: str, angle: Optional[float] = None) -> float:
        """
        Retorna um valor normalizado [0.0, 1.0] para representação visual:
        - Para os dedos: 0.0 = totalmente esticado, 1.0 = totalmente fechado.
          (Trata automaticamente a inversão do polegar (canal 0) e do mindinho (canal 5)).
        - Para o cotovelo (125° a 180°): 0.0 = esticado (180°), 1.0 = fechado (125°).
        - Para a abdução do ombro (30° a 85°): 0.0 = abaixado (85°), 1.0 = levantado (30°).
        """
        cfg = self._configs[servo_id]
        val = self._current_angles[servo_id] if angle is None else angle
        span = cfg.max_angle - cfg.min_angle
        if span <= 0:
            return 0.0
        ratio = (val - cfg.min_angle) / span
        ratio = max(0.0, min(1.0, ratio))

        if servo_id == "elbow":
            return 1.0 - ratio
        if servo_id == "shoulder_abduction":
            return 1.0 - ratio
        if cfg.group == "hand":
            return (1.0 - ratio) if cfg.inverted else ratio
        return ratio

    def set_servo_angle(self, identifier: str | int, angle: float) -> Dict[str, Any]:
        """
        Define o ângulo de um servo pelo ID ('thumb', 'elbow', etc.) ou pelo número do canal (0..15).
        Limita automaticamente o valor ao intervalo permitido do servo.
        """
        with self._lock:
            servo_id = self._resolve_servo_id(identifier)
            cfg = self._configs[servo_id]
            clamped = round(self.clamp_angle(angle, cfg.min_angle, cfg.max_angle), 1)
            was_clamped = abs(clamped - float(angle)) > 1e-4

            self._current_angles[servo_id] = clamped
            self._write_servo_hardware(cfg.channel, clamped)

            return {
                "id": servo_id,
                "channel": cfg.channel,
                "angle": clamped,
                "requested_angle": float(angle),
                "clamped": was_clamped,
                "normalized": round(self.get_normalized_flexion(servo_id, clamped), 4),
            }

    def set_multiple_angles(self, angles: Dict[str, float]) -> Dict[str, Any]:
        """Atualiza múltiplos servos de uma só vez respeitando os limites de cada um."""
        results = {}
        for key, angle in angles.items():
            results[key] = self.set_servo_angle(key, angle)
        return {
            "updated": results,
            "state": self.get_state(),
        }

    def set_hand_closure(self, closure_percent: float) -> Dict[str, Any]:
        """
        Define o fechamento global de todos os 5 dedos (0% = mão aberta/esticada, 100% = mão fechada).
        Respeita automaticamente a inversão do polegar (canal 0) e do mindinho (canal 5).
        """
        pct = max(0.0, min(100.0, float(closure_percent))) / 100.0
        updates: Dict[str, float] = {}
        for servo_id, cfg in self._configs.items():
            if cfg.group == "hand":
                if cfg.inverted:
                    updates[servo_id] = cfg.max_angle - pct * (cfg.max_angle - cfg.min_angle)
                else:
                    updates[servo_id] = cfg.min_angle + pct * (cfg.max_angle - cfg.min_angle)
        return self.set_multiple_angles(updates)

    def apply_preset(self, preset_name: str) -> Dict[str, Any]:
        """
        Aplica um preset pré-configurado.

        Se o preset definir `thumb_delay_s`, os demais servos são movidos primeiro
        e o polegar só é acionado após esse atraso (evita que o polegar fechado
        bloqueie o curso dos outros dedos).
        """
        if preset_name not in PRESETS:
            raise KeyError(f"Preset desconhecido: '{preset_name}'")
        preset = PRESETS[preset_name]
        preset_angles = preset["angles"]
        thumb_delay = float(preset.get("thumb_delay_s", 0.0))

        if thumb_delay > 0 and "thumb" in preset_angles:
            others = {k: v for k, v in preset_angles.items() if k != "thumb"}
            self.set_multiple_angles(others)
            time.sleep(thumb_delay)
            return self.set_multiple_angles({"thumb": preset_angles["thumb"]})

        return self.set_multiple_angles(preset_angles)

    def release_all(self) -> Dict[str, Any]:
        """Desativa o pulso PWM em todos os canais do PCA9685 (relaxa os servos)."""
        with self._lock:
            if not self.simulation_mode and self._kit is not None:
                for cfg in self._configs.values():
                    try:
                        self._kit.servo[cfg.channel].angle = None
                    except Exception as exc:
                        logger.error("Erro ao liberar canal %d: %s", cfg.channel, exc)
            return self.get_state()

    def _resolve_servo_id(self, identifier: str | int) -> str:
        """Resolve nome do servo ou número do canal para o ID interno."""
        if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
            ch = int(identifier)
            if ch not in self._channel_to_id:
                raise KeyError(f"Canal PCA9685 {ch} não está configurado para o braço InMoov.")
            return self._channel_to_id[ch]

        if identifier not in self._configs:
            raise KeyError(f"Servo '{identifier}' não encontrado.")
        return identifier

    def get_state(self) -> Dict[str, Any]:
        """Retorna o estado completo de todos os servos e metadados de hardware."""
        servos_state = {}
        for servo_id, cfg in self._configs.items():
            angle = self._current_angles[servo_id]
            servos_state[servo_id] = {
                **asdict(cfg),
                "angle": angle,
                "normalized": round(self.get_normalized_flexion(servo_id, angle), 4),
            }

        return {
            "simulation_mode": self.simulation_mode,
            "i2c_address": f"0x{self.i2c_address:02X}",
            "frequency_hz": self.frequency,
            "hardware_error": self.hardware_error,
            "servos": servos_state,
            "presets": {
                k: {"label": v["label"], "angles": v["angles"]}
                for k, v in PRESETS.items()
            },
        }
