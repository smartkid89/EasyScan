function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      try {
        const resultCanvas = scanner.extractPaper(img, 1200, 1600);

        if (!resultCanvas) {
          alert("No paper detected. Try a photo with the document on a contrasting background.");
          return;
        }

        // 🔑 Apply the "scanned" filter here
        const filteredCanvas = applyScanFilter(resultCanvas, "bw"); // try "gray" or "bw"

        processedImageDataUrl = filteredCanvas.toDataURL("image/jpeg", 0.92);
        downloadBtn.disabled = false;
      } catch (err) {
        console.error("Scanning failed:", err);
        alert("Scanning failed. Check the console for details.");
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Apply a scanner-like filter to a canvas.
 * mode: "original" | "gray" | "bw"
 */
function applyScanFilter(sourceCanvas, mode = "bw") {
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

  // Optional: compute average brightness to auto-tune threshold
  let totalLuma = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Luminance (perceptual)
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    totalLuma += luma;

    if (mode === "gray") {
      // Boost contrast around mid-gray for a cleaner "scan" look
      const boosted = Math.min(255, Math.max(0, (luma - 128) * 1.4 + 128 + 30));
      data[i] = data[i + 1] = data[i + 2] = boosted;
    } else if (mode === "bw") {
      // Store luma first, threshold in second pass
      data[i] = data[i + 1] = data[i + 2] = luma;
    }
  }

  if (mode === "bw") {
    // Second pass: threshold to pure black/white
    const avg = totalLuma / (data.length / 4);
    // Slightly above average biases toward white background
    const threshold = Math.min(200, Math.max(120, avg * 0.95));

    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}
