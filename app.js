const $ = (selector) => document.querySelector(selector);
const slider = $("#angleSlider");
const targetInput = $("#targetInput");
const repGoal = $("#repGoal");

let angle = 0;
let target = 60;
let reps = 0;
let maxAngle = 0;
let hasReachedTarget = false;
let history = [];
let toastTimer;
let audioContext = null;
let sourceMode = "demo";
let bleDevice = null;
let bleServer = null;
let bleCharacteristic = null;
let readTimer = null;
let readInProgress = false;
let packetCount = 0;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function nowTime() {
  return new Intl.DateTimeFormat("ko-KR", {hour:"2-digit", minute:"2-digit", second:"2-digit"}).format(new Date());
}

// Audio is prepared from a user gesture (test button, slider interaction or BLE connect).
function prepareAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  try {
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return true;
  } catch (error) {
    console.warn("Audio could not be initialized:", error);
    return false;
  }
}

function playTargetSound() {
  if (!$("#soundEnabled").checked) return;
  if (!prepareAudio() || !audioContext) {
    showToast("이 브라우저에서는 신호음을 재생할 수 없습니다.");
    return;
  }

  const scheduleTone = () => {
    if (!audioContext || audioContext.state !== "running") {
      showToast("신호음이 차단되어 있어요. '신호음 테스트'를 한 번 눌러 주세요.");
      return;
    }
    const startAt = audioContext.currentTime + 0.02;
    [880, 1175].forEach((frequency, index) => {
      const start = startAt + index * 0.19;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    });
  };

  if (audioContext.state === "suspended") {
    audioContext.resume().then(scheduleTone).catch(() => showToast("브라우저에서 신호음을 재생할 수 없습니다."));
  } else {
    scheduleTone();
  }
}

function addHistory(event, isRep = false) {
  history.unshift({time: nowTime(), angle, event, reps, isRep});
  history = history.slice(0, 30);
  renderHistory();
}

function renderHistory() {
  const body = $("#historyBody");
  body.replaceChildren();
  if (!history.length) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "아직 기록이 없습니다. 각도 시뮬레이터를 움직여 측정을 시작하세요.";
    tr.append(td);
    body.append(tr);
    return;
  }
  history.forEach(row => {
    const tr = document.createElement("tr");
    [row.time, `${row.angle}°`].forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    const eventTd = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = `event-tag${row.isRep ? " rep" : ""}`;
    tag.textContent = row.event;
    eventTd.append(tag);
    tr.append(eventTd);
    const repTd = document.createElement("td");
    repTd.textContent = `${row.reps}회`;
    tr.append(repTd);
    body.append(tr);
  });
}

function updateUI() {
  $("#angleMetric").textContent = angle;
  $("#angleReadout").textContent = angle;
  $("#sliderValue").textContent = angle;
  $("#repMetric").textContent = reps;
  $("#targetMetric").textContent = target;
  $("#summaryTarget").textContent = target;
  $("#maxAngle").textContent = maxAngle;
  $("#summaryReps").textContent = reps;
  $("#angleStatus").textContent = angle <= 10 ? "기준 자세" : angle >= target ? "목표 구간 도달" : "움직임 감지";
  $("#progressText").textContent = `${Math.min(100, Math.round(reps / Number(repGoal.value || 10) * 100))}%`;
  $("#progressBar").style.width = $("#progressText").textContent;
  $("#goalLabel").textContent = `목표 ${repGoal.value || 10}회`;
  $("#gaugeFill").style.strokeDashoffset = 298.45 * (1 - angle / 180);
  $("#gaugeNeedle").style.transform = `rotate(${-90 + angle}deg)`;
  $("#sensorAngle").textContent = packetCount > 0 ? angle : "—";
  $("#sensorMiniGauge").style.width = `${(angle / 180) * 100}%`;
  $("#sensorSoundState").textContent = $("#soundEnabled").checked ? "사용" : "꺼짐";
  slider.disabled = sourceMode === "ble";
}

function setAngle(value, log = true, origin = "demo") {
  const previous = angle;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  angle = Math.max(0, Math.min(180, Math.round(parsed)));
  if (origin !== "ble") slider.value = angle;
  maxAngle = Math.max(maxAngle, angle);
  let event = origin === "ble" ? "센서 측정" : "각도 시뮬레이션";
  let isRep = false;

  if (angle >= target && !hasReachedTarget) {
    hasReachedTarget = true;
    event = "목표 도달";
    playTargetSound();
    showToast(`목표 각도 ${target}°에 도달했어요. 신호음을 확인하세요.`);
  } else if (hasReachedTarget && angle <= 10) {
    reps += 1;
    hasReachedTarget = false;
    event = "반복 인정";
    isRep = true;
    showToast(`올바른 복귀 동작으로 ${reps}회 기록했어요.`);
  } else if (hasReachedTarget && previous > 10 && angle > 10 && angle < target) {
    event = "복귀 중";
  }

  updateUI();
  if (log && previous !== angle) addHistory(event, isRep);
}

// Screen navigation: keep the measurement dashboard and BLE workspace separate.
function showScreen(screenName) {
  const isDevice = screenName === "device";
  $("#dashboardView").hidden = isDevice;
  $("#deviceView").hidden = !isDevice;
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.screen === screenName));
  $("#breadcrumbCurrent").textContent = isDevice ? "센서 연결" : "오늘의 모니터";
  $("#pageTitle").textContent = isDevice ? "센서 연결 및 상태" : "운동 모니터링";
  $("#pageDescription").textContent = isDevice
    ? "ESP32와 IMU 센서의 BLE 연결 및 데이터 수신 상태를 확인합니다."
    : "관절의 움직임과 반복 횟수를 한눈에 확인합니다.";
  window.scrollTo({top: 0, behavior: "smooth"});
}

document.querySelectorAll("[data-screen]").forEach(item => {
  item.addEventListener("click", event => {
    event.preventDefault();
    showScreen(item.dataset.screen);
  });
});
["#session", "#history"].forEach(selector => {
  const link = document.querySelector(`a[href="${selector}"]`);
  if (!link) return;
  link.addEventListener("click", event => {
    event.preventDefault();
    showScreen("dashboard");
    setTimeout(() => document.querySelector(selector).scrollIntoView({behavior:"smooth", block:"start"}), 60);
  });
});

slider.addEventListener("input", () => {
  prepareAudio();
  setAngle(slider.value, true, "demo");
});
targetInput.addEventListener("change", () => {
  target = Math.max(10, Math.min(180, Number(targetInput.value) || 60));
  targetInput.value = target;
  hasReachedTarget = false;
  updateUI();
  showToast(`목표 각도를 ${target}°로 설정했어요.`);
  addHistory("목표 변경");
});
repGoal.addEventListener("change", () => {
  repGoal.value = Math.max(1, Math.min(100, Number(repGoal.value) || 10));
  updateUI();
});
$("#zeroBtn").addEventListener("click", () => {
  prepareAudio();
  hasReachedTarget = false;
  maxAngle = 0;
  setAngle(0, false);
  addHistory("영점 보정");
  showToast("데모 기준 자세를 0°로 설정했어요.");
});
$("#resetBtn").addEventListener("click", () => {
  prepareAudio();
  reps = 0;
  maxAngle = 0;
  hasReachedTarget = false;
  setAngle(0, false);
  history = [];
  renderHistory();
  updateUI();
  showToast("세션을 초기화했어요.");
});
$("#soundEnabled").addEventListener("change", updateUI);
$("#soundTestBtn").addEventListener("click", () => {
  if (!$("#soundEnabled").checked) {
    $("#soundEnabled").checked = true;
    updateUI();
  }
  prepareAudio();
  playTargetSound();
});
$("#clearHistoryBtn").addEventListener("click", () => {
  history = [];
  renderHistory();
  showToast("측정 기록을 지웠어요.");
});
$("#exportBtn").addEventListener("click", () => {
  const rows = [["시간","관절각","이벤트","반복 누계"], ...history.map(r => [r.time, `${r.angle}°`, r.event, r.reps])];
  const csv = "\uFEFF" + rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rom-session-record.csv";
  a.click();
  URL.revokeObjectURL(url);
  showToast("현재 기록을 CSV 파일로 내보냈어요.");
});

function validUuid(value) {
  return /^(?:[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value);
}

function setBleState(state, detail = "") {
  const badge = $("#bleStateBadge");
  const label = $("#bleStateLabel");
  const connected = state === "connected";
  badge.classList.toggle("connected", connected);
  badge.classList.toggle("waiting", !connected);
  label.textContent = connected ? "연결됨" : state === "connecting" ? "연결 중" : "연결 대기";
  $("#bleDeviceName").textContent = bleDevice?.name || (connected ? "BLE 장치" : "아직 선택된 장치가 없습니다.");
  $("#bleStatusDetail").textContent = detail || (connected ? "장치와 연결되어 데이터 수신을 기다리고 있습니다." : "연결 버튼을 눌러 주변 BLE 장치를 검색하세요.");
  $("#connectBtn").disabled = state === "connecting" || connected;
  $("#disconnectBtn").disabled = !connected;
  $("#receivingLabel").classList.toggle("active", connected && packetCount > 0);
  $("#receivingLabel").textContent = connected && packetCount > 0 ? "RECEIVING" : connected ? "CONNECTED" : "NO SIGNAL";
  $("#connectionMetric").textContent = connected ? "BLE 연결됨" : state === "connecting" ? "연결 중" : "연결 대기";
  $("#connectionFoot").textContent = connected ? `${bleDevice?.name || "ESP32"} · BLE 연결` : "ESP32 · BLE 미연결";
  $("#modePill").innerHTML = connected ? '<span class="dot"></span> 실제 센서 연결' : '<span class="dot"></span> 시뮬레이션 모드';
  $("#sessionSensorState").textContent = connected ? "BLE 센서 연결됨" : "센서 연결 전";
  $("#sessionSensorState").classList.toggle("waiting-text", !connected);
  $("#measurementSourceLabel").textContent = connected ? "BLE" : "DEMO";
  $("#measurementInputLabel").textContent = connected ? "실제 센서 데이터" : "각도 시뮬레이터";
  $("#sensorDataNotice").textContent = connected
    ? (packetCount ? "센서 데이터가 정상적으로 수신되고 있습니다. 수신 각도는 메인 모니터에도 반영됩니다." : "BLE 연결 완료. 각도 특성에서 데이터가 도착하기를 기다리고 있습니다.")
    : "센서가 연결되면 수신된 각도가 이 영역에 표시됩니다. 아직 실제 장치 데이터는 들어오지 않았습니다.";
}

function stopReadPolling() {
  if (readTimer) clearInterval(readTimer);
  readTimer = null;
  readInProgress = false;
}

function handleSensorPayload(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const raw = new TextDecoder("utf-8").decode(bytes).replace(/\0/g, "").trim();
  if (!raw) return;

  let value;
  try {
    const parsed = JSON.parse(raw);
    value = typeof parsed === "number" ? parsed : parsed?.angle;
  } catch {
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) value = Number(raw);
  }

  if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 180) {
    $("#sensorDataNotice").textContent = `읽을 수 없는 각도 데이터입니다: ${raw.slice(0, 80)} · 0~180 숫자 또는 {"angle":60} 형식을 보내 주세요.`;
    return;
  }

  packetCount += 1;
  $("#packetCount").textContent = packetCount.toLocaleString("ko-KR");
  $("#lastPacketTime").textContent = nowTime();
  $("#receivingLabel").classList.add("active");
  $("#receivingLabel").textContent = "RECEIVING";
  $("#sensorDataNotice").textContent = "센서 데이터가 정상적으로 수신되고 있습니다. 수신 각도는 메인 모니터에도 반영됩니다.";
  setAngle(Number(value), true, "ble");
}

function onGattDisconnected() {
  stopReadPolling();
  bleServer = null;
  bleCharacteristic = null;
  sourceMode = "demo";
  slider.disabled = false;
  setBleState("disconnected", "장치 연결이 끊어졌습니다. 다시 연결하려면 검색 버튼을 눌러 주세요.");
  $("#receivingLabel").classList.remove("active");
  $("#receivingLabel").textContent = "NO SIGNAL";
  updateUI();
  showToast("BLE 장치 연결이 해제되었습니다.");
}

async function connectBleDevice() {
  prepareAudio();
  if (!window.isSecureContext) {
    showToast("BLE 연결은 localhost 또는 HTTPS 주소에서 실행해 주세요.");
    $("#bleHelp").textContent = "index.html을 파일로 직접 열기보다 VS Code Live Server로 실행하거나 HTTPS 웹서버에 배포해 주세요.";
    return;
  }
  if (!navigator.bluetooth) {
    showToast("현재 브라우저는 Web Bluetooth를 지원하지 않습니다.");
    $("#bleHelp").textContent = "PC용 Chrome 또는 Edge 최신 버전을 사용해 주세요. 일부 브라우저와 운영체제에서는 BLE API가 지원되지 않을 수 있습니다.";
    return;
  }

  const serviceUuid = $("#serviceUuid").value.trim();
  const characteristicUuid = $("#characteristicUuid").value.trim();
  if (!validUuid(serviceUuid) || !validUuid(characteristicUuid)) {
    showToast("펌웨어의 Service UUID와 Characteristic UUID를 먼저 입력해 주세요.");
    $("#bleHelp").textContent = "UUID는 ESP32 BLE 펌웨어에 정의된 값을 입력해야 합니다. 현재 업로드된 기획서에는 UUID가 기재되어 있지 않습니다.";
    return;
  }

  bleDevice = null;
  packetCount = 0;
  $("#packetCount").textContent = "0";
  $("#lastPacketTime").textContent = "—";
  $("#sensorAngle").textContent = "—";
  setBleState("connecting", "주변 BLE 장치를 검색하고 있습니다.");
  try {
    bleDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [serviceUuid]
    });
    bleDevice.addEventListener("gattserverdisconnected", onGattDisconnected);
    bleServer = await bleDevice.gatt.connect();
    const service = await bleServer.getPrimaryService(serviceUuid);
    bleCharacteristic = await service.getCharacteristic(characteristicUuid);

    if (bleCharacteristic.properties.notify || bleCharacteristic.properties.indicate) {
      bleCharacteristic.addEventListener("characteristicvaluechanged", event => handleSensorPayload(event.target.value));
      await bleCharacteristic.startNotifications();
    } else if (bleCharacteristic.properties.read) {
      const readOnce = async () => {
        if (readInProgress || !bleCharacteristic || !bleServer?.connected) return;
        readInProgress = true;
        try {
          const value = await bleCharacteristic.readValue();
          handleSensorPayload(value);
        } catch (error) {
          console.warn("BLE read failed:", error);
        } finally {
          readInProgress = false;
        }
      };
      await readOnce();
      readTimer = setInterval(readOnce, 100);
    } else {
      throw new Error("이 특성은 Notify, Indicate 또는 Read를 지원하지 않습니다.");
    }

    sourceMode = "ble";
    slider.disabled = true;
    setBleState("connected", `${bleDevice.name || "선택한 장치"}에 연결되었습니다. 각도 데이터 수신 중입니다.`);
    updateUI();
    showToast("BLE 장치에 연결했습니다.");
  } catch (error) {
    console.error("BLE connection error:", error);
    if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
    setBleState("disconnected", error?.message || "장치를 연결하지 못했습니다.");
    if (error?.name === "NotFoundError") {
      showToast("장치 선택이 취소되었거나 검색된 장치가 없습니다.");
    } else {
      showToast(`BLE 연결 실패: ${error?.message || "연결 정보를 확인해 주세요."}`);
    }
  }
}

$("#connectBtn").addEventListener("click", connectBleDevice);
$("#disconnectBtn").addEventListener("click", () => {
  stopReadPolling();
  if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
  else onGattDisconnected();
});

if (!navigator.bluetooth) {
  $("#bleHelp").textContent = "이 브라우저에서는 Web Bluetooth를 사용할 수 없습니다. 데스크톱 Chrome 또는 Edge 최신 버전으로 열어 주세요.";
}

updateUI();
setBleState("disconnected");
