/**
 * Interface Web Local — Controle do Braço Direito InMoov (PCA9685 / Raspberry Pi 5)
 *
 * Funciona tanto conectada ao servidor Python (`server.py`) quanto aberta diretamente
 * no navegador (`file://`) em modo de pré-visualização local no PC.
 */

const ARM_ORDER = [
  "shoulder_abduction", // CH 12 (30° a 85°)
  "shoulder_pitch",     // CH 11 (0° a 180°)
  "arm_roll",           // CH 9  (0° a 180°)
  "elbow",              // CH 8  (125° a 180°)
];

const HAND_ORDER = [
  "thumb",  // CH 0 (20° a 160° - INVERTIDO)
  "index",  // CH 1 (20° a 160°)
  "middle", // CH 3 (20° a 160°)
  "ring",   // CH 4 (20° a 160°)
  "pinky",  // CH 5 (20° a 160° - INVERTIDO)
];

// Estado padrão embutido (permite pré-visualização mesmo abrindo o index.html direto no navegador)
const DEFAULT_FALLBACK_STATE = {
  simulation_mode: true,
  i2c_address: "0x40",
  frequency_hz: 50,
  servos: {
    thumb: {
      id: "thumb", name: "Polegar (Invertido)", group: "hand", channel: 0,
      min_angle: 20, max_angle: 160, default_angle: 160, angle: 160, inverted: true,
      min_label: "20° (Fechado)", max_label: "160° (Esticado)", neutral_label: null,
    },
    index: {
      id: "index", name: "Indicador", group: "hand", channel: 1,
      min_angle: 20, max_angle: 160, default_angle: 20, angle: 20, inverted: false,
      min_label: "20° (Esticado)", max_label: "160° (Fechado)", neutral_label: null,
    },
    middle: {
      id: "middle", name: "Médio", group: "hand", channel: 3,
      min_angle: 20, max_angle: 160, default_angle: 20, angle: 20, inverted: false,
      min_label: "20° (Esticado)", max_label: "160° (Fechado)", neutral_label: null,
    },
    ring: {
      id: "ring", name: "Anelar", group: "hand", channel: 4,
      min_angle: 20, max_angle: 160, default_angle: 20, angle: 20, inverted: false,
      min_label: "20° (Esticado)", max_label: "160° (Fechado)", neutral_label: null,
    },
    pinky: {
      id: "pinky", name: "Mindinho (Invertido)", group: "hand", channel: 5,
      min_angle: 20, max_angle: 160, default_angle: 160, angle: 160, inverted: true,
      min_label: "20° (Fechado)", max_label: "160° (Esticado)", neutral_label: null,
    },
    elbow: {
      id: "elbow", name: "Cotovelo (Flexão/Extensão)", group: "arm", channel: 8,
      min_angle: 125, max_angle: 180, default_angle: 180, angle: 180, inverted: false,
      min_label: "125° (Fechado)", max_label: "180° (Esticado)", neutral_label: null,
    },
    arm_roll: {
      id: "arm_roll", name: "Rotação do Braço (Eixo Próprio)", group: "arm", channel: 9,
      min_angle: 0, max_angle: 180, default_angle: 90, angle: 90, inverted: false,
      min_label: "0° (Rot. Interna)", max_label: "180° (Rot. Externa)", neutral_label: "90° (Reto p/ Frente)",
    },
    shoulder_pitch: {
      id: "shoulder_pitch", name: "Rotação do Ombro", group: "arm", channel: 11,
      min_angle: 0, max_angle: 180, default_angle: 90, angle: 90, inverted: false,
      min_label: "0° (Para Trás)", max_label: "180° (Para Frente)", neutral_label: "90° (Central / Reto ao Chão)",
    },
    shoulder_abduction: {
      id: "shoulder_abduction", name: "Abdução / Adução do Ombro", group: "arm", channel: 12,
      min_angle: 30, max_angle: 85, default_angle: 85, angle: 85, inverted: true,
      min_label: "30° (Levantado)", max_label: "85° (Abaixado)", neutral_label: null,
    },
  },
  presets: {
    neutral: {
      angles: { thumb: 160, index: 20, middle: 20, ring: 20, pinky: 160, elbow: 180, arm_roll: 90, shoulder_pitch: 90, shoulder_abduction: 85 },
    },
    hand_open: {
      angles: { thumb: 160, index: 20, middle: 20, ring: 20, pinky: 160 },
    },
    hand_closed: {
      angles: { thumb: 20, index: 160, middle: 160, ring: 160, pinky: 20 },
    },
    pinch: {
      angles: { thumb: 40, index: 140, middle: 20, ring: 20, pinky: 160 },
    },
    point: {
      angles: { thumb: 20, index: 20, middle: 160, ring: 160, pinky: 20 },
    },
    peace: {
      angles: { thumb: 20, index: 20, middle: 20, ring: 160, pinky: 20 },
    },
    wave_pose: {
      angles: { thumb: 160, index: 20, middle: 20, ring: 20, pinky: 160, elbow: 135, arm_roll: 90, shoulder_pitch: 115, shoulder_abduction: 45 },
    },
  },
};

const state = {
  simulation_mode: true,
  backend_connected: false,
  i2c_address: "0x40",
  servos: {},
  presets: {},
};

const pendingUpdates = {};
let flushTimer = null;

const camera = {
  yaw: -0.65,
  pitch: 0.26,
  distance: 1.25,
  target: { x: 0.12, y: 0.04, z: 0.38 },
  dragging: false,
  lastX: 0,
  lastY: 0,
};

document.addEventListener("DOMContentLoaded", async () => {
  setupTopbarButtons();
  setupCameraInteraction();
  await fetchInitialState();
  requestAnimationFrame(render3DLoop);
});

async function fetchInitialState() {
  if (window.location.protocol === "file:") {
    state.backend_connected = false;
    applyServerState(structuredClone(DEFAULT_FALLBACK_STATE), true);
    return;
  }
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.backend_connected = true;
    applyServerState(data, true);
  } catch (err) {
    state.backend_connected = false;
    applyServerState(structuredClone(DEFAULT_FALLBACK_STATE), true);
  }
}

function applyServerState(data, rebuildDOM = false) {
  state.simulation_mode = data.simulation_mode;
  state.i2c_address = data.i2c_address || "0x40";
  state.servos = data.servos || {};
  state.presets = data.presets || DEFAULT_FALLBACK_STATE.presets;

  updateHardwareBadge(data);

  if (rebuildDOM) {
    buildSliders("armSlidersContainer", ARM_ORDER);
    buildSliders("handSlidersContainer", HAND_ORDER);
    buildArmGauges();
    buildHandSvgFingers();
  }

  syncControlsFromState();
  update2DVisuals();
}

function updateHardwareBadge(data) {
  const badge = document.getElementById("hwBadge");
  const text = document.getElementById("hwStatusText");
  if (!badge || !text) return;

  if (!state.backend_connected) {
    badge.className = "hw-badge sim";
    text.textContent = "Pré-visualização Local (No Navegador)";
  } else if (data.simulation_mode) {
    badge.className = "hw-badge sim";
    text.textContent = `Modo Simulação (PCA9685 ${data.i2c_address})`;
  } else {
    badge.className = "hw-badge hw-active";
    text.textContent = `PCA9685 Ativo (${data.i2c_address} • ${data.frequency_hz || 50}Hz)`;
  }
}

function computeNormalizedFlexion(cfg, angle) {
  const span = cfg.max_angle - cfg.min_angle;
  if (span <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, (angle - cfg.min_angle) / span));
  if (cfg.id === "elbow" || cfg.id === "shoulder_abduction") {
    return 1.0 - ratio;
  }
  if (cfg.group === "hand") {
    return cfg.inverted ? 1.0 - ratio : ratio;
  }
  return ratio;
}

function clampAngle(val, min, max) {
  const num = Number(val);
  if (Number.isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function buildSliders(containerId, orderList) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  orderList.forEach((servoId) => {
    const cfg = state.servos[servoId];
    if (!cfg) return;

    const row = document.createElement("div");
    row.className = `servo-control-row${cfg.inverted && cfg.group === "hand" ? " inverted-row" : ""}`;
    row.id = `row-${servoId}`;

    const hasNeutral90 =
      cfg.neutral_label && cfg.min_angle <= 90 && cfg.max_angle >= 90;

    row.innerHTML = `
      <div class="servo-top-bar">
        <div class="servo-title-group">
          <span class="ch-tag">CH ${cfg.channel}</span>
          <span class="servo-name">${cfg.name}</span>
          ${
            cfg.inverted && cfg.group === "hand"
              ? `<span class="inv-badge" title="Posicionamento físico invertido: ${cfg.max_angle}° esticado, ${cfg.min_angle}° fechado">INVERTIDO (${cfg.max_angle}°=Esticado)</span>`
              : ""
          }
        </div>
        <div class="servo-readout-group">
          ${
            hasNeutral90
              ? `<button type="button" class="btn-neutral-jump" data-servo="${servoId}" data-target="90" title="Ir para 90°">90°</button>`
              : ""
          }
          <button type="button" class="btn-step" data-servo="${servoId}" data-step="-1" title="Diminuir 1°">−</button>
          <input
            type="number"
            id="num-${servoId}"
            class="angle-number-input"
            min="${cfg.min_angle}"
            max="${cfg.max_angle}"
            step="1"
            value="${cfg.angle}"
          />
          <span class="unit-deg">°</span>
          <button type="button" class="btn-step" data-servo="${servoId}" data-step="1" title="Aumentar 1°">+</button>
        </div>
      </div>

      <input
        type="range"
        id="slider-${servoId}"
        class="servo-range"
        min="${cfg.min_angle}"
        max="${cfg.max_angle}"
        step="1"
        value="${cfg.angle}"
      />

      <div class="range-sublabels">
        <span>${cfg.min_label}</span>
        ${
          cfg.neutral_label
            ? `<span class="neutral-mark">▲ ${cfg.neutral_label}</span>`
            : `<span id="status-sub-${servoId}"></span>`
        }
        <span>${cfg.max_label}</span>
      </div>
    `;

    container.appendChild(row);

    const slider = row.querySelector(`#slider-${servoId}`);
    const numInput = row.querySelector(`#num-${servoId}`);

    slider.addEventListener("input", (e) => {
      handleLocalAngleChange(servoId, parseFloat(e.target.value));
    });

    numInput.addEventListener("change", (e) => {
      const clamped = clampAngle(e.target.value, cfg.min_angle, cfg.max_angle);
      handleLocalAngleChange(servoId, clamped);
    });
  });

  container.querySelectorAll(".btn-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      const servoId = btn.getAttribute("data-servo");
      const step = parseFloat(btn.getAttribute("data-step"));
      const cfg = state.servos[servoId];
      if (!cfg) return;
      const nextAngle = clampAngle(cfg.angle + step, cfg.min_angle, cfg.max_angle);
      handleLocalAngleChange(servoId, nextAngle);
    });
  });

  container.querySelectorAll(".btn-neutral-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const servoId = btn.getAttribute("data-servo");
      const target = parseFloat(btn.getAttribute("data-target"));
      handleLocalAngleChange(servoId, target);
    });
  });
}

function handleLocalAngleChange(servoId, rawAngle) {
  const cfg = state.servos[servoId];
  if (!cfg) return;

  const clamped = Math.round(clampAngle(rawAngle, cfg.min_angle, cfg.max_angle) * 10) / 10;
  cfg.angle = clamped;
  cfg.normalized = computeNormalizedFlexion(cfg, clamped);

  syncSingleControlUI(servoId);
  updateMasterHandSliderFromFingers();
  update2DVisuals();

  if (state.backend_connected) {
    queueServoCommand(servoId, clamped);
  }
}

function queueServoCommand(servoId, angle) {
  pendingUpdates[servoId] = angle;
  if (flushTimer) return;

  flushTimer = setTimeout(async () => {
    const batch = { ...pendingUpdates };
    Object.keys(pendingUpdates).forEach((k) => delete pendingUpdates[k]);
    flushTimer = null;

    const keys = Object.keys(batch);
    try {
      if (keys.length === 1) {
        const id = keys[0];
        await fetch("/api/servo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, angle: batch[id] }),
        });
      } else if (keys.length > 1) {
        await fetch("/api/servos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ angles: batch }),
        });
      }
    } catch (err) {
      console.error("Erro ao enviar comando ao servidor PCA9685:", err);
    }
  }, 25);
}

function syncSingleControlUI(servoId) {
  const cfg = state.servos[servoId];
  if (!cfg) return;

  const slider = document.getElementById(`slider-${servoId}`);
  const numInput = document.getElementById(`num-${servoId}`);
  const subStatus = document.getElementById(`status-sub-${servoId}`);

  if (slider) slider.value = cfg.angle;
  if (numInput) numInput.value = cfg.angle;

  if (subStatus) {
    const pct = Math.round(computeNormalizedFlexion(cfg, cfg.angle) * 100);
    if (cfg.group === "hand") {
      subStatus.textContent = `${pct}% Fechado`;
    } else if (servoId === "elbow") {
      subStatus.textContent = `${pct}% Fletido`;
    } else if (servoId === "shoulder_abduction") {
      subStatus.textContent = `${pct}% Elevado`;
    }
  }
}

function syncControlsFromState() {
  Object.keys(state.servos).forEach((servoId) => {
    syncSingleControlUI(servoId);
  });
  updateMasterHandSliderFromFingers();
}

function updateMasterHandSliderFromFingers() {
  const masterSlider = document.getElementById("masterHandSlider");
  const masterBadge = document.getElementById("masterHandValue");
  if (!masterSlider || !masterBadge) return;

  let totalFlex = 0;
  let count = 0;
  HAND_ORDER.forEach((id) => {
    const cfg = state.servos[id];
    if (cfg) {
      totalFlex += computeNormalizedFlexion(cfg, cfg.angle);
      count++;
    }
  });
  const avgPct = count > 0 ? Math.round((totalFlex / count) * 100) : 0;
  masterSlider.value = avgPct;
  masterBadge.textContent = `${avgPct}% Fechada`;
}

function setupTopbarButtons() {
  document.getElementById("btnResetNeutral")?.addEventListener("click", () => {
    applyPreset("neutral");
  });

  document.getElementById("btnWavePose")?.addEventListener("click", () => {
    applyPreset("wave_pose");
  });

  document.getElementById("btnReleaseAll")?.addEventListener("click", async () => {
    if (!state.backend_connected) return;
    try {
      const res = await fetch("/api/release", { method: "POST" });
      const data = await res.json();
      if (data.state) applyServerState(data.state, false);
    } catch (err) {
      console.error("Erro ao relaxar servos:", err);
    }
  });

  const masterSlider = document.getElementById("masterHandSlider");
  masterSlider?.addEventListener("input", (e) => {
    const closurePct = parseFloat(e.target.value);
    const ratio = closurePct / 100.0;

    HAND_ORDER.forEach((servoId) => {
      const cfg = state.servos[servoId];
      if (!cfg) return;
      const targetAngle = cfg.inverted
        ? cfg.max_angle - ratio * (cfg.max_angle - cfg.min_angle)
        : cfg.min_angle + ratio * (cfg.max_angle - cfg.min_angle);
      const rounded = Math.round(targetAngle);
      cfg.angle = rounded;
      cfg.normalized = computeNormalizedFlexion(cfg, rounded);
      syncSingleControlUI(servoId);
      pendingUpdates[servoId] = rounded;
    });

    document.getElementById("masterHandValue").textContent = `${Math.round(closurePct)}% Fechada`;
    update2DVisuals();
    if (state.backend_connected) {
      queueServoCommand("thumb", state.servos.thumb.angle);
    }
  });

  document.querySelectorAll(".btn-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      if (preset) applyPreset(preset);
    });
  });
}

async function applyPreset(presetName) {
  const presetObj = state.presets[presetName];
  if (presetObj && presetObj.angles) {
    Object.entries(presetObj.angles).forEach(([servoId, angle]) => {
      if (state.servos[servoId]) {
        state.servos[servoId].angle = angle;
      }
    });
    syncControlsFromState();
    update2DVisuals();
  }

  if (!state.backend_connected) return;
  try {
    const res = await fetch("/api/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: presetName }),
    });
    const data = await res.json();
    if (data.state) {
      applyServerState(data.state, false);
    }
  } catch (err) {
    console.error("Erro ao aplicar preset:", err);
  }
}

/* =========================================================================
 * VISUALIZAÇÃO 2D: ESQUEMA DA MÃO DIREITA + GAUGES DO BRAÇO
 * ========================================================================= */

const FINGER_SVG_LAYOUT = [
  { id: "thumb",  label: "Polegar",   ch: 0, baseX: 88,  baseY: 162, angleDeg: -50, maxLen: 64 },
  { id: "index",  label: "Indicador", ch: 1, baseX: 122, baseY: 136, angleDeg: -12, maxLen: 88 },
  { id: "middle", label: "Médio*",    ch: 3, baseX: 162, baseY: 130, angleDeg: 0,   maxLen: 96 },
  { id: "ring",   label: "Anelar",    ch: 4, baseX: 200, baseY: 135, angleDeg: 10,  maxLen: 86 },
  { id: "pinky",  label: "Mindinho",  ch: 5, baseX: 235, baseY: 145, angleDeg: 22,  maxLen: 70 },
];

function buildHandSvgFingers() {
  const layer = document.getElementById("svgFingersLayer");
  if (!layer) return;
  layer.innerHTML = "";

  FINGER_SVG_LAYOUT.forEach((f) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", `svg-finger-${f.id}`);
    layer.appendChild(g);
  });
}

function buildArmGauges() {
  const container = document.getElementById("armGaugesContainer");
  if (!container) return;
  container.innerHTML = "";

  ARM_ORDER.forEach((servoId) => {
    const cfg = state.servos[servoId];
    if (!cfg) return;

    const item = document.createElement("div");
    item.className = "gauge-item";
    item.innerHTML = `
      <div class="gauge-title">${cfg.name.split("(")[0].trim()}</div>
      <div class="gauge-ch">CH ${cfg.channel} (${cfg.min_angle}°–${cfg.max_angle}°)</div>
      <svg id="gauge-svg-${servoId}" class="gauge-svg" viewBox="0 0 120 72"></svg>
      <div id="gauge-caption-${servoId}" class="gauge-limits"></div>
    `;
    container.appendChild(item);
  });
}

function polarToCartesian(cx, cy, r, angleInDegrees) {
  const rad = ((angleInDegrees - 180) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M", start.x, start.y, "A", r, r, 0, largeArcFlag, 0, end.x, end.y].join(" ");
}

function update2DVisuals() {
  let sumFlex = 0;
  FINGER_SVG_LAYOUT.forEach((f) => {
    const cfg = state.servos[f.id];
    const g = document.getElementById(`svg-finger-${f.id}`);
    if (!cfg || !g) return;

    const flex = computeNormalizedFlexion(cfg, cfg.angle);
    sumFlex += flex;

    const rad = ((f.angleDeg - 90) * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);

    const visibleLen = f.maxLen * (1 - 0.62 * flex);
    const tipX = f.baseX + ux * visibleLen;
    const tipY = f.baseY + uy * visibleLen;
    const midX = f.baseX + ux * (visibleLen * 0.55);
    const midY = f.baseY + uy * (visibleLen * 0.55);

    const strokeColor = cfg.inverted ? "#f59e0b" : "#38bdf8";

    g.innerHTML = `
      <line x1="${f.baseX}" y1="${f.baseY}"
            x2="${f.baseX + ux * f.maxLen}" y2="${f.baseY + uy * f.maxLen}"
            stroke="#1e293b" stroke-width="14" stroke-linecap="round" />
      <line x1="${f.baseX}" y1="${f.baseY}"
            x2="${tipX}" y2="${tipY}"
            stroke="${strokeColor}" stroke-width="12" stroke-linecap="round" opacity="0.88" />
      <circle cx="${f.baseX}" cy="${f.baseY}" r="5" fill="#0f172a" stroke="${strokeColor}" stroke-width="2" />
      <circle cx="${midX}" cy="${midY}" r="3.5" fill="#0f172a" stroke="#e2e8f0" stroke-width="1.5" />
      <circle cx="${tipX}" cy="${tipY}" r="4.5" fill="#f8fafc" />
      <text x="${f.baseX + ux * (f.maxLen + 18)}" y="${f.baseY + uy * (f.maxLen + 18)}"
            text-anchor="middle" fill="#e2e8f0" font-size="9.5" font-weight="700">
        CH${f.ch}: ${Math.round(cfg.angle)}°
      </text>
    `;
  });

  const avgText = document.getElementById("handAvgClosureText");
  if (avgText) {
    const pct = Math.round((sumFlex / FINGER_SVG_LAYOUT.length) * 100);
    avgText.textContent = `${pct}% Fechada`;
  }

  ARM_ORDER.forEach((servoId) => {
    const cfg = state.servos[servoId];
    const svg = document.getElementById(`gauge-svg-${servoId}`);
    const caption = document.getElementById(`gauge-caption-${servoId}`);
    if (!cfg || !svg) return;

    const cx = 60;
    const cy = 56;
    const r = 42;

    const fullTrack = describeArc(cx, cy, r, 0, 180);
    const allowedTrack = describeArc(cx, cy, r, cfg.min_angle, cfg.max_angle);
    const pointerPos = polarToCartesian(cx, cy, r, cfg.angle);

    svg.innerHTML = `
      <path d="${fullTrack}" fill="none" stroke="#1e293b" stroke-width="8" stroke-linecap="round" />
      <path d="${allowedTrack}" fill="none" stroke="#0284c7" stroke-width="8" stroke-linecap="round" />
      <line x1="${cx}" y1="${cy}" x2="${pointerPos.x}" y2="${pointerPos.y}"
            stroke="#38bdf8" stroke-width="2.5" />
      <circle cx="${pointerPos.x}" cy="${pointerPos.y}" r="4.5" fill="#f8fafc" stroke="#0284c7" stroke-width="2" />
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="#94a3b8" />
      <text x="${cx}" y="${cy - 10}" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="800">
        ${Math.round(cfg.angle)}°
      </text>
    `;

    if (caption) {
      if (servoId === "elbow") {
        caption.textContent = cfg.angle <= 130 ? "Fechado" : cfg.angle >= 175 ? "Esticado" : "Semi-fletido";
      } else if (servoId === "shoulder_abduction") {
        caption.textContent = cfg.angle >= 80 ? "Braço Abaixado" : cfg.angle <= 35 ? "Braço Levantado" : "Abduzido";
      } else {
        caption.textContent = Math.abs(cfg.angle - 90) <= 3 ? "Reto (90°)" : `${Math.round(cfg.angle)}°`;
      }
    }
  });
}

/* =========================================================================
 * VISUALIZAÇÃO 3D CINEMÁTICA DO BRAÇO DIREITO E MÃO INMOOV (CANVAS 3D)
 * ========================================================================= */

function deg2rad(d) {
  return (d * Math.PI) / 180.0;
}

function mat4Identity() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function mat4Mul(A, B) {
  const R = mat4Identity();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      R[i][j] =
        A[i][0] * B[0][j] +
        A[i][1] * B[1][j] +
        A[i][2] * B[2][j] +
        A[i][3] * B[3][j];
    }
  }
  return R;
}

function mat4Translate(tx, ty, tz) {
  return [
    [1, 0, 0, tx],
    [0, 1, 0, ty],
    [0, 0, 1, tz],
    [0, 0, 0, 1],
  ];
}

function mat4RotX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [1, 0, 0, 0],
    [0, c, -s, 0],
    [0, s, c, 0],
    [0, 0, 0, 1],
  ];
}

function mat4RotY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, 0, s, 0],
    [0, 1, 0, 0],
    [-s, 0, c, 0],
    [0, 0, 0, 1],
  ];
}

function mat4RotZ(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, -s, 0, 0],
    [s, c, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function transformPoint(M, p) {
  return {
    x: M[0][0] * p.x + M[0][1] * p.y + M[0][2] * p.z + M[0][3],
    y: M[1][0] * p.x + M[1][1] * p.y + M[1][2] * p.z + M[1][3],
    z: M[2][0] * p.x + M[2][1] * p.y + M[2][2] * p.z + M[2][3],
  };
}

function computeArmKinematics3D() {
  const ch12 = state.servos.shoulder_abduction?.angle ?? 85;
  const ch11 = state.servos.shoulder_pitch?.angle ?? 90;
  const ch9  = state.servos.arm_roll?.angle ?? 90;
  const ch8  = state.servos.elbow?.angle ?? 180;

  // Abdução (CH 12): 85° = braço abaixado (0 rad), 30° = braço levantado lateralmente (+55°)
  const abductionRad = deg2rad(85.0 - ch12);

  // Rotação do ombro (CH 11):
  // 90° = posição central (0 rad, braço reto apontando para o chão -Z)
  // 0°  = rotação para trás (-90°, braço apontando para -Y)
  // 180° = rotação para frente (+90°, braço apontando para +Y)
  const pitchRad = deg2rad(ch11 - 90.0);

  // Rotação do braço em seu próprio eixo (CH 9): 90° = neutro para frente
  const rollRad = deg2rad(ch9 - 90.0);

  // Cotovelo (CH 8): 180° = esticado (0 rad), 125° = fechado/fletido
  const elbowFlexRad = deg2rad((180.0 - ch8) * 1.45);

  const shoulderPos = { x: 0.16, y: 0.0, z: 0.62 };
  const upperArmLen = 0.24;
  const forearmLen  = 0.21;
  const palmLen     = 0.075;

  let T = mat4Translate(shoulderPos.x, shoulderPos.y, shoulderPos.z);
  // Abdução afasta o braço lateralmente (+X) e Pitch gira de trás (0°) -> centro/chão (90°) -> frente (180°)
  T = mat4Mul(T, mat4RotX(pitchRad));
  T = mat4Mul(T, mat4RotY(-abductionRad));
  T = mat4Mul(T, mat4RotZ(rollRad));

  T = mat4Mul(T, mat4Translate(0, 0, -upperArmLen));
  const elbowPos = transformPoint(T, { x: 0, y: 0, z: 0 });

  T = mat4Mul(T, mat4RotX(elbowFlexRad));

  T = mat4Mul(T, mat4Translate(0, 0, -forearmLen));
  const wristPos = transformPoint(T, { x: 0, y: 0, z: 0 });

  const palmCorners = [
    transformPoint(T, { x: -0.036, y: 0, z: -0.01 }),
    transformPoint(T, { x:  0.036, y: 0, z: -0.01 }),
    transformPoint(T, { x:  0.040, y: 0, z: -palmLen }),
    transformPoint(T, { x: -0.040, y: 0, z: -palmLen }),
  ];

  const fingerSpecs = [
    { id: "thumb",  offsetX: -0.042, offsetZ: -0.032, spreadY: -0.45, len: 0.058, color: "#34d399" },
    { id: "index",  offsetX: -0.028, offsetZ: -palmLen, spreadY: -0.08, len: 0.070, color: "#38bdf8" },
    { id: "middle", offsetX: -0.008, offsetZ: -palmLen, spreadY:  0.00, len: 0.076, color: "#fbbf24" },
    { id: "ring",   offsetX:  0.014, offsetZ: -palmLen, spreadY:  0.06, len: 0.068, color: "#38bdf8" },
    { id: "pinky",  offsetX:  0.034, offsetZ: -palmLen, spreadY:  0.14, len: 0.055, color: "#38bdf8" },
  ];

  const fingers3D = fingerSpecs.map((spec) => {
    const cfg = state.servos[spec.id];
    const flex = cfg ? computeNormalizedFlexion(cfg, cfg.angle) : 0;
    const phalanxCurl = flex * deg2rad(80);

    let Tf = mat4Mul(T, mat4Translate(spec.offsetX, 0, spec.offsetZ));
    Tf = mat4Mul(Tf, mat4RotY(spec.spreadY));

    const pts = [transformPoint(Tf, { x: 0, y: 0, z: 0 })];
    const segLengths = [spec.len * 0.42, spec.len * 0.33, spec.len * 0.25];

    segLengths.forEach((sLen) => {
      Tf = mat4Mul(Tf, mat4RotX(phalanxCurl));
      Tf = mat4Mul(Tf, mat4Translate(0, 0, -sLen));
      pts.push(transformPoint(Tf, { x: 0, y: 0, z: 0 }));
    });

    return { id: spec.id, points: pts, color: spec.color, flex };
  });

  return {
    baseFloorPos: { x: 0.0, y: 0.0, z: 0.0 },
    hipPos: { x: 0.0, y: 0.0, z: 0.25 },
    neckPos: { x: 0.0, y: 0.0, z: 0.66 },
    headPos: { x: 0.0, y: 0.0, z: 0.76 },
    leftShoulderPos: { x: -0.15, y: 0.0, z: 0.62 },
    shoulderPos,
    elbowPos,
    wristPos,
    palmCorners,
    fingers3D,
  };
}

function project3DTo2D(pt, width, height) {
  const dx = pt.x - camera.target.x;
  const dy = pt.y - camera.target.y;
  const dz = pt.z - camera.target.z;

  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);

  const x1 = dx * cy - dy * sy;
  const y1 = dx * sy + dy * cy;
  const z1 = dz;

  const xCam = x1;
  const yCam = z1 * cp - y1 * sp;
  const zCam = z1 * sp + y1 * cp + camera.distance;

  const fov = 560;
  const scale = fov / Math.max(0.15, zCam);

  return {
    x: width * 0.5 + xCam * scale,
    y: height * 0.54 - yCam * scale,
    depth: zCam,
    scale,
  };
}

function draw3DLine(ctx, p1, p2, widthPx, color, cap = "round") {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  ctx.lineCap = cap;
  ctx.stroke();
}

function draw3DJoint(ctx, p, radiusPx, fillColor, strokeColor = "#0f172a") {
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(2, radiusPx), 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}

function render3DLoop() {
  const canvas = document.getElementById("arm3dCanvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (let g = -0.4; g <= 0.6; g += 0.1) {
      const a1 = project3DTo2D({ x: g, y: -0.4, z: 0 }, w, h);
      const a2 = project3DTo2D({ x: g, y: 0.5, z: 0 }, w, h);
      draw3DLine(ctx, a1, a2, 1, "rgba(51, 65, 85, 0.38)");

      const b1 = project3DTo2D({ x: -0.3, y: g, z: 0 }, w, h);
      const b2 = project3DTo2D({ x: 0.6, y: g, z: 0 }, w, h);
      draw3DLine(ctx, b1, b2, 1, "rgba(51, 65, 85, 0.38)");
    }

    const orig = project3DTo2D({ x: 0, y: 0, z: 0 }, w, h);
    const axisX = project3DTo2D({ x: 0.12, y: 0, z: 0 }, w, h);
    const axisY = project3DTo2D({ x: 0, y: 0.12, z: 0 }, w, h);
    const axisZ = project3DTo2D({ x: 0, y: 0, z: 0.12 }, w, h);
    draw3DLine(ctx, orig, axisX, 2, "#ef4444");
    draw3DLine(ctx, orig, axisY, 2, "#22c55e");
    draw3DLine(ctx, orig, axisZ, 2, "#3b82f6");

    const kin = computeArmKinematics3D();

    const readout = document.getElementById("eeReadout");
    if (readout) {
      readout.textContent = `Punho 3D: X: ${kin.wristPos.x.toFixed(2)}m | Y: ${kin.wristPos.y.toFixed(2)}m | Z: ${kin.wristPos.z.toFixed(2)}m`;
    }

    const pBase = project3DTo2D(kin.baseFloorPos, w, h);
    const pHip = project3DTo2D(kin.hipPos, w, h);
    const pNeck = project3DTo2D(kin.neckPos, w, h);
    const pLeftSh = project3DTo2D(kin.leftShoulderPos, w, h);
    const pRightSh = project3DTo2D(kin.shoulderPos, w, h);

    draw3DLine(ctx, pBase, pHip, 8, "#1e293b");
    draw3DLine(ctx, pHip, pNeck, 14, "#334155");
    draw3DLine(ctx, pLeftSh, pRightSh, 12, "#475569");
    draw3DJoint(ctx, pHip, 6, "#475569");
    draw3DJoint(ctx, pNeck, 8, "#64748b");

    const pHead = project3DTo2D(kin.headPos, w, h);
    draw3DLine(ctx, pNeck, pHead, 8, "#475569");
    draw3DJoint(ctx, pHead, 15, "#1e293b", "#64748b");

    const pElbow = project3DTo2D(kin.elbowPos, w, h);
    const pWrist = project3DTo2D(kin.wristPos, w, h);

    draw3DLine(ctx, pRightSh, pElbow, 15, "#0284c7");
    draw3DLine(ctx, pRightSh, pElbow, 7, "#38bdf8");

    draw3DLine(ctx, pElbow, pWrist, 13, "#4f46e5");
    draw3DLine(ctx, pElbow, pWrist, 6, "#818cf8");

    const projCorners = kin.palmCorners.map((c) => project3DTo2D(c, w, h));
    ctx.beginPath();
    ctx.moveTo(projCorners[0].x, projCorners[0].y);
    for (let i = 1; i < projCorners.length; i++) {
      ctx.lineTo(projCorners[i].x, projCorners[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(16, 185, 129, 0.35)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#10b981";
    ctx.stroke();

    kin.fingers3D.forEach((f) => {
      const pts2d = f.points.map((pt) => project3DTo2D(pt, w, h));
      for (let i = 0; i < pts2d.length - 1; i++) {
        draw3DLine(ctx, pts2d[i], pts2d[i + 1], 4.5 - i * 0.8, f.color);
      }
      pts2d.forEach((pt, idx) => {
        draw3DJoint(ctx, pt, idx === pts2d.length - 1 ? 2.5 : 3, "#f8fafc", f.color);
      });
    });

    draw3DJoint(ctx, pRightSh, 9, "#38bdf8", "#0f172a");
    draw3DJoint(ctx, pElbow, 8, "#818cf8", "#0f172a");
    draw3DJoint(ctx, pWrist, 6.5, "#34d399", "#0f172a");

    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(
      `Ombro (CH11: ${Math.round(state.servos.shoulder_pitch?.angle ?? 90)}° | CH12: ${Math.round(state.servos.shoulder_abduction?.angle ?? 85)}°)`,
      pRightSh.x + 12,
      pRightSh.y - 8
    );
    ctx.fillText(
      `Cotovelo (CH8: ${Math.round(state.servos.elbow?.angle ?? 180)}°)`,
      pElbow.x + 12,
      pElbow.y + 4
    );
  }

  requestAnimationFrame(render3DLoop);
}

function setupCameraInteraction() {
  const canvas = document.getElementById("arm3dCanvas");
  if (!canvas) return;

  canvas.addEventListener("mousedown", (e) => {
    camera.dragging = true;
    camera.lastX = e.clientX;
    camera.lastY = e.clientY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!camera.dragging) return;
    const dx = e.clientX - camera.lastX;
    const dy = e.clientY - camera.lastY;
    camera.lastX = e.clientX;
    camera.lastY = e.clientY;

    camera.yaw += dx * 0.008;
    camera.pitch = Math.max(-1.2, Math.min(1.3, camera.pitch + dy * 0.008));
  });

  window.addEventListener("mouseup", () => {
    camera.dragging = false;
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        camera.dragging = true;
        camera.lastX = e.touches[0].clientX;
        camera.lastY = e.touches[0].clientY;
      }
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (!camera.dragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - camera.lastX;
      const dy = e.touches[0].clientY - camera.lastY;
      camera.lastX = e.touches[0].clientX;
      camera.lastY = e.touches[0].clientY;
      camera.yaw += dx * 0.008;
      camera.pitch = Math.max(-1.2, Math.min(1.3, camera.pitch + dy * 0.008));
    },
    { passive: true }
  );

  canvas.addEventListener("touchend", () => {
    camera.dragging = false;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      camera.distance = Math.max(0.45, Math.min(2.2, camera.distance + e.deltaY * 0.001));
    },
    { passive: false }
  );

  document.querySelectorAll(".camera-toolbar .btn-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".camera-toolbar .btn-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const view = btn.getAttribute("data-cam");
      if (view === "perspective") {
        camera.yaw = -0.65;
        camera.pitch = 0.26;
        camera.distance = 1.25;
        camera.target = { x: 0.12, y: 0.04, z: 0.38 };
      } else if (view === "front") {
        camera.yaw = 0.0;
        camera.pitch = 0.08;
        camera.distance = 1.25;
        camera.target = { x: 0.12, y: 0.04, z: 0.38 };
      } else if (view === "side") {
        camera.yaw = -Math.PI / 2;
        camera.pitch = 0.08;
        camera.distance = 1.25;
        camera.target = { x: 0.16, y: 0.05, z: 0.38 };
      } else if (view === "top") {
        camera.yaw = 0.0;
        camera.pitch = 1.28;
        camera.distance = 1.3;
        camera.target = { x: 0.16, y: 0.05, z: 0.38 };
      } else if (view === "hand") {
        const kin = computeArmKinematics3D();
        camera.yaw = -0.5;
        camera.pitch = 0.25;
        camera.distance = 0.58;
        camera.target = { ...kin.wristPos };
      }
    });
  });
}
