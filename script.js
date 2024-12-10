// Constants & Variables
const dropZone = document.querySelector(".drop-zone");
const uploadBtn = document.querySelector("#upload-document");
const filesContainer = document.querySelector(".files-container");
const submitBtn = document.querySelector(".submit");
const clearBtn = document.querySelector(".clear");
const keywordInput = document.querySelector("#keyword-input");
const summariesSection = document.querySelector(".summaries-section");
const customPercentageInput = document.getElementById("custom-percentage");
const percentageButtons = document.querySelectorAll(".percentage-btn");

let documents = [];
let isProcessing = false;
let currentSummaryPercentage = 50; // default 50%

// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

// File Upload Event Listeners
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  handleFileUpload(e.dataTransfer.files);
});

uploadBtn.addEventListener("change", (e) => handleFileUpload(e.target.files));

// File Processing Functions
async function handleFileUpload(files) {
  const validTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  for (let file of files) {
    if (!validTypes.includes(file.type)) {
      showNotification(`${file.name} is not a valid document type`, "error");
      continue;
    }

    if (documents.some((doc) => doc.name === file.name)) {
      showNotification(`${file.name} is already uploaded`, "warning");
      continue;
    }

    showNotification(`Processing ${file.name}...`, "info");

    try {
      const text = await processDocument(file);
      documents.push({
        name: file.name,
        text: text,
        type: file.type,
        summary: null,
      });

      updateFilesList();
      submitBtn.disabled = false;
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error);
      showNotification(`Error processing ${file.name}`, "error");
    }
  }
}

async function processDocument(file) {
  if (file.type === "application/pdf") {
    return await processPdfFile(file);
  } else {
    return await processWordFile(file);
  }
}

async function processPdfFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // Improved text extraction
      let lastY,
        text = [];
      textContent.items.forEach((item) => {
        if (lastY == item.transform[5] || !lastY) {
          text.push(item.str);
        } else {
          text.push("\n" + item.str);
        }
        lastY = item.transform[5];
      });

      fullText += text.join(" ") + "\n\n";
    }

    // Clean up the text
    return fullText
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();
  } catch (error) {
    console.error("Error processing PDF:", error);
    throw error;
  }
}

async function processWordFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error("Error processing Word file:", error);
    throw error;
  }
}

// Summary Generation Functions
async function generateSummaries() {
  if (documents.length === 0) {
    showNotification("Please upload at least one document", "warning");
    return;
  }

  if (isProcessing) {
    showNotification("Please wait, processing documents...", "warning");
    return;
  }

  isProcessing = true;
  submitBtn.disabled = true;
  showNotification("Generating summaries...", "info");

  try {
    const keywords = keywordInput.value.trim()
      ? keywordInput.value
          .toLowerCase()
          .split(",")
          .map((k) => k.trim())
      : [];

    for (let doc of documents) {
      doc.summary = await generateDocumentSummary(doc.text, keywords);
    }

    displaySummaries();
    submitBtn.disabled = false;
    showNotification("Summaries generated successfully", "success");
  } catch (error) {
    console.error("Error generating summaries:", error);
    showNotification("Error generating summaries", "error");
  } finally {
    isProcessing = false;
    submitBtn.disabled = false;
  }
}

async function generateDocumentSummary(text, keywords) {
  // Bersihkan dan persiapkan text
  text = text.replace(/\s+/g, " ").trim();
  const paragraphs = text.split(/\n\s*\n/);
  const sentences = [];

  paragraphs.forEach((paragraph) => {
    const paragraphSentences = paragraph.match(/[^.!?]+[.!?]+/g) || [];
    sentences.push(...paragraphSentences.map((s) => s.trim()));
  });

  // Hitung jumlah kalimat yang diinginkan berdasarkan persentase
  const targetSentences = Math.max(
    1,
    Math.ceil(sentences.length * (currentSummaryPercentage / 100))
  );

  // Scoring system
  const scoredSentences = sentences.map((sentence, index) => {
    const sentenceLower = sentence.toLowerCase();
    let score = 0;

    // Posisi scoring
    if (index === 0) score += 3;
    if (index === sentences.length - 1) score += 2;
    if (paragraphs.some((p) => p.startsWith(sentence))) score += 2;

    // Keyword scoring
    if (keywords.length > 0) {
      keywords.forEach((keyword) => {
        if (sentenceLower.includes(keyword)) {
          score += 3;
        }
      });
    }

    // Important phrases scoring
    const importantPhrases = [
      "penting",
      "signifikan",
      "utama",
      "kunci",
      "concluding",
      "concluded",
      "kesimpulan",
      "hasil",
      "therefore",
      "thus",
      "hence",
      "sehingga",
      "mengakibatkan",
      "menyebabkan",
      "berdampak",
      "menghasilkan",
    ];

    importantPhrases.forEach((phrase) => {
      if (sentenceLower.includes(phrase)) {
        score += 2;
      }
    });

    // Length scoring
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount > 5 && wordCount < 30) score += 1;

    // Special content scoring
    if (
      sentenceLower.includes("%") ||
      /\d+/.test(sentence) ||
      sentence.includes("Rp") ||
      /\d+,\d+/.test(sentence)
    ) {
      score += 2;
    }

    return {
      text: sentence,
      score: score,
      position: index,
      paragraph: Math.floor(index / 3),
    };
  });

  // Sort and select sentences
  scoredSentences.sort((a, b) => b.score - a.score);
  const selectedSentences = scoredSentences
    .slice(0, targetSentences)
    .sort((a, b) => a.position - b.position);

  // Organize into paragraphs
  const organizedSummary = [];
  let currentParagraph = [];
  let lastParagraphIndex = -1;

  selectedSentences.forEach((sentence) => {
    if (sentence.paragraph !== lastParagraphIndex) {
      if (currentParagraph.length > 0) {
        organizedSummary.push(currentParagraph.join(" "));
        currentParagraph = [];
      }
      lastParagraphIndex = sentence.paragraph;
    }
    currentParagraph.push(sentence.text);
  });

  if (currentParagraph.length > 0) {
    organizedSummary.push(currentParagraph.join(" "));
  }

  return {
    summary: organizedSummary.join("\n\n"),
    originalLength: sentences.length,
    summaryLength: selectedSentences.length,
    percentage: currentSummaryPercentage,
  };
}

// UI Update Functions
function updateFilesList() {
  filesContainer.innerHTML = documents
    .map(
      (doc, index) => `
        <div class="file-item">
            <span class="file-name">${doc.name}</span>
            <button class="remove-file" onclick="removeDocument(${index})">×</button>
        </div>
    `
    )
    .join("");
}

function displaySummaries() {
  summariesSection.innerHTML = documents
    .map((doc) => {
      const summaryInfo = doc.summary;
      return `
            <div class="summary-container">
                <h3>${doc.name}</h3>
                <div class="summary-info">
                    <p><strong>Summary Length:</strong> ${
                      summaryInfo.percentage
                    }% of original</p>
                    <p><strong>Sentences:</strong> ${
                      summaryInfo.summaryLength
                    } of ${summaryInfo.originalLength}</p>
                    ${
                      keywordInput.value
                        ? `<p><strong>Keywords:</strong> ${keywordInput.value}</p>`
                        : ""
                    }
                </div>
                <div class="summary-content">
                    ${summaryInfo.summary || "No relevant content found."}
                </div>
                <div class="summary-actions">
                    <button onclick="copyToClipboard('${
                      doc.name
                    }')">Copy</button>
                    <button onclick="downloadSummary('${
                      doc.name
                    }')">Download</button>
                </div>
            </div>
        `;
    })
    .join("");
}

// Utility Functions
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.textContent = message;
  notification.className = `notification ${type}`;
  notification.style.position = "fixed";
  notification.style.top = "20px";
  notification.style.left = "50%";
  notification.style.transform = "translateX(-50%)";
  notification.style.padding = "10px 20px";
  notification.style.borderRadius = "5px";
  notification.style.color = "white";
  notification.style.fontWeight = "bold";
  notification.style.zIndex = "1000";

  switch (type) {
    case "success":
      notification.style.backgroundColor = "#4CAF50";
      break;
    case "error":
      notification.style.backgroundColor = "#f44336";
      break;
    case "warning":
      notification.style.backgroundColor = "#ff9800";
      break;
    default:
      notification.style.backgroundColor = "#2196F3";
  }

  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transition = "opacity 0.5s ease";
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}

function removeDocument(index) {
  documents.splice(index, 1);
  updateFilesList();
  if (documents.length === 0) {
    submitBtn.disabled = true;
    summariesSection.innerHTML = "";
  }
  showNotification("Document removed", "info");
}

function copyToClipboard(docName) {
  const doc = documents.find((d) => d.name === docName);
  if (!doc || !doc.summary) {
    showNotification("No content to copy", "warning");
    return;
  }

  navigator.clipboard.writeText(doc.summary.summary).then(
    () => showNotification("Summary copied to clipboard!", "success"),
    () => showNotification("Failed to copy summary", "error")
  );
}

function downloadSummary(docName) {
  const doc = documents.find((d) => d.name === docName);
  if (!doc || !doc.summary) {
    showNotification("No content to download", "warning");
    return;
  }

  const blob = new Blob([doc.summary.summary], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `summary_${doc.name}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification("Summary downloaded", "success");
}

// Event Listeners for Percentage Controls
percentageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    percentageButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSummaryPercentage = parseInt(btn.dataset.percentage);
    customPercentageInput.value = currentSummaryPercentage;
    if (documents.some((doc) => doc.summary)) {
      generateSummaries();
    }
  });
});

customPercentageInput.addEventListener("change", () => {
  let value = parseInt(customPercentageInput.value);
  value = Math.min(100, Math.max(1, value));
  currentSummaryPercentage = value;
  customPercentageInput.value = value;
  percentageButtons.forEach((btn) => btn.classList.remove("active"));
  if (documents.some((doc) => doc.summary)) {
    generateSummaries();
  }
});

// Main Action Buttons
submitBtn.addEventListener("click", generateSummaries);

clearBtn.addEventListener("click", () => {
  documents = [];
  updateFilesList();
  summariesSection.innerHTML = "";
  keywordInput.value = "";
  submitBtn.disabled = true;
  showNotification("All content cleared", "info");
});
