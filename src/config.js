const config = {
    MicrosoftAppId: process.env.BOT_ID,
    MicrosoftAppType: process.env.BOT_TYPE,
    MicrosoftAppTenantId: process.env.BOT_TENANT_ID,
    MicrosoftAppPassword: process.env.BOT_PASSWORD,
    geminiApiKey: process.env.SECRET_GEMINI_API_KEY,
    azureOpenAIKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenAIDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    azureOpenAIEmbeddingDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
    azureSearchKey: process.env.AZURE_SEARCH_KEY,
    azureSearchEndpoint: process.env.AZURE_SEARCH_ENDPOINT,
    indexName: "company-a-search-index" // IMPORTANT: MUST BE UNIQUE FOR EACH COMPANY'S BOT !!!
  };
  
  module.exports = config;