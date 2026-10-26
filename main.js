const { jsPDF } = window.jspdf;

let scanner = null;
const pages = [];       
let activeId = null;
let dragging = null;

const uploadInput = document.getElementById("upload");
const downloadBtn = document.getElementById("download");
const filterSelect = document.getElementById("filter");
const statusEl = document.getElementById("status");
const thumbsEl = document.getElementById("thumbs");
const editorWrap = document.getElementById("editorWrap");
const editor = document.getElementById("editor");
const ctx = editor.getContext("2d");
const warningBanner = document.getElementById("warning-banner");

const HANDLE_RADIUS = 10;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#c00" : "#555";
}

window.addEventListener("load", () => {
  if (!window.jscanify) return setStatus("jscanify failed to load.", true);
  scanner = new window.jscanify();

  uploadInput.addEventListener("change", handleUpload);
  downloadBtn.addEventListener("click", handleDownload);
  editor.addEventListener("pointerdown", onPointerDown);
  editor.addEventListener("pointermove", onPointerMove);
  editor.addEventListener("pointerup", onPointerUp);
  editor.addEventListener("pointercancel", onPointerUp);

  setStatus("Ready. Choose images.");
});

// ---------- Upload & Detection ----------
async function handleUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  setStatus(`Loading ${files.length} image(s)...`);

  for (const file of files) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const { corners, reliable } = autoDetectCorners(img);
      pages.push({ id, img, corners, editorScale: 1, reliable });
    } catch (err) {
      console.error("Failed to load", file.name, err);
    }
  }

  renderThumbs();
  if (pages.length) activatePage(pages[pages.length - 1].id);
  updateDownloadState();
  uploadInput.value = "";
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function autoDetectCorners(img) {
  const full = { topLeftCorner: { x: 0, y: 0 }, topRightCorner: { x: img.width, y: 0 }, bottomLeftCorner: { x: 0, y: img.height }, bottomRightCorner: { x: img.width, y: img.height } };
  try {
    if (typeof cv === "undefined") return { corners: full, reliable: false };
    const mat = cv.imread(img); 
    let contour = null, pts = null;
    try {
      contour = scanner.findPaperContour(mat);
      if (contour) pts = scanner.getCornerPoints(contour);
    } finally {
      mat.delete();
      if (contour && contour.delete) contour.delete();
    }

    if (!pts || !pts.topLeftCorner) return { corners: full, reliable: false };
    const detected = { topLeftCorner: { ...pts.topLeftCorner }, topRightCorner: { ...pts.topRightCorner }, bottomLeftCorner: { ...pts.bottomLeftCorner }, bottomRightCorner: { ...pts.bottomRightCorner } };

    // Quality Check
    const minX = Math.min(detected.topLeftCorner.x, detected.bottomLeftCorner.x);
    const maxX = Math.max(detected.topRightCorner.x, detected.bottomRightCorner.x);
    const minY = Math.min(detected.topLeftCorner.y, detected.topRightCorner.y);
    const maxY = Math.max(detected.bottomLeftCorner.y, detected.bottomRightCorner.y);
    const ratio = ((maxX - minX) * (maxY - minY)) / (img.width * img.height);
    
    // Area must be between 35% and 98% of image to be considered reliable
    return { corners: detected, reliable: ratio > 0.35 && ratio < 0.98 };
  } catch (err) {
    return { corners: full, reliable: false };
  }
}

// ---------- UI & Thumbnails ----------
function renderThumbs() {
  if (!thumbsEl) return;
  thumbsEl.innerHTML = "";
  pages.forEach((page, idx) => {
    const div = document.createElement("div");
    div.className = "thumb" + (page.id === activeId ? " active" : "") + (!page.reliable ? " error" : "");
    div.innerHTML = `<img src="${page.img.src}" />`;
    
    const remove = document.createElement("button");
    remove.className = "remove"; remove.textContent = "×";
    remove.onclick = (ev) => { ev.stopPropagation(); removePage(page.id); };
    
    const caption = document.createElement("div");
    caption.className = "caption";
    caption.textContent = `Page ${idx + 1}${!page.reliable ? " (FIX)" : ""}`;

    div.appendChild(remove); div.appendChild(caption);
    div.onclick = () => activatePage(page.id);
    thumbsEl.appendChild(div);
  });
}

function activatePage(id) {
  activeId = id;
  const page = pages.find((p) => p.id === id);
  if (!page) return editorWrap.style.display = "none";

  const maxW = 900;
  const scale = Math.min(1, maxW / page.img.width);
  editor.width = Math.round(page.img.width * scale);
  editor.height = Math.round(page.img.height * scale);
  page.editorScale = scale;

  editorWrap.style.display = "block";
  renderThumbs();
  drawEditor();
}

function removePage(id) {
  const idx = pages.findIndex((p) => p.id === id);
  pages.splice(idx, 1);
  if (activeId === id) {
    activeId = pages.length ? pages[Math.max(0, idx - 1)].id : null;
    if (activeId) activatePage(activeId); else editorWrap.style.display = "none";
  } else renderThumbs();
  updateDownloadState();
}

function updateDownloadState() {
  downloadBtn.disabled = pages.length === 0;
  warningBanner.style.display = pages.some(p => !p.reliable) ? "block" : "none";
  if (pages.length === 0) setStatus("");
  else if (pages.some(p => !p.reliable)) setStatus("Fix red pages before downloading.", true);
  else setStatus(`${pages.length} page(s) ready.`);
}

// ---------- Editor Canvas ----------
function drawEditor() {
  const page = pages.find((p) => p.id === activeId);
  if (!page) return;
  ctx.clearRect(0, 0, editor.width, editor.height);
  ctx.drawImage(page.img, 0, 0, editor.width, editor.height);

  const s = page.editorScale;
  const pts = [ page.corners.topLeftCorner, page.corners.topRightCorner, page.corners.bottomRightCorner, page.corners.bottomLeftCorner ].map(p => scalePoint(p, s));

  ctx.strokeStyle = page.reliable ? "rgba(0, 140, 255, 0.9)" : "rgba(255, 0, 0, 0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath(); ctx.stroke();

  pts.forEach((p) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = page.reliable ? "rgba(0, 140, 255, 0.9)" : "rgba(255, 0, 0, 0.9)";
    ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  });
}

function scalePoint(p, s) { return { x: p.x * s, y: p.y * s }; }

function onPointerDown(ev) {
  const page = pages.find((p) => p.id === activeId);
  if (!page) return;
  const p = canvasPoint(ev);
  for (const key of Object.keys(page.corners)) {
    const cp = scalePoint(page.corners[key], page.editorScale);
    if (Math.hypot(cp.x - p.x, cp.y - p.y) <= HANDLE_RADIUS + 10) {
      dragging = key; try { editor.setPointerCapture(ev.pointerId); } catch (_) {} return;
    }
  }
}

function onPointerMove(ev) {
  if (!dragging) return;
  const page = pages.find((p) => p.id === activeId);
  const p = canvasPoint(ev);
  page.corners[dragging] = {
    x: Math.max(0, Math.min(page.img.width, p.x / page.editorScale)),
    y: Math.max(0, Math.min(page.img.height, p.y / page.editorScale)),
  };
  if (!page.reliable) { page.reliable = true; renderThumbs(); updateDownloadState(); }
  drawEditor();
}

function onPointerUp(ev) { dragging = null; }

function canvasPoint(ev) {
  const rect = editor.getBoundingClientRect();
  return { x: (ev.clientX - rect.left) * (editor.width / rect.width), y: (ev.clientY - rect.top) * (editor.height / rect.height) };
}

// ---------- High-Res PDF Generation ----------
function handleDownload() {
  if (!pages.length || pages.some(p => !p.reliable)) return;
  setStatus("Processing image math & building PDF...");

  // Use setTimeout to let the UI update before heavy synchronous processing
  setTimeout(() => {
    try {
      const mode = filterSelect.value;
      let pdf = null;

      pages.forEach((page, idx) => {
        // UPGRADE: Force extraction at exactly 2480 x 3508 pixels (A4 @ 300 DPI equivalent)
        // This makes the PDF incredibly sharp.
        const resultCanvas = scanner.extractPaper(page.img, 2480, 3508, page.corners);
        if (!resultCanvas) return;

        const filtered = applyProFilter(resultCanvas, mode);
        const dataUrl = filtered.toDataURL("image/jpeg", 0.95); // 0.95 JPEG quality

        if (!pdf) pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
        else pdf.addPage("a4", "portrait");

        // The canvas is already A4 aspect ratio, so we just map it to the full page
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        pdf.addImage(dataUrl, "JPEG", 0, 0, pageWidth, pageHeight);
      });

      if (!pdf) return setStatus("No pages could be processed.", true);

      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "scanned-document.pdf";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus(`PDF downloaded (${pages.length} pages).`);
    } catch (err) {
      console.error(err); setStatus("PDF failed. Check console.", true);
    }
  }, 50);
}

// ---------- PRO FILTERS (Adaptive Illumination & Contrast) ----------
function applyProFilter(sourceCanvas, mode) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");
  octx.drawImage(sourceCanvas, 0, 0);

  if (mode === "original") return out;

  const imageData = octx.getImageData(0, 0, w, h);
  const data = imageData.data;
  
  // 1. Calculate global average luminance
  let totalLuma = 0;
  for (let i = 0; i < data.length; i += 4) {
    totalLuma += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
  }
  const avgLuma = totalLuma / (data.length / 4);

  // 2. Apply Math per pixel
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i+1], b = data[i+2];
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;

    if (mode === "color") {
      // --- PRO COLOR SCANNER ---
      // A. "Divide" by the average to flatten shadows across the page
      // If a pixel is brighter than average, boost it to near white.
      const norm = Math.min(255, (luma / (avgLuma * 0.85)) * 255);
      
      // B. Scale colors to match the new luminance
      const scale = norm / (luma || 1);
      r = r * scale; g = g * scale; b = b * scale;

      // C. Boost saturation so the text/logos don't look washed out
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const satBoost = 1.3;
      r = gray + (r - gray) * satBoost;
      g = gray + (g - gray) * satBoost;
      b = gray + (b - gray) * satBoost;

      data[i] = Math.min(255, Math.max(0, r));
      data[i+1] = Math.min(255, Math.max(0, g));
      data[i+2] = Math.min(255, Math.max(0, b));

    } else if (mode === "gray") {
      // --- PRO GRAYSCALE ---
      // Smooth S-curve for contrast + shadow flattening
      let norm = (luma / (avgLuma * 0.9)) * 255;
      // Apply contrast curve
      norm = (norm - 128) * 1.2 + 128;
      
      const v = Math.min(255, Math.max(0, norm));
      data[i] = data[i+1] = data[i+2] = v;

    } else if (mode === "bw") {
      // --- PRO BLACK & WHITE (Adaptive Threshold) ---
      // Instead of one global threshold, we threshold relative to the average
      // If the pixel is significantly darker than the background, make it black.
      const isText = luma < (avgLuma * 0.75);
      const v = isText ? 0 : 255;
      data[i] = data[i+1] = data[i+2] = v;
    }
  }

  octx.putImageData(imageData, 0, 0);
  return out;
}
