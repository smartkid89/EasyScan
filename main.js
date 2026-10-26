const { jsPDF } = window.jspdf;

let processedImageDataUrl = null;

const uploadInput = document.getElementById("upload");
const downloadBtn = document.getElementById("download");

uploadInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    // For now: use the raw image. Later you'll swap this
    // for the output of the scanning/enhancement step.
    processedImageDataUrl = event.target.result;
    downloadBtn.disabled = false;
  };
  reader.readAsDataURL(file);
});

downloadBtn.addEventListener("click", () => {
  if (!processedImageDataUrl) return;

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "px",
    format: "a4"
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  pdf.addImage(processedImageDataUrl, "JPEG", 0, 0, pageWidth, pageHeight);
  pdf.save("scanned-document.pdf");
});
