/**
 * Defines the utility methods.
 */
const { SearchIndexClient, KnownAnalyzerNames } = require("@azure/search-documents");
const { AzureKeyCredential } = require("@azure/core-auth");
const { OpenAIEmbeddings } = require("@microsoft/teams-ai");

/**
 * A wrapper for setTimeout that resolves a promise after timeInMs milliseconds.
 */
async function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deletes the index with the given name
 */
function deleteIndex(client, name) {
    return client.deleteIndex(name);
}

/**
 * Adds or updates the given documents in the index
 */
async function upsertDocuments(searchClient, documents) {
    if (!documents || documents.length === 0) {
        return;
    }
    
    try {
        const result = await searchClient.uploadDocuments(documents);
        return result;
    } catch (error) {
        console.error(`Error uploading ${documents.length} documents:`, error.message);
        throw error;
    }
}

/**
 * Creates the index with the given name, deleting existing index if it exists
 */
async function createIndexIfNotExists(client, name) {
    const MyDocumentIndex = {
        name,
        fields: [
            {
                type: "Edm.String",
                name: "docId",
                key: true,
                filterable: true,
            },
            {
                type: "Edm.String",
                name: "docTitle",
                searchable: true,
                filterable: true,
            },
            {
                type: "Edm.String",
                name: "description",
                searchable: true,
                analyzerName: KnownAnalyzerNames.EnLucene,
            },
            {
                type: "Collection(Edm.Single)",
                name: "descriptionVector",
                searchable: true,
                vectorSearchDimensions: 1536,
                vectorSearchProfileName: "my-vector-config",
            },
            // Add new searchable fields
            {
                type: "Edm.Int32",
                name: "pageNumber",
                filterable: true,
                sortable: true,
                facetable: true
            },
            {
                type: "Edm.String",
                name: "sourceDocument",
                searchable: true,
                filterable: true,
                facetable: true,
                sortable: true
            }
        ],
        vectorSearch: {
            algorithms: [
                {
                    name: "my-hnsw-vector-config-1",
                    kind: "hnsw",
                    hnswParameters: {
                        metric: "cosine",
                        m: 4,
                        efConstruction: 400,
                        efSearch: 500,
                    },
                },
            ],
            profiles: [
                {
                    name: "my-vector-config",
                    algorithmConfigurationName: "my-hnsw-vector-config-1",
                },
            ],
        },
        semantic: {
            configurations: [
                {
                    name: "my-semantic-config",
                    prioritizedFields: {
                        titleField: {
                            fieldName: "docTitle",
                        },
                        prioritizedContentFields: [
                            {
                                fieldName: "description",
                            },
                        ],
                        prioritizedKeywordsFields: [
                            {
                                fieldName: "sourceDocument",
                            },
                        ],
                    },
                },
            ],
        },
    };

    try {
        // Check if index exists
        await client.getIndex(name);
        console.log(`🗑️  Index '${name}' already exists. Deleting it...`);
        
        // Delete existing index
        await client.deleteIndex(name);
        console.log(`✅ Deleted existing index: ${name}`);
        
        // Wait a moment for deletion to complete
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Create new index
        console.log(`📝 Creating new index: ${name}`);
        await client.createIndex(MyDocumentIndex);
        console.log(`✅ Index created: ${name}`);
        
    } catch (error) {
        if (error.statusCode === 404) {
            // Index doesn't exist, create it
            console.log(`📝 Creating index: ${name}`);
            await client.createIndex(MyDocumentIndex);
            console.log(`✅ Index created: ${name}`);
        } else {
            throw error;
        }
    }
}

/**
 * Generate the embedding vector using Teams AI library
 */
async function getEmbeddingVector(text) {
    const embeddings = new OpenAIEmbeddings({
        azureApiKey: process.env.SECRET_AZURE_OPENAI_API_KEY,
        azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
        azureDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
    });

    const result = await embeddings.createEmbeddings(process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME, text);

    if (result.status !== "success" || !result.output) {
        throw new Error(`Failed to generate embeddings`);
    }

    return result.output[0];
}

module.exports = {
    deleteIndex,
    createIndexIfNotExists,
    delay,
    upsertDocuments,
    getEmbeddingVector,
};