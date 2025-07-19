const DocumentIntelligence = require("@azure-rest/ai-document-intelligence").default;
const { isUnexpected } = require("@azure-rest/ai-document-intelligence");
const { AzureKeyCredential } = require("@azure/core-auth");
const fs = require("fs");
const path = require("path");
const { encode } = require("gpt-3-encoder");

const key = process.env.SECRET_AZURE_DOCUMENT_INTELLIGENCE_KEY;
const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;

if (!key || !endpoint) {
  throw new Error("Missing required environment variables: SECRET_AZURE_DOCUMENT_INTELLIGENCE_KEY and AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
}

const MAX_TOKENS_PER_CHUNK = 7000;
const SOURCE_DATA_DIR = "./sourceData";
const OUTPUT_DIR = "./src/indexers/data";

function splitBySentences(text) {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
}

/**
 * Get all PDF files from source directory
 */
function getPDFFiles(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = fs.readdirSync(sourceDir)
    .filter(file => path.extname(file).toLowerCase() === '.pdf')
    .map(file => path.join(sourceDir, file));

  if (files.length === 0) {
    console.warn(`No PDF files found in ${sourceDir}`);
    return [];
  }

  console.log(`Found ${files.length} PDF files to process:`);
  files.forEach(file => console.log(`  - ${path.basename(file)}`));

  return files;
}

/**
 * Clean up old JSON files before processing
 */
function cleanupOldFiles(outputDir) {
  if (!fs.existsSync(outputDir)) {
    return;
  }

  const jsonFiles = fs.readdirSync(outputDir)
    .filter(file => file.endsWith('.json'));

  if (jsonFiles.length > 0) {
    console.log(`Cleaning up ${jsonFiles.length} existing JSON files...`);
    jsonFiles.forEach(file => {
      fs.unlinkSync(path.join(outputDir, file));
    });
    console.log('✅ Cleanup complete');
  }
}

/**
 * Converts a PDF document into multiple JSON chunk files for Azure AI Search.
 * @param {string} inputFilePath - Path to the input PDF file
 * @param {string} outputDir - Directory to output JSON chunk files
 * @returns {Promise<number>} - Number of chunks created
 */
async function convertPdfToSearchChunks(inputFilePath, outputDir) {
  try {
    const fileName = path.basename(inputFilePath, '.pdf');
    console.log(`\nProcessing: ${fileName}.pdf`);

    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`Input file does not exist: ${inputFilePath}`);
    }

    const client = DocumentIntelligence(endpoint, new AzureKeyCredential(key));
    const pdfBuffer = fs.readFileSync(inputFilePath);
    const base64Data = pdfBuffer.toString('base64');
    const sourceName = path.basename(inputFilePath);
    const baseFileName = path.parse(sourceName).name;

    const initialResponse = await client
      .path("/documentModels/{modelId}:analyze", "prebuilt-layout")
      .post({
        contentType: "application/json",
        body: { base64Source: base64Data },
      });

    if (isUnexpected(initialResponse)) {
      throw initialResponse.body.error;
    }

    const operationLocation = initialResponse.headers["operation-location"];
    const timeout = ms => new Promise(res => setTimeout(res, ms));

    let result;
    while (true) {
      const pollResponse = await client.pathUnchecked(operationLocation).get();
      if (pollResponse.status !== "200") throw new Error(`Polling failed: ${pollResponse.statusText}`);
      const { status } = pollResponse.body;
      if (status === "succeeded") {
        result = pollResponse.body;
        break;
      } else if (status === "failed") throw new Error("Analysis failed.");
      await timeout(2000);
    }

    const analyzeResult = result.analyzeResult;
    const chunks = [];

    if (!analyzeResult?.paragraphs) throw new Error("No paragraphs found in the analysis result.");

    let currentChunk = { id: 1, title: "", content: "", page: null, source: sourceName };
    let tokenCount = 0;

    for (const para of analyzeResult.paragraphs) {
      const content = para.content?.trim();
      const page = para.boundingRegions?.[0]?.pageNumber;
      if (!content) continue;

      const paragraphTokens = encode(content).length;

      switch (para.role) {
        case "title":
        case "sectionHeading":
          if (currentChunk.content.length > 0) {
            chunks.push({ ...currentChunk });
            currentChunk = { id: currentChunk.id + 1, title: "", content: "", page: page || null, source: sourceName };
            tokenCount = 0;
          }
          currentChunk.title = content;
          currentChunk.page = page || currentChunk.page;
          break;
        default:
          if (paragraphTokens <= MAX_TOKENS_PER_CHUNK - tokenCount) {
            currentChunk.content += (currentChunk.content ? "\n" : "") + content;
            tokenCount += paragraphTokens;
            currentChunk.page = page || currentChunk.page;
          } else {
            const sentences = splitBySentences(content);
            let sentenceBuffer = "";
            let bufferTokens = 0;
            for (const sentence of sentences) {
              const sentenceTokens = encode(sentence).length;
              if (bufferTokens + sentenceTokens > MAX_TOKENS_PER_CHUNK) {
                chunks.push({ ...currentChunk, content: sentenceBuffer.trim() });
                currentChunk.id++;
                sentenceBuffer = sentence;
                bufferTokens = sentenceTokens;
              } else {
                sentenceBuffer += (sentenceBuffer ? " " : "") + sentence;
                bufferTokens += sentenceTokens;
              }
            }
            if (sentenceBuffer.trim()) {
              chunks.push({ ...currentChunk, content: sentenceBuffer.trim() });
              currentChunk.id++;
            }
            currentChunk = { id: currentChunk.id, title: "", content: "", page: page || null, source: sourceName };
            tokenCount = 0;
          }
          break;
      }
    }
    if (currentChunk.content.length > 0) chunks.push({ ...currentChunk });

    if (analyzeResult.tables) {
      analyzeResult.tables.forEach((table, i) => {
        chunks.push({
          id: chunks.length + 1,
          title: `Table ${i + 1}`,
          content: convertTableToMarkdown(table),
          page: table.boundingRegions?.[0]?.pageNumber || null,
          source: sourceName
        });
      });
    }

    const flatDir = path.resolve(outputDir);
    if (!fs.existsSync(flatDir)) {
      fs.mkdirSync(flatDir, { recursive: true });
    }

    let savedChunks = 0;
    chunks.forEach(chunk => {
      try {
        const chunkPath = path.join(flatDir, `${baseFileName}_chunk_${chunk.id}.json`);
        fs.writeFileSync(chunkPath, JSON.stringify(chunk, null, 2), 'utf8');
        savedChunks++;
      } catch (error) {
        console.error(`  ❌ Failed to save chunk ${chunk.id}: ${error.message}`);
      }
    });

    console.log(`  ✅ Saved ${savedChunks}/${chunks.length} chunks`);
    return savedChunks;

  } catch (error) {
    console.error(`  ❌ Error processing ${path.basename(inputFilePath)}: ${error.message}`);
    return 0;
  }
}

function convertTableToMarkdown(table) {
  if (!table.cells || table.cells.length === 0) return "";

  const maxRow = Math.max(...table.cells.map(cell => cell.rowIndex));
  const maxCol = Math.max(...table.cells.map(cell => cell.columnIndex));
  const grid = Array(maxRow + 1).fill().map(() => Array(maxCol + 1).fill(""));

  table.cells.forEach(cell => {
    const content = cell.content?.trim().replace(/\n/g, ' ').replace(/\|/g, '\\|') || "";
    grid[cell.rowIndex][cell.columnIndex] = content;
  });

  let markdown = "";
  grid.forEach((row, index) => {
    markdown += "| " + row.join(" | ") + " |\n";
    if (index === 0) markdown += "|" + " --- |".repeat(row.length) + "\n";
  });
  return markdown;
}

/**
 * Process all PDFs in the source directory
 */
async function parseAllPDFs() {
  console.log('🚀 Starting PDF processing...\n');

  try {
    // Get all PDF files
    const pdfFiles = getPDFFiles(SOURCE_DATA_DIR);
    
    if (pdfFiles.length === 0) {
      console.log('No PDF files to process. Exiting.');
      return;
    }

    // Clean up old files
    cleanupOldFiles(OUTPUT_DIR);

    // Process all PDFs
    let totalChunks = 0;
    let processedFiles = 0;

    for (const pdfFile of pdfFiles) {
      const chunksCreated = await convertPdfToSearchChunks(pdfFile, OUTPUT_DIR);
      if (chunksCreated > 0) {
        totalChunks += chunksCreated;
        processedFiles++;
      }
    }

    // Summary
    console.log('\n📊 PROCESSING SUMMARY:');
    console.log(`  PDF files found: ${pdfFiles.length}`);
    console.log(`  Successfully processed: ${processedFiles}`);
    console.log(`  Failed to process: ${pdfFiles.length - processedFiles}`);
    console.log(`  Total chunks created: ${totalChunks}`);
    console.log(`  Output directory: ${OUTPUT_DIR}`);

    if (totalChunks > 0) {
      console.log('\n✅ PDF processing completed successfully!');
      console.log('You can now run the indexer to upload these chunks to Azure AI Search.');
    }

  } catch (error) {
    console.error('❌ Error during PDF processing:', error.message);
    process.exit(1);
  }
}

async function main() {
  await parseAllPDFs();
}

module.exports = { convertPdfToSearchChunks, parseAllPDFs };

if (require.main === module) {
  main().catch((error) => {
    console.error("An error occurred:", error);
    process.exit(1);
  });
}
