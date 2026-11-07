# InMoov Web Control — Braço Direito (PCA9685 + Raspberry Pi 5)

Interface web local para controlar os 9 servos do braço direito do InMoov
(5 dedos + cotovelo, rotação do braço, rotação e abdução do ombro) através de
uma placa **PCA9685** ligada via **I2C** a uma **Raspberry Pi 5**.

O servidor usa apenas a biblioteca padrão do Python para HTTP. A única
dependência externa é `adafruit-circuitpython-servokit`. Se ela ou o hardware
não estiverem disponíveis, o sistema entra automaticamente em **modo de simulação**.

---

## 1. Hardware e ligações

| PCA9685 | Raspberry Pi 5 (header 40 pinos) |
|---------|----------------------------------|
| VCC     | 3.3 V (pino 1)                   |
| GND     | GND (pino 6)                     |
| SDA     | GPIO 2 / SDA1 (pino 3)           |
| SCL     | GPIO 3 / SCL1 (pino 5)           |
| V+      | Fonte externa 5–6 V dos servos   |

> **Importante:** os servos **não** devem ser alimentados pela Raspberry Pi.
> Use uma fonte externa no borne V+ do PCA9685 e **interligue os GNDs**
> (fonte, PCA9685 e Raspberry).

### Mapa de canais

| Canal | Servo                     | Faixa      | Observação                     |
|-------|---------------------------|------------|--------------------------------|
| 0     | Polegar                   | 0°–180°    | 180° esticado, 0° fechado      |
| 1     | Indicador                 | 0°–180°    | 0° esticado, 180° fechado      |
| 3     | Médio                     | 0°–180°    | 0° esticado, 180° fechado      |
| 4     | Anelar                    | 0°–180°    | 0° esticado, 180° fechado      |
| 5     | Mindinho                  | 0°–180°    | 180° esticado, 0° fechado      |
| 8     | Cotovelo                  | 125°–180°  | 180° esticado, 125° fechado    |
| 9     | Rotação do braço          | 0°–180°    | 90° reto para frente           |
| 11    | Rotação do ombro          | 0°–180°    | 90° central                    |
| 12    | Abdução/adução do ombro   | 30°–85°    | 85° abaixado, 30° levantado    |

Os limites ficam em `SERVO_DEFINITIONS` no arquivo
[`servo_controller.py`](servo_controller.py) e são sempre aplicados pelo servidor.

---

## 2. Preparar a Raspberry Pi

Testado com **Raspberry Pi OS Bookworm (64-bit)**.

### 2.1 Habilitar o I2C

```bash
sudo raspi-config
# Interface Options → I2C → Yes
sudo reboot
```

### 2.2 Verificar se o PCA9685 foi detectado

```bash
sudo apt update
sudo apt install -y i2c-tools python3-venv python3-pip git
i2cdetect -y 1
```

O endereço `40` deve aparecer na tabela. O `70` (endereço "all-call") também
pode aparecer, e isso é normal.

Se o seu usuário não tiver acesso ao I2C:

```bash
sudo usermod -aG i2c,gpio $USER
# faça logout/login para aplicar
```

---

## 3. Instalação

O projeto é um **pacote Python** chamado `inmoov_web_control`, então a pasta
precisa manter esse nome.

```bash
mkdir -p ~/inmoov && cd ~/inmoov
git clone <URL_DO_REPOSITORIO> inmoov_web_control
# ou copie a pasta via scp/rsync:
# rsync -av inmoov_web_control/ pi@<IP_DA_PI>:~/inmoov/inmoov_web_control/
```

Crie um ambiente virtual (obrigatório no Bookworm por causa da PEP 668) e
instale as dependências:

```bash
cd ~/inmoov
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install adafruit-circuitpython-servokit
```

> **Raspberry Pi 5:** o Blinka usa `lgpio` na Pi 5. Se aparecer um erro de GPIO
> ou de `RPi.GPIO` ao iniciar, rode:
> ```bash
> pip uninstall -y RPi.GPIO
> pip install rpi-lgpio
> ```

---

## 4. Executar o servidor

Com o ambiente virtual ativado:

```bash
cd ~/inmoov/inmoov_web_control
python3 server.py
```

Ou como módulo, a partir da pasta-pai:

```bash
cd ~/inmoov
python3 -m inmoov_web_control.server
```

Ao iniciar, o terminal mostra o status do hardware e os endereços de acesso:

```
====================================================================
  InMoov Braço Direito - Interface Web de Controle (PCA9685)
====================================================================
  Status Hardware : HARDWARE PCA9685 ATIVO (I2C 0x40)
  Acesso Local    : http://localhost:8000
  Acesso na Rede  : http://192.168.0.42:8000
====================================================================
```

Abra o endereço **"Acesso na Rede"** em qualquer navegador (PC, celular, tablet)
que esteja na mesma rede da Raspberry.

### Opções de linha de comando

| Opção            | Padrão    | Descrição                                       |
|------------------|-----------|-------------------------------------------------|
| `--host`         | `0.0.0.0` | Interface de rede onde o servidor escuta        |
| `--port`         | `8000`    | Porta HTTP                                      |
| `--i2c-address`  | `0x40`    | Endereço I2C do PCA9685 (aceita `0x41`, `65`…)  |
| `--sim`          | —         | Força o modo de simulação, sem mover os servos  |

Exemplos:

```bash
python3 server.py --port 8080
python3 server.py --i2c-address 0x41
python3 server.py --sim        # testar a interface sem mover os servos
```

---

## 5. Iniciar automaticamente no boot (systemd)

Crie o arquivo `/etc/systemd/system/inmoov-web.service`, trocando `pi` pelo
seu usuário:

```ini
[Unit]
Description=InMoov Web Control (PCA9685)
After=network-online.target
Wants=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/inmoov/inmoov_web_control
ExecStart=/home/pi/inmoov/.venv/bin/python server.py --port 8000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Ative e inicie o serviço:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now inmoov-web.service
systemctl status inmoov-web.service
journalctl -u inmoov-web.service -f   # acompanhar os logs
```

---

## 6. API REST

Todos os endpoints usam JSON.

| Método | Rota            | Corpo                                         | Função                          |
|--------|-----------------|-----------------------------------------------|---------------------------------|
| GET    | `/api/state`    | —                                             | Estado completo e presets       |
| POST   | `/api/servo`    | `{"id": "index", "angle": 90}` ou `{"channel": 1, "angle": 90}` | Move um servo |
| POST   | `/api/servos`   | `{"angles": {"elbow": 150, "thumb": 0}}`      | Move vários servos              |
| POST   | `/api/hand`     | `{"closure_percent": 50}`                     | Fechamento global da mão (0–100)|
| POST   | `/api/preset`   | `{"preset": "hand_closed"}`                   | Aplica um preset                |
| POST   | `/api/release`  | `{}`                                          | Desliga o PWM (relaxa os servos)|

Presets disponíveis: `neutral`, `hand_open`, `hand_closed`, `pinch`, `point`,
`peace` e `wave_pose`.

Exemplo:

```bash
curl -X POST http://<IP_DA_PI>:8000/api/preset \
     -H "Content-Type: application/json" \
     -d '{"preset": "hand_open"}'
```

---

## 7. Solução de problemas

| Sintoma | Causa provável / solução |
|---------|--------------------------|
| O servidor mostra `MODO SIMULAÇÃO` | Biblioteca não instalada no venv, I2C desabilitado ou PCA9685 não detectado. Veja o aviso no log e confira `i2cdetect -y 1`. |
| `ModuleNotFoundError: inmoov_web_control` | A pasta foi renomeada. Ela precisa se chamar `inmoov_web_control`. |
| `externally-managed-environment` no pip | Ative o venv (`source ~/inmoov/.venv/bin/activate`). |
| Servos tremendo ou a Pi reiniciando | Fonte insuficiente ou GND não compartilhado. Use uma fonte externa dedicada. |
| A página não abre de outro dispositivo | Verifique se o dispositivo está na mesma rede, o IP e o firewall (`sudo ufw allow 8000/tcp`). |
| `Address already in use` | Outra instância já está rodando (`systemctl stop inmoov-web`) ou use outra `--port`. |
