// INSTELBARE PARAMETERS
// Dit zijn de belangrijkste waarden om gedrag en gevoel van de AR-site te tunen.
const LAADSCHERM_DUUR = 1500;
const HINT_DUUR = 1800;
const OBJECT_SCHAAL = 150;
const OBJECT_MAX_SCHAAL = 1000;
const OBJECT_MIN_SCHAAL = 50;
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
const BARCODE_HINT_DELAY = 30000;
const MODEL_GEVONDEN_DUUR = 10000;
const ASSET_CACHE_BUSTER = Date.now();

// RUNTIME STATE
// Houdt bij welke modellen geladen zijn en welke AR-status momenteel actief is.
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
let barcodeHintTimer = null;

// createState:
// Maakt de standaardtoestand van een object aan.
// current = wat nu zichtbaar is
// target = waar het object naartoe beweegt
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

// getState:
// Geeft de toestand van een bepaald markerobject terug en maakt die indien nodig aan.
function getState(markerId) {
  if (!objectStates[markerId]) {
    objectStates[markerId] = createState();
  }
  return objectStates[markerId];
}

// clamp:
// Houdt een waarde tussen minimum en maximum.
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// lerp:
// Lineaire interpolatie tussen current en target.
// Hierdoor verlopen bewegingen vloeiender en minder schokkerig.
function lerp(current, target, factor) {
  return current + (target - current) * factor;
}

// normalizeAngleDelta:
// Voorkomt rotatiesprongen rond -180 / 180 graden.
function normalizeAngleDelta(delta) {
  let normalized = delta;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

// syncObjectTransform:
// Zet positie, rotatie en schaal effectief op het Three.js object van A-Frame.
// Dit is kernlogica van de 3D-transformatie.
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

// animateObjects:
// Loopt continu via requestAnimationFrame en laat current naar target bewegen.
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

// startRenderLoop:
// Zorgt dat de animatielus slechts één keer opstart.
function startRenderLoop() {
  if (renderLoopStarted) return;
  renderLoopStarted = true;
  requestAnimationFrame(animateObjects);
}

// TOUCH HULPFUNCTIES
// Nodig om pinch, rotatie en 2-vinger bewegingen te interpreteren.
function getTouchDistance(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function getTouchAngle(t1, t2) {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
}

function getTouchMidpoint(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

// showHint:
// Toont tijdelijk instructietekst in de AR-overlay.
function showHint(text, duration = HINT_DUUR) {
  const hint = document.getElementById("interact-hint");
  hint.textContent = text;
  hint.classList.add("visible");
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => hint.classList.remove("visible"), duration);
}

// setStatus:
// Centrale functie om meldingen op de landing page te tonen.
function setStatus(text) {
  document.getElementById("status-text").textContent = text;
}

function setBarcodeHintVisible(visible) {
  document.querySelector(".ar-hint").classList.toggle("visible", visible);
}

function clearBarcodeHintTimer() {
  clearTimeout(barcodeHintTimer);
  barcodeHintTimer = null;
}

function scheduleBarcodeHint() {
  clearBarcodeHintTimer();
  setBarcodeHintVisible(false);
  barcodeHintTimer = setTimeout(() => {
    if (!activeMarkerId && arStarted) {
      setBarcodeHintVisible(true);
    }
  }, BARCODE_HINT_DELAY);
}

// resetInteractionState:
// Wist tijdelijke touch- en HUD-status wanneer AR stopt of een marker verloren gaat.
function resetInteractionState() {
  touch = { prev: null, mode: null, prevDist: 0, prevAngle: 0, prevMid: null, prevTouches: null };
  setModeIndicator(null);
  document.getElementById("active-label").classList.remove("visible");
  clearTimeout(document.getElementById("interact-hint")._timer);
  document.getElementById("interact-hint").classList.remove("visible");
}

// getPointOnMarkerPlane:
// Projecteert een schermpunt naar het vlak van de actieve marker.
// Hierdoor kan het object de vinger veel accurater volgen.
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

// centerObjectState:
// Zet het object op het punt van het markervlak dat overeenkomt met het schermcentrum.
// Dit maakt de centrering toestel-onafhankelijk.
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

// centerModelPivot:
// Verplaatst het GLB-model intern zodat zijn visuele middelpunt overeenkomt met de entity-origin.
// Handig als het model zelf met een slechte pivot geëxporteerd werd.
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

// getDirectionSimilarity:
// Vergelijkt of twee vingers ongeveer in dezelfde richting bewegen.
// Zo maken we beter onderscheid tussen pinch en rotatie.
function getDirectionSimilarity(deltaA, deltaB) {
  const lenA = Math.hypot(deltaA.x, deltaA.y);
  const lenB = Math.hypot(deltaB.x, deltaB.y);
  if (!lenA || !lenB) return 0;
  return ((deltaA.x * deltaB.x) + (deltaA.y * deltaB.y)) / (lenA * lenB);
}

// isTouchOnActiveObject:
// Controleert via raycasting of de gebruiker echt op het 3D-object tikt.
// Slepen start dus niet als je gewoon ergens op het scherm raakt.
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

// setModeIndicator:
// Laat visueel zien of de gebruiker aan het verplaatsen, schalen of roteren is.
function setModeIndicator(mode) {
  document.getElementById("mode-move").classList.toggle("active", mode === "move");
  document.getElementById("mode-scale").classList.toggle("active", mode === "scale");
  document.getElementById("mode-rotate").classList.toggle("active", mode === "rotate");
}

// resetActiveObject:
// Zet schaal, rotatie en positie van het actieve object terug naar de beginstand.
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

// setupTouchHandlers:
// Hoofdlogica voor touch-interactie:
// - 1 vinger = verplaatsen
// - 2 vingers ver uit elkaar = pinch-schalen
// - 2 vingers dichter bij elkaar en in dezelfde richting = roteren
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

// loadModels:
// Haalt models.json op. Dat bestand bepaalt welke GLB-modellen de website kent.
// Dankzij de cache-buster wordt steeds de recentste versie gevraagd.
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

// setupLanding:
// Vult de landing page dynamisch met objectnamen en barcode-indexen.
// Belangrijk: index i van een model wordt barcode i.
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

// setupARScene:
// Bouwt voor elk model:
// - een asset
// - een barcode-marker
// - een A-Frame entity
// Dit is de kernfunctie van de marker-gebaseerde AR-werking.
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
      clearBarcodeHintTimer();
      setBarcodeHintVisible(false);
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
      showHint(state.loaded ? "OBJECT GEVONDEN - SLEEP OF PINCH" : "MODEL WORDT GELADEN...", MODEL_GEVONDEN_DUUR);
    });

    marker.addEventListener("markerLost", () => {
      markerLostTimers[`marker-${i}`] = setTimeout(() => {
        if (activeMarkerId === `marker-${i}`) {
          activeMarkerId = null;
          activeMarkerEl = null;
          activeEntity = null;
          resetInteractionState();
          showHint("MARKER KWIJT", MARKER_KWIJT_DUUR);
          scheduleBarcodeHint();
        }
      }, MARKER_LOST_DELAY);
    });
  });

  arReady = true;
  startRenderLoop();
}

// stopCamera:
// Stopt de echte camerastream wanneer de pagina verborgen wordt of sluit.
function stopCamera() {
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  });
}

// startAR:
// Wisselt van landing page naar AR-weergave en hervat de scene.
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
    scheduleBarcodeHint();
  }, LAADSCHERM_DUUR);
}

// setupBackButton:
// Maakt de terugknop robuust door eigen click/touch handlers te registreren.
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

// setupResetButton:
// Bindt de resetknop zodat de gebruiker het actieve object kan resetten.
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

// stopAR:
// Sluit de AR-view, toont de landing page opnieuw en reset actieve status.
function stopAR() {
  const scene = document.getElementById("ar-scene-el");
  document.getElementById("ar-scene").classList.remove("active");
  document.getElementById("landing").style.display = "flex";
  activeMarkerId = null;
  activeMarkerEl = null;
  activeEntity = null;
  arStarted = false;
  Object.keys(markerLostTimers).forEach((key) => clearTimeout(markerLostTimers[key]));
  clearBarcodeHintTimer();
  setBarcodeHintVisible(false);
  resetInteractionState();
  if (scene && typeof scene.pause === "function") {
    scene.pause();
  }
}

// PAGE LIFECYCLE
// Zorgt dat de camera gestopt wordt wanneer de pagina verdwijnt.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});

window.addEventListener("beforeunload", stopCamera);
window.addEventListener("pagehide", stopCamera);

// INIT
// Bindt UI-events en laadt daarna de modellen.
document.getElementById("start-btn").addEventListener("click", startAR);
setupBackButton();
setupResetButton();
loadModels();
