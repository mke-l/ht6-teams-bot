const { MemoryStorage, MessageFactory } = require("botbuilder");
const path = require("path");
const config = require("../config");
const customSayCommand = require("./customSayCommand");

// See https://aka.ms/teams-ai-library to learn more about the Teams AI library.
const { AI, Application, ActionPlanner, PromptManager } = require("@microsoft/teams-ai");
const { AzureAISearchDataSource } = require("./azureAISearchDataSource");
const { GeminiModelAdapter } = require("./geminiAdapter");

// Create AI components
const model = new GeminiModelAdapter(config.geminiApiKey);

// Create the data source
const azureSearchDataSource = new AzureAISearchDataSource({
  name: "azure-ai-search",
  indexName: config.indexName,
  azureAISearchApiKey: config.azureSearchKey,
  azureAISearchEndpoint: config.azureSearchEndpoint,
  azureOpenAIApiKey: config.azureOpenAIKey,
  azureOpenAIEndpoint: config.azureOpenAIEndpoint,
  azureOpenAIEmbeddingDeploymentName: config.azureOpenAIEmbeddingDeploymentName,
});

// Pass the data source to the model adapter
model.setDataSource(azureSearchDataSource);

const prompts = new PromptManager({
  promptsFolder: path.join(__dirname, "../prompts"),
});

const planner = new ActionPlanner({
  model,
  prompts,
  defaultPrompt: "chat",
});

// Register your data source with planner (this is still needed for the Teams AI Library)
planner.prompts.addDataSource(azureSearchDataSource);

// Define storage and application
const storage = new MemoryStorage();
const app = new Application({
  storage,
  ai: {
    planner,
    enable_feedback_loop: true,
  },
});

app.ai.action(AI.SayCommandActionName, customSayCommand.sayCommand(true));

app.feedbackLoop(async (context, state, feedbackLoopData) => {
  //add custom feedback process logic here
  console.log("Your feedback is " + JSON.stringify(context.activity.value));
});

// Have bot send an inital message when a member is added to the chat
app.conversationUpdate('membersAdded', async (context, state) => {
    const membersAdded = context.activity.membersAdded;
    if (membersAdded) {
      for (const member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            "Welcome to the Company A Benefits Bot! I can help you understand your benefits. Ask me anything about your health plan, retirement savings, or other perks!"
          );
        }
      }
    }
});

module.exports = app;