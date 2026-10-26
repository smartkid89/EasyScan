import { jsPDF } from "jspdf";

// 'processedImageDataUrl' is the result from your scanning library
const pdf = new jsPDF({
  orientation: "portrait",
  unit: "px",
  format: "a4"
});

const pageWidth = pdf.internal.pageSize.getWidth();
const pageHeight = pdf.internal.pageSize.getHeight();

// Add the image to fill the page
pdf.addImage(processedImageDataUrl, "JPEG", 0, 0, pageWidth, pageHeight);

// Save the PDF
pdf.save("scanned-document.pdf");
