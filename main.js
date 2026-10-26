const { jsPDF } = window.jspdf;

let scanner = null;

const pages = [];       // { id, img, corners, editorScale }
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

const HANDLE_RADIUS = 10;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#c00" : "#555";
}

window.addEventListener("load", () => {
  if (!window.jscanify) {
    setStatus("jscanify failed to load. Check the console.", true);
    return;
  }
  scanner = new window.jscanify();

  uploadInput.addEventListener("change", handleUpload);
  downloadBtn.addEventListener("click", handleDownload);

  editor.addEventListener("pointerdown", onPointerDown);
  editor.addEventListener("pointermove", onPointerMove);
  editor.addEventListener("pointerup", onPointerUp);
  editor.addEventListener("pointercancel", onPointerUp);

  setStatus("Ready. Choose one or more images.");
});

// ---------- Upload multiple files ----------
async function handleUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  setStatus(`Loading ${files.length} image(s)...`);

  for (const file of files) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const corners = autoDetectCorners(img);
      pages.push({ id, img, corners, editorScale: 1 });
    } catch (err) {
      console.error("Failed to load", file.name, err);
    }
  }

  renderThumbs();

  if (pages.length) {
    activatePage(pages[pages.length - 1].id);
  }

  downloadBtn.disabled = pages.length === 0;
  setStatus(`${pages.length} page(s) loaded. Click a thumbnail to edit its corners.`);
  uploadInput.value = "";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---------- Auto-detect corners (fixed: use cv.Mat) ----------
function autoDetectCorners(img) {
  const full = {
    topLeftCorner:     { x: 0, y: 0 },
    topRightCorner:    { x: img.width, y: 0 },
    bottomLeftCorner:  { x: 0, y: img.height },
    bottomRightCorner: { x: img.width, y: img.height },
  };

  try {
    if (typeof cv === "undefined") return full;

    const mat = cv.imread(img);   // HTMLImageElement → cv.Mat
    let contour = null;
    let pts = null;
    try {
      contour = scanner.findPaperContour(mat);
      if (contour) pts = scanner.getCornerPoints(contour);
    } finally {
      mat.delete();
      if (contour && contour.delete) contour.delete();
    }

    if (!pts || !pts.topLeftCorner) return full;

    return {
      topLeftCorner:     { ...pts.topLeftCorner },
      topRightCorner:    { ...pts.topRightCorner },
      bottomLeftCorner:  { ...pts.bottomLeftCorner },
      bottomRightCorner: { ...pts.bottomRightCorner },
    };
  } catch (err) {
    console.warn("Auto-detect failed:", err);
    return full;
  }
}

// ---------- Thumbnails ----------
function renderThumbs() {
  if (!thumbsEl) {
    console.warn("#thumbs element not found in HTML.");
    return;
  }
  thumbsEl.innerHTML = "";

  pages.forEach((page, idx) => {
    const div = document.createElement("div");
    div.className = "thumb" + (page.id === activeId ? " active" : "");

    const imgEl = document.createElement("img");
    imgEl.src = page.img.src;
    div.appendChild(imgEl);

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Remove this page";
    remove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removePage(page.id);
    });
    div.appendChild(remove);

    const caption = document.createElement("div");
    caption.className = "caption";
    caption.textContent = `Page ${idx + 1}`;
    div.appendChild(caption);

    div.addEventListener("click", () => activatePage(page.id));
    thumbsEl.appendChild(div);
  });
}

function activatePage(id) {
  activeId = id;
  const page = pages.find((p) => p.id === id);
  if (!page) {
    editorWrap.style.display = "none";
    return;
  }

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
  if (idx === -1) return;
  pages.splice(idx, 1);

  if (activeId === id) {
    activeId = pages.length ? pages[Math.max(0, idx - 1)].id : null;
    if (activeId) activatePage(activeId);
    else editorWrap.style.display = "none";
  } else {
    renderThumbs();
  }

  downloadBtn.disabled = pages.length === 0;
  setStatus(`${pages.length} page(s).`);
}

// ---------- Editor ----------
function drawEditor() {
  const page = pages.find((p) => p.id === activeId);
  if (!page) return;

  ctx.clearRect(0, 0, editor.width, editor.height);
  ctx.drawImage(page.img, 0, 0, editor.width, editor.height);

  const s = page.editorScale;
  const pts = [
    scalePoint(page.corners.topLeftCorner, s),
    scalePoint(page.corners.topRightCorner, s),
    scalePoint(page.corners.bottomRightCorner, s),
    scalePoint(page.corners.bottomLeftCorner, s),
  ];

  ctx.strokeStyle = "rgba(0, 140, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();

  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 140, 255, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function scalePoint(p, s) {
  return { x: p.x * s, y: p.y * s };
}

// ---------- Drag handling ----------
function onPointerDown(ev) {
  const page = pages.find((p) => p.id === activeId);
  if (!page) return;

  const p = canvasPoint(ev);
  const s = page.editorScale;

  for (const key of Object.keys(page.corners)) {
    const cp = scalePoint(page.corners[key], s);
    if (Math.hypot(cp.x - p.x, cp.y - p.y) <= HANDLE_RADIUS + 6) {
      dragging = key;
      try { editor.setPointerCapture(ev.pointerId); } catch (_) {}
      return;
    }
  }
}

function onPointerMove(ev) {
  if (!dragging) return;
  const page = pages.find((p) => p.id === activeId);
  if (!page) return;

  const p = canvasPoint(ev);
  const s = page.editorScale;

  page.corners[dragging] = {
    x: Math.max(0, Math.min(page.img.width,  p.x / s)),
    y: Math.max(0, Math.min(page.img.height, p.y / s)),
  };
  drawEditor();
}

function onPointerUp(ev) {
  if (dragging) {
    try { editor.releasePointerCapture(ev.pointerId); } catch (_) {}
  }
  dragging = null;
}

function canvasPoint(ev) {
  const rect = editor.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * (editor.width / rect.width),
    y: (ev.clientY - rect.top)  * (editor.height / rect.height),
  };
}

// ---------- Multi-page PDF ----------
function handleDownload() {
  if (!pages.length) return;

  setStatus("Building PDF...");

  try {
    const mode = filterSelect.value || "gray";
    let pdf = null;

    pages.forEach((page, idx) => {
      const resultCanvas = scanner.extractPaper(
        page.img,
        page.img.width,
        page.img.height,
        page.corners
      );

      if (!resultCanvas) {
        console.warn(`Page ${idx + 1}: extraction returned null, skipping.`);
        return;
      }

      const filtered = applyScanFilter(resultCanvas, mode);
      const dataUrl = filtered.toDataURL("image/jpeg", 0.92);

      if (!pdf) {
        pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
      } else {
        pdf.addPage("a4", "portrait");
      }

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const props = pdf.getImageProperties(dataUrl);
      const ratio = Math.min(pageWidth / props.width, pageHeight / props.height);
      const w = props.width * ratio;
      const h = props.height * ratio;
      const x = (pageWidth - w) / 2;
      const y = (pageHeight - h) / 2;

      pdf.addImage(dataUrl, "JPEG", x, y, w, h);
    });

    if (!pdf) {
      setStatus("No pages could be processed.", true);
      return;
    }

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scanned-document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus(`PDF downloaded (${pages.length} page(s)).`);
  } catch (err) {
    console.error(err);
    setStatus("PDF generation failed. Check the console.", true);
  }
}

// ---------- Scan filter ----------
function applyScanFilter(sourceCanvas, mode = "gray") {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  octx.drawImage(sourceCanvas, 0, 0);

  if (mode === "original") return out;

  const imageData = octx.getImageData(0, 0, w, h);
  const data = imageData.data;
  let totalLuma = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    totalLuma += luma;
    if (mode === "gray") {
      const boosted = Math.min(255, Math.max(0, (luma - 128) * 1.4 + 128 + 30));
      data[i] = data[i + 1] = data[i + 2] = boosted;
    } else if (mode === "bw") {
      data[i] = data[i + 1] = data[i + 2] = luma;
    }
  }

  if (mode === "bw") {
    const avg = totalLuma / (data.length / 4);
    const threshold = Math.min(200, Math.max(120, avg * 0.95));
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  octx.putImageData(imageData, 0, 0);
  return out;
}
