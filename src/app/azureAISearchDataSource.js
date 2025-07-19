const { OpenAIEmbeddings } = require("@microsoft/teams-ai");
const { AzureKeyCredential, SearchClient } = require("@azure/search-documents");

/**
 * A data source that searches through Azure AI search.
 */
class AzureAISearchDataSource {
    /**
     * Creates a new `AzureAISearchDataSource` instance.
     */
    constructor(options) {
        this.name = options.name;
        this.options = options;
        this.searchClient = new SearchClient(
            options.azureAISearchEndpoint,
            options.indexName,
            new AzureKeyCredential(options.azureAISearchApiKey),
            {}
        );
    }

    /**
     * Renders the data source as a string of text.
     */
    async renderData(context, memory, tokenizer, maxTokens) {
        const query = memory.getValue("temp.input");
        if(!query) {
            return { output: "", length: 0, tooLong: false };
        }
        
        const selectedFields = [
            "docId",
            "docTitle", 
            "description",
            "pageNumber",
            "sourceDocument"
        ];

        // Generate embeddings for the query
        const queryVector = await this.getEmbeddingVector(query);

        const searchResults = await this.searchClient.search(query, {
            searchFields: ["docTitle", "description", "sourceDocument"],
            select: selectedFields,
            vectorSearchOptions: {
                queries: [
                    {
                        kind: "vector",
                        fields: ["descriptionVector"],
                        kNearestNeighborsCount: 2,
                        vector: queryVector,
                    }
                ]
            },
        });

        if (!searchResults.results) {
            return { output: "", length: 0, tooLong: false };
        }

        // Concatenate the documents string into a single document
        let usedTokens = 0;
        let doc = "";
        for await (const result of searchResults.results) {
            // Include page and source information in the formatted result
            const formattedResult = this.formatDocument(
                `${result.document.description}\n` +
                `Page: ${result.document.pageNumber}\n` +
                `Source: ${result.document.sourceDocument}\n` +
                `Citation title: ${result.document.docTitle}.`
            );
            const tokens = tokenizer.encode(formattedResult).length;

            if (usedTokens + tokens > maxTokens) {
                break;
            }

            doc += formattedResult;
            usedTokens += tokens;
        }

        return { output: doc, length: usedTokens, tooLong: usedTokens > maxTokens };
    }

    /**
     * Formats the result string 
     */
    formatDocument(result) {
        return `<context>${result}</context>`;
    }

    /**
     * Generate embeddings for the query
     */
    async getEmbeddingVector(query) {
        const embeddings = new OpenAIEmbeddings({
            azureApiKey: this.options.azureOpenAIApiKey,
            azureEndpoint: this.options.azureOpenAIEndpoint,
            azureDeployment: this.options.azureOpenAIEmbeddingDeploymentName,
        });

        const result = await embeddings.createEmbeddings(this.options.azureOpenAIEmbeddingDeploymentName, query);

        if (result.status !== "success" || !result.output) {
            throw new Error(`Failed to generate embeddings for query: ${query}`);
        }

        return result.output[0];
    }
}

module.exports = {
  AzureAISearchDataSource,
};