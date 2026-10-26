const { jsPDF } = window.jspdf;

let scanner = null;
let sourceImage = null;          // loaded HTMLImageElement
let processedImageDataUrl = null;
let corners = null;              // {topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner}
let dragging = null;             // key of corner currently being dragged

const uploadInput = document.getElementById("upload");
const downloadBtn = document.getElementById("download");
const extractBtn = document.getElementById("extract");
const filterSelect = document.getElementById("filter");
const statusEl = document.getElementById("status");
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
  extractBtn.addEventListener("click", handleExtract);
  downloadBtn.addEventListener("click", handleDownload);

  editor.addEventListener("pointerdown", onPointerDown);
  editor.addEventListener("pointermove", onPointerMove);
  editor.addEventListener("pointerup", onPointerUp);
  editor.addEventListener("pointercancel", onPointerUp);

  setStatus("Ready. Choose an image.");
});

// ---------- Upload + preview + auto corners ----------
function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  setStatus("Loading image...");
  processedImageDataUrl = null;
  downloadBtn.disabled = true;
  extractBtn.disabled = true;
  corners = null;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;

      const maxW = 900;
      const scale = Math.min(1, maxW / img.width);
      editor.width = Math.round(img.width * scale);
      editor.height = Math.round(img.height * scale);
      editorWrap.style.display = "block";
      ctx.drawImage(img, 0, 0, editor.width, editor.height);

      // Suggest corners via jscanify, fall back to full-image corners
      try {
        const contour = scanner.findPaperContour(img);
        if (contour) {
          const pts = scanner.getCornerPoints(contour);
          if (pts) {
            const s = editor.width / img.width;
            corners = {
              topLeftCorner:     scalePoint(pts.topLeftCorner, s),
              topRightCorner:    scalePoint(pts.topRightCorner, s),
              bottomLeftCorner:  scalePoint(pts.bottomLeftCorner, s),
              bottomRightCorner: scalePoint(pts.bottomRightCorner, s),
            };
          }
        }
      } catch (err) {
        console.warn("Auto-detection failed:", err);
      }

      if (!corners) {
        corners = {
          topLeftCorner:     { x: 0, y: 0 },
          topRightCorner:    { x: editor.width, y: 0 },
          bottomLeftCorner:  { x: 0, y: editor.height },
          bottomRightCorner: { x: editor.width, y: editor.height },
        };
        setStatus("Auto-detect failed — using full image corners. Drag to adjust.");
      } else {
        setStatus("Drag the corners if needed, then click Extract.");
      }

      drawEditor();
      extractBtn.disabled = false;
    };
    img.onerror = () => setStatus("Could not load the image.", true);
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function scalePoint(p, s) {
  return { x: p.x * s, y: p.y * s };
}

// ---------- Editor drawing ----------
function drawEditor() {
  if (!sourceImage) return;
  ctx.clearRect(0, 0, editor.width, editor.height);
  ctx.drawImage(sourceImage, 0, 0, editor.width, editor.height);

  if (!corners) return;

  const pts = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
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

// ---------- Drag handling ----------
function onPointerDown(ev) {
  if (!corners) return;
  const p = canvasPoint(ev);
  for (const key of Object.keys(corners)) {
    const cp = corners[key];
    if (Math.hypot(cp.x - p.x, cp.y - p.y) <= HANDLE_RADIUS + 6) {
      dragging = key;
      try { editor.setPointerCapture(ev.pointerId); } catch (_) {}
      return;
    }
  }
}

function onPointerMove(ev) {
  if (!dragging) return;
  const p = canvasPoint(ev);
  corners[dragging] = {
    x: Math.max(0, Math.min(editor.width, p.x)),
    y: Math.max(0, Math.min(editor.height, p.y)),
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

// ---------- Extract using the user's corners ----------
function handleExtract() {
  if (!sourceImage || !corners) return;

  setStatus("Extracting...");
  processedImageDataUrl = null;
  downloadBtn.disabled = true;

  try {
    const s = sourceImage.width / editor.width;
    const customCorners = {
      topLeftCorner:     scalePoint(corners.topLeftCorner, s),
      topRightCorner:    scalePoint(corners.topRightCorner, s),
      bottomLeftCorner:  scalePoint(corners.bottomLeftCorner, s),
      bottomRightCorner: scalePoint(corners.bottomRightCorner, s),
    };

    const resultCanvas = scanner.extractPaper(
      sourceImage,
      sourceImage.width,
      sourceImage.height,
      customCorners
    );

    if (!resultCanvas) {
      setStatus("Extraction failed.", true);
      return;
    }

    const mode = filterSelect.value || "gray";
    const filteredCanvas = applyScanFilter(resultCanvas, mode);
    processedImageDataUrl = filteredCanvas.toDataURL("image/jpeg", 0.92);

    downloadBtn.disabled = false;
    setStatus("Extracted. Click Download PDF.");
  } catch (err) {
    console.error(err);
    setStatus("Extraction failed. Check the console.", true);
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

// ---------- PDF download ----------
function handleDownload() {
  if (!processedImageDataUrl) return;

  try {
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "px",
      format: "a4",
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgProps = pdf.getImageProperties(processedImageDataUrl);
    const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
    const w = imgProps.width * ratio;
    const h = imgProps.height * ratio;

    pdf.addImage(processedImageDataUrl, "JPEG", 0, 0, w, h);

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scanned-document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus("PDF downloaded.");
  } catch (err) {
    console.error(err);
    setStatus("PDF generation failed. Check console.", true);
  }
}
