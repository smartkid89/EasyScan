const { jsPDF } = window.jspdf;

let processedImageDataUrl = null;
let scanner = null;

const uploadInput = document.getElementById("upload");
const downloadBtn = document.getElementById("download");
const filterSelect = document.getElementById("filter");
const statusEl = document.getElementById("status");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#c00" : "#555";
}

// Wait for OpenCV + jscanify to be fully ready
window.addEventListener("load", () => {
  if (window.jscanify) {
    scanner = new window.jscanify();
    setStatus("Ready. Choose an image.");
  } else {
    console.error("jscanify failed to load.");
    setStatus("jscanify failed to load. Check the console.", true);
    return;
  }

  uploadInput.addEventListener("change", handleUpload);
  downloadBtn.addEventListener("click", handleDownload);
});

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  setStatus("Processing image...");
  processedImageDataUrl = null;
  downloadBtn.disabled = true;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      try {
        const resultCanvas = scanner.extractPaper(img, 1200, 1600);

        if (!resultCanvas) {
          setStatus("No paper detected. Try a photo with the document on a contrasting background.", true);
          return;
        }

        const mode = filterSelect.value || "gray";
        const filteredCanvas = applyScanFilter(resultCanvas, mode);

        processedImageDataUrl = filteredCanvas.toDataURL("image/jpeg", 0.92);

        console.log("Data URL length:", processedImageDataUrl.length);
        downloadBtn.disabled = false;
        setStatus("Done. Click Download PDF.");
      } catch (err) {
        console.error("Scanning failed:", err);
        setStatus("Scanning failed. Check the console for details.", true);
      }
    };
    img.onerror = () => {
      setStatus("Could not load the image file.", true);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Apply a scanner-like filter to a canvas.
 * mode: "original" | "gray" | "bw"
 */
function applyScanFilter(sourceCanvas, mode = "gray") {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0);

  if (mode === "original") return out;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let totalLuma = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

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

  ctx.putImageData(imageData, 0, 0);
  return out;
}

function handleDownload() {
  console.log("Download clicked. Data URL exists:", !!processedImageDataUrl);

  if (!processedImageDataUrl) {
    setStatus("No processed image to download. Upload an image first.", true);
    return;
  }

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

    // Blob-based download (more reliable than pdf.save across browsers)
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
    console.error("PDF generation failed:", err);
    setStatus("PDF generation failed. Check the console.", true);
  }
}
