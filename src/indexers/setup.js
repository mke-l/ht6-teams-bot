const { AzureKeyCredential, SearchClient, SearchIndexClient } = require("@azure/search-documents");
const { createIndexIfNotExists, delay, upsertDocuments, getEmbeddingVector } = require("./utils");
const config = require("../config");
const path = require("path");
const fs = require("fs");

const searchApiKey = process.argv[2];
if (!searchApiKey) {
  throw new Error("Missing input Azure AI Search Key");
}
const azureOpenAIKey = process.argv[3];
if (!azureOpenAIKey) {
  throw new Error("Missing input Azure OpenAI Key");
}
process.env.SECRET_AZURE_OPENAI_API_KEY = azureOpenAIKey;

/**
 * Sanitize document ID to only contain allowed characters for Azure AI Search
 * Allowed: letters, digits, underscore (_), dash (-), or equal sign (=)
 */
function sanitizeDocumentId(id) {
    return id
        .replace(/[^a-zA-Z0-9_\-=]/g, '_') // Replace invalid chars with underscore
        .replace(/_+/g, '_') // Replace multiple underscores with single underscore
        .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
}

/**
 *  Main function that creates the index and upserts the documents.
 */
async function main() {
    const index = config.indexName;

    if (
        !process.env.AZURE_SEARCH_ENDPOINT ||
        !process.env.AZURE_OPENAI_ENDPOINT ||
        !process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME
    ) {
        throw new Error(
            "Missing environment variables - please check that AZURE_SEARCH_ENDPOINT, AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME are set."
        );
    }

    const searchApiEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const credentials = new AzureKeyCredential(searchApiKey);

    const searchIndexClient = new SearchIndexClient(searchApiEndpoint, credentials);
    await createIndexIfNotExists(searchIndexClient, index);
    await delay(5000); // Increased delay after index creation/recreation

    const searchClient = new SearchClient(searchApiEndpoint, index, credentials);

    const filePath = path.join(__dirname, "./data");
    const files = fs.readdirSync(filePath).filter(file => file.endsWith('.json'));
    
    const BATCH_SIZE = 20;
    let processedCount = 0;
    let uploadedCount = 0;
    
    console.log(`Processing ${files.length} JSON files...`);
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchData = [];
        
        for (const file of batch) {
            try {
                const fileContent = fs.readFileSync(path.join(filePath, file), "utf-8");
                const jsonData = JSON.parse(fileContent);
                
                const sourceBaseName = path.parse(jsonData.source || file).name;
                const rawDocId = `${sourceBaseName}_chunk_${jsonData.id}`;
                const uniqueDocId = sanitizeDocumentId(rawDocId); // Sanitize the document ID
                
                // Clean content without embedding page/source info
                const searchableContent = jsonData.content;
                
                batchData.push({
                    docId: uniqueDocId,
                    docTitle: jsonData.title || file,
                    description: searchableContent,
                    descriptionVector: await getEmbeddingVector(searchableContent),
                    pageNumber: parseInt(jsonData.page) || 0, // Convert to integer
                    sourceDocument: jsonData.source || file // Keep as string
                });
                
                processedCount++;
            } catch (error) {
                console.error(`❌ Error processing ${file}: ${error.message}`);
                continue;
            }
        }
        
        if (batchData.length > 0) {
            try {
                await upsertDocuments(searchClient, batchData);
                uploadedCount += batchData.length;
                console.log(`Uploaded batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} of ${Math.ceil(files.length / BATCH_SIZE)} (${uploadedCount}/${files.length} total)`);
            } catch (uploadError) {
                console.error(`❌ Failed to upload batch: ${uploadError.message}`);
            }
        }
    }
    
    console.log(`✅ Completed: ${uploadedCount} documents uploaded to index '${index}'`);
}

main().catch(error => {
    console.error("❌ Error:", error.message);
    process.exit(1);
});

module.exports = main;