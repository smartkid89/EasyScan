const { jsPDF } = window.jspdf;

let processedImageDataUrl = null;
let scanner = null;

const uploadInput = document.getElementById("upload");
const downloadBtn = document.getElementById("download");

// Wait for OpenCV + jscanify to be fully ready
window.addEventListener("load", () => {
  // jscanify is exposed globally by its script tag
  if (window.jscanify) {
    scanner = new window.jscanify();
  } else {
    console.error("jscanify failed to load.");
    return;
  }

  uploadInput.addEventListener("change", handleUpload);
});

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      try {
        // extractPaper(image, width, height)
        // You can adjust these dimensions; they control the output resolution
        const resultCanvas = scanner.extractPaper(img, 1200, 1600);

        if (!resultCanvas) {
          alert("No paper detected. Try a photo with the document on a contrasting background.");
          return;
        }

        // Convert the scanned canvas to a data URL for jsPDF
        processedImageDataUrl = resultCanvas.toDataURL("image/jpeg", 0.92);
        downloadBtn.disabled = false;
        console.log("Paper extracted successfully.");
      } catch (err) {
        console.error("Scanning failed:", err);
        alert("Scanning failed. Check the console for details.");
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

downloadBtn.addEventListener("click", () => {
  if (!processedImageDataUrl) return;

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "px",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Fit image to page while keeping aspect ratio (optional, but looks better)
  const imgProps = pdf.getImageProperties(processedImageDataUrl);
  const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
  const w = imgProps.width * ratio;
  const h = imgProps.height * ratio;

  pdf.addImage(processedImageDataUrl, "JPEG", 0, 0, w, h);
  pdf.save("scanned-document.pdf");
});
