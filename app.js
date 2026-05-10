const LAADSCHERM_DUUR = 1500;
const HINT_DUUR = 1800;
const OBJECT_SCHAAL = 500;
const OBJECT_MAX_SCHAAL = 50000;
const OBJECT_MIN_SCHAAL = 100;
const BEWEEG_BEREIK_X = 3.2;
const BEWEEG_BEREIK_Z = 3.2;
const ROTEER_SNELHEID = 0.75;
const ROTATIE_TILT_SNELHEID = 0.14;
const ROTATE_DRAG_SNELHEID = 0.45;
const SMOOTHING = 0.18;
const SCHAAL_DREMPEL = 8;
const ROTATIE_DREMPEL = 0.8;
const PINCH_MIN_AFSTAND = 80;
const ROTATE_MAX_AFSTAND = 90;
const ROTATE_MOVE_DREMPEL = 6;
const SAME_DIRECTION_DREMPEL = 0.75;
const MARKER_LOST_DELAY = 220;
const MARKER_KWIJT_DUUR = 1200;
const ASSET_CACHE_BUSTER = Date.now();

let models = [];
let arReady = false;
let arStarted = false;
let touchHandlersReady = false;
let renderLoopStarted = false;

const objectStates = {};

let activeMarkerId = null;
let activeMarkerEl = null;
let activeEntity = null;
let touch = { prev: null, mode: null, prevDist: 0, prevAngle: 0, prevMid: null, prevTouches: null };
const markerLostTimers = {};

function createState() {
  return {
    current: {
      scale: OBJECT_SCHAAL,
      rotX: 0, rotY: 0, rotZ: 0,
      posX: 0, posY: 0, posZ: 0
    },
    target: {
      scale: OBJECT_SCHAAL,
      rotX: 0, rotY: 0, rotZ: 0,
      posX: 0, posY: 0, posZ: 0
    },
    loaded: false
  };
}

function getState(markerId) {
  if (!objectStates[markerId]) {
    objectStates[markerId] = createState();
  }
  return objectStates[markerId];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(current, target, factor) {
  return current + (target - current) * factor;
}

function normalizeAngleDelta(delta) {
  let normalized = delta;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function syncObjectTransform(entity, state) {
  if (!entity || !entity.object3D) return;
  entity.object3D.position.set(state.current.posX, state.current.posY, state.current.posZ);
  entity.object3D.rotation.set(
    THREE.MathUtils.degToRad(state.current.rotX),
    THREE.MathUtils.degToRad(state.current.rotY),
    THREE.MathUtils.degToRad(state.current.rotZ)
  );
  entity.object3D.scale.set(state.current.scale, state.current.scale, state.current.scale);
}

function animateObjects() {
  Object.values(objectStates).forEach(({ entity, current, target }) => {
    if (!entity) return;

    current.posX = lerp(current.posX, target.posX, SMOOTHING);
    current.posY = lerp(current.posY, target.posY, SMOOTHING);
    current.posZ = lerp(current.posZ, target.posZ, SMOOTHING);
    current.scale = lerp(current.scale, target.scale, SMOOTHING);
    current.rotX = lerp(current.rotX, target.rotX, SMOOTHING);
    current.rotY = lerp(current.rotY, target.rotY, SMOOTHING);
    current.rotZ = lerp(current.rotZ, target.rotZ, SMOOTHING);

    syncObjectTransform(entity, { current });
  });

  requestAnimationFrame(animateObjects);
}

function startRenderLoop() {
  if (renderLoopStarted) return;
  renderLoopStarted = true;
  requestAnimationFrame(animateObjects);
}

function getTouchDistance(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function getTouchAngle(t1, t2) {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
}

function getTouchMidpoint(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

function showHint(text, duration = HINT_DUUR) {
  const hint = document.getElementById("interact-hint");
  hint.textContent = text;
  hint.classList.add("visible");
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => hint.classList.remove("visible"), duration);
}

function setStatus(text) {
  document.getElementById("status-text").textContent = text;
}

function resetInteractionState() {
  touch = { prev: null, mode: null, prevDist: 0, prevAngle: 0, prevMid: null, prevTouches: null };
  setModeIndicator(null);
  document.getElementById("active-label").classList.remove("visible");
  clearTimeout(document.getElementById("interact-hint")._timer);
  document.getElementById("interact-hint").classList.remove("visible");
}

function getPointOnMarkerPlane(markerEl, clientX, clientY) {
  const sceneEl = document.getElementById("ar-scene-el");
  if (!sceneEl || !sceneEl.camera || !markerEl || !markerEl.object3D) return null;

  const markerObject = markerEl.object3D;
  const localNormal = new THREE.Vector3(0, 1, 0);
  const worldNormal = localNormal.clone().transformDirection(markerObject.matrixWorld).normalize();
  const worldOrigin = markerObject.getWorldPosition(new THREE.Vector3());

  const pointer = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, sceneEl.camera);

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(worldNormal, worldOrigin);
  const worldPoint = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(plane, worldPoint);
  if (!hit) return null;

  const localPoint = markerObject.worldToLocal(worldPoint.clone());
  return {
    posX: clamp(localPoint.x, -BEWEEG_BEREIK_X, BEWEEG_BEREIK_X),
    posY: 0,
    posZ: clamp(localPoint.z, -BEWEEG_BEREIK_Z, BEWEEG_BEREIK_Z)
  };
}

function centerObjectState(state, markerEl) {
  const centerPoint = getPointOnMarkerPlane(markerEl, window.innerWidth / 2, window.innerHeight / 2);
  const posX = centerPoint ? centerPoint.posX : 0;
  const posY = centerPoint ? centerPoint.posY : 0;
  const posZ = centerPoint ? centerPoint.posZ : 0;

  state.current.posX = posX;
  state.current.posY = posY;
  state.current.posZ = posZ;
  state.target.posX = posX;
  state.target.posY = posY;
  state.target.posZ = posZ;
}

function centerModelPivot(entity) {
  const mesh = entity.getObject3D("mesh");
  if (!mesh || mesh.userData.pivotCentered) return;

  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  mesh.worldToLocal(center);
  mesh.position.sub(center);
  mesh.updateMatrixWorld(true);
  mesh.userData.pivotCentered = true;
}

function getDirectionSimilarity(deltaA, deltaB) {
  const lenA = Math.hypot(deltaA.x, deltaA.y);
  const lenB = Math.hypot(deltaB.x, deltaB.y);
  if (!lenA || !lenB) return 0;
  return ((deltaA.x * deltaB.x) + (deltaA.y * deltaB.y)) / (lenA * lenB);
}

function isTouchOnActiveObject(touchPoint) {
  const sceneEl = document.getElementById("ar-scene-el");
  const activeState = activeMarkerId ? getState(activeMarkerId) : null;
  if (!sceneEl || !sceneEl.camera || !activeEntity || !activeEntity.object3D || !activeState?.loaded) return false;

  const meshes = [];
  activeEntity.object3D.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  if (!meshes.length) return false;

  const pointer = new THREE.Vector2(
    (touchPoint.clientX / window.innerWidth) * 2 - 1,
    -(touchPoint.clientY / window.innerHeight) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, sceneEl.camera);
  return raycaster.intersectObjects(meshes, true).length > 0;
}

function setModeIndicator(mode) {
  document.getElementById("mode-move").classList.toggle("active", mode === "move");
  document.getElementById("mode-scale").classList.toggle("active", mode === "scale");
  document.getElementById("mode-rotate").classList.toggle("active", mode === "rotate");
}

function resetActiveObject() {
  if (!activeMarkerId || !activeMarkerEl || !activeEntity) return;
  const state = getState(activeMarkerId);
  centerObjectState(state, activeMarkerEl);
  state.current.scale = OBJECT_SCHAAL;
  state.target.scale = OBJECT_SCHAAL;
  state.current.rotX = 0;
  state.current.rotY = 0;
  state.current.rotZ = 0;
  state.target.rotX = 0;
  state.target.rotY = 0;
  state.target.rotZ = 0;
  syncObjectTransform(activeEntity, state);
  showHint("OBJECT GERSET");
}

function setupTouchHandlers() {
  if (touchHandlersReady) return;
  touchHandlersReady = true;

  const arContainer = document.getElementById("ar-scene");

  arContainer.addEventListener("touchstart", (e) => {
    if (!activeEntity || !activeMarkerId) return;
    const state = getState(activeMarkerId);
    if (!state.loaded) {
      showHint("MODEL WORDT NOG GELADEN...");
      return;
    }

    e.preventDefault();

    if (e.touches.length === 1) {
      if (!isTouchOnActiveObject(e.touches[0])) {
        touch.mode = null;
        setModeIndicator(null);
        return;
      }
      touch.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touch.mode = "move";
      setModeIndicator("move");
      showHint("SLEPEN OM TE VERPLAATSEN");
    } else if (e.touches.length === 2) {
      touch.prevDist = getTouchDistance(e.touches[0], e.touches[1]);
      touch.prevAngle = getTouchAngle(e.touches[0], e.touches[1]);
      touch.prevMid = getTouchMidpoint(e.touches[0], e.touches[1]);
      touch.prevTouches = [
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY }
      ];
      touch.mode = "rotate";
      setModeIndicator("rotate");
      showHint("TWEE VINGERS OM TE DRAAIEN OF SCHALEN");
    }
  }, { passive: false });

  arContainer.addEventListener("touchmove", (e) => {
    if (!activeEntity || !activeMarkerId) return;
    const state = getState(activeMarkerId);
    if (!state.loaded) return;

    e.preventDefault();

    if (e.touches.length === 1 && touch.mode === "move" && touch.prev) {
      const planePosition = getPointOnMarkerPlane(activeMarkerEl, e.touches[0].clientX, e.touches[0].clientY);
      if (planePosition) {
        state.target.posX = planePosition.posX;
        state.target.posY = planePosition.posY;
        state.target.posZ = planePosition.posZ;
      }
      touch.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && touch.prevMid && touch.prevTouches) {
      const curDist = getTouchDistance(e.touches[0], e.touches[1]);
      const curAngle = getTouchAngle(e.touches[0], e.touches[1]);
      const curMid = getTouchMidpoint(e.touches[0], e.touches[1]);
      const distDelta = curDist - touch.prevDist;
      const angleDelta = normalizeAngleDelta(curAngle - touch.prevAngle);
      const midDeltaY = curMid.y - touch.prevMid.y;
      const midDeltaX = curMid.x - touch.prevMid.x;
      const deltaA = {
        x: e.touches[0].clientX - touch.prevTouches[0].x,
        y: e.touches[0].clientY - touch.prevTouches[0].y
      };
      const deltaB = {
        x: e.touches[1].clientX - touch.prevTouches[1].x,
        y: e.touches[1].clientY - touch.prevTouches[1].y
      };
      const directionSimilarity = getDirectionSimilarity(deltaA, deltaB);
      const averageMove = (Math.hypot(deltaA.x, deltaA.y) + Math.hypot(deltaB.x, deltaB.y)) / 2;
      const isPinchGesture = curDist >= PINCH_MIN_AFSTAND && Math.abs(distDelta) > SCHAAL_DREMPEL;
      const isRotateGesture =
        curDist <= ROTATE_MAX_AFSTAND &&
        directionSimilarity >= SAME_DIRECTION_DREMPEL &&
        averageMove >= ROTATE_MOVE_DREMPEL;

      if (isPinchGesture) {
        const scaleFactor = touch.prevDist > 0 ? curDist / touch.prevDist : 1;
        state.target.scale = clamp(state.target.scale * scaleFactor, OBJECT_MIN_SCHAAL, OBJECT_MAX_SCHAAL);
        if (touch.mode !== "scale") {
          touch.mode = "scale";
          setModeIndicator("scale");
          showHint("PINCH OM TE SCHALEN");
        }
      } else if (isRotateGesture || Math.abs(angleDelta) > ROTATIE_DREMPEL) {
        state.target.rotY += midDeltaX * ROTATE_DRAG_SNELHEID;
        state.target.rotX = clamp(state.target.rotX + (midDeltaY * ROTATIE_TILT_SNELHEID), -85, 85);
        if (touch.mode !== "rotate") {
          touch.mode = "rotate";
          setModeIndicator("rotate");
          showHint("TWEE VINGERS ROTEREN");
        }
      }

      touch.prevDist = curDist;
      touch.prevAngle = curAngle;
      touch.prevMid = curMid;
      touch.prevTouches = [
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY }
      ];
    }
  }, { passive: false });

  arContainer.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      touch = { prev: null, mode: null, prevDist: 0, prevAngle: 0, prevMid: null, prevTouches: null };
      setModeIndicator(null);
    } else if (e.touches.length === 1) {
      touch.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touch.prevDist = 0;
      touch.prevAngle = 0;
      touch.prevMid = null;
      touch.prevTouches = null;
      touch.mode = "move";
      setModeIndicator("move");
    }
  }, { passive: false });
}

async function loadModels() {
  try {
    const res = await fetch(`models.json?nocache=${ASSET_CACHE_BUSTER}`);
    if (!res.ok) throw new Error("models.json kon niet geladen worden");
    models = await res.json();
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error("models.json bevat geen geldige modellenlijst");
    }
    setupLanding();
    setupARScene();
  } catch (error) {
    setStatus("FOUT: MODELLEN NIET GELADEN");
  }
}

function setupLanding() {
  const list = document.getElementById("model-list");
  const count = document.getElementById("model-count");
  const btn = document.getElementById("start-btn");

  count.textContent = `${models.length} OBJECTEN GELADEN`;
  list.innerHTML = models.map((name, i) => {
    const cleanName = name
      .replace(/^models\//i, "")
      .replace(".glb", "")
      .replace(/-ply/gi, "")
      .replace(/_ply/gi, "");
    return `<div class="model-item">
      <span class="model-barcode">BARCODE ${i}</span>
      <span class="model-name">${cleanName}</span>
    </div>`;
  }).join("");

  btn.disabled = false;
  setStatus("SYSTEEM GEREED - CAMERA VEREIST");
}

function setupARScene() {
  const assets = document.getElementById("ar-assets");
  const scene = document.getElementById("ar-scene-el");

  models.forEach((name, i) => {
    const asset = document.createElement("a-asset-item");
    asset.setAttribute("id", `model-${i}`);
    asset.setAttribute("src", `${name}?v=${ASSET_CACHE_BUSTER}`);
    asset.addEventListener("error", () => {
      setStatus(`FOUT BIJ LADEN VAN MODEL: ${name}`);
    });
    assets.appendChild(asset);

    const marker = document.createElement("a-marker");
    marker.setAttribute("type", "barcode");
    marker.setAttribute("value", String(i));
    marker.setAttribute("id", `marker-${i}`);
    marker.setAttribute("smooth", "true");
    marker.setAttribute("smoothCount", "20");
    marker.setAttribute("smoothTolerance", "0.02");
    marker.setAttribute("smoothThreshold", "8");

    const entity = document.createElement("a-entity");
    entity.setAttribute("gltf-model", `#model-${i}`);
    entity.setAttribute("id", `entity-${i}`);

    const state = getState(`marker-${i}`);
    state.entity = entity;
    syncObjectTransform(entity, state);

    entity.addEventListener("model-loaded", () => {
      state.loaded = true;
      centerModelPivot(entity);
      if (activeMarkerEl === marker) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            centerObjectState(state, marker);
            syncObjectTransform(entity, state);
            showHint("MODEL GELADEN - JE KAN NU INTERAGEREN");
          });
        });
      }
    });

    marker.appendChild(entity);
    const camera = scene.querySelector("a-entity[camera]");
    scene.insertBefore(marker, camera);

    const cleanName = name
      .replace(/^models\//i, "")
      .replace(".glb", "")
      .replace(/-ply/gi, "")
      .replace(/_ply/gi, "");

    marker.addEventListener("markerFound", () => {
      clearTimeout(markerLostTimers[`marker-${i}`]);
      activeMarkerId = `marker-${i}`;
      activeMarkerEl = marker;
      activeEntity = entity;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          centerObjectState(state, marker);
          syncObjectTransform(entity, state);
        });
      });

      const label = document.getElementById("active-label");
      label.textContent = `▸ ${cleanName.toUpperCase()} GEVONDEN`;
      label.classList.add("visible");
      showHint(state.loaded ? "OBJECT GEVONDEN - SLEEP OF PINCH" : "MODEL WORDT GELADEN...");
    });

    marker.addEventListener("markerLost", () => {
      markerLostTimers[`marker-${i}`] = setTimeout(() => {
        if (activeMarkerId === `marker-${i}`) {
          activeMarkerId = null;
          activeMarkerEl = null;
          activeEntity = null;
          resetInteractionState();
          showHint("MARKER KWIJT", MARKER_KWIJT_DUUR);
        }
      }, MARKER_LOST_DELAY);
    });
  });

  arReady = true;
  startRenderLoop();
}

function stopCamera() {
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  });
}

function startAR() {
  if (!arReady || arStarted) return;
  arStarted = true;
  const scene = document.getElementById("ar-scene-el");
  document.getElementById("landing").style.display = "none";
  document.getElementById("loading-screen").classList.add("active");

  setTimeout(() => {
    document.getElementById("loading-screen").classList.remove("active");
    document.getElementById("ar-scene").classList.add("active");
    if (scene && typeof scene.play === "function") {
      scene.play();
    }
    setupTouchHandlers();
    showHint("RICHT OP EEN BARCODE OM TE STARTEN");
  }, LAADSCHERM_DUUR);
}

function setupBackButton() {
  const backBtn = document.getElementById("back-btn");
  if (!backBtn || backBtn._bound) return;
  backBtn._bound = true;

  const handleBack = (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopAR();
  };

  backBtn.addEventListener("click", handleBack);
  backBtn.addEventListener("touchstart", handleBack, { passive: false });
}

function setupResetButton() {
  const resetBtn = document.getElementById("reset-btn");
  if (!resetBtn || resetBtn._bound) return;
  resetBtn._bound = true;

  const handleReset = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetActiveObject();
  };

  resetBtn.addEventListener("click", handleReset);
  resetBtn.addEventListener("touchstart", handleReset, { passive: false });
}

function stopAR() {
  const scene = document.getElementById("ar-scene-el");
  document.getElementById("ar-scene").classList.remove("active");
  document.getElementById("landing").style.display = "flex";
  activeMarkerId = null;
  activeMarkerEl = null;
  activeEntity = null;
  arStarted = false;
  Object.keys(markerLostTimers).forEach((key) => clearTimeout(markerLostTimers[key]));
  resetInteractionState();
  if (scene && typeof scene.pause === "function") {
    scene.pause();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});

window.addEventListener("beforeunload", stopCamera);
window.addEventListener("pagehide", stopCamera);

document.getElementById("start-btn").addEventListener("click", startAR);
setupBackButton();
setupResetButton();
loadModels();
