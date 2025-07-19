process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.SECRET_AZURE_OPENAI_API_KEY;
process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || process.env.SECRET_AZURE_DOCUMENT_INTELLIGENCE_KEY;
process.env.AZURE_SEARCH_KEY = process.env.AZURE_SEARCH_KEY || process.env.SECRET_AZURE_SEARCH_KEY;

// Import required packages
const express = require("express");

// This agent's adapter
const adapter = require("./adapter");

// This agent's main dialog.
const app = require("./app/app");

// Create express application.
const expressApp = express();
expressApp.use(express.json());

const server = expressApp.listen(process.env.port || process.env.PORT || 3978, () => {
  console.log(`\nAgent started, ${expressApp.name} listening to`, server.address());
});

// Listen for incoming requests.
expressApp.post("/api/messages", async (req, res) => {
  // Route received a request to adapter for processing
  await adapter.process(req, res, async (context) => {
    // Dispatch to application for routing
    await app.run(context);
  });
});
