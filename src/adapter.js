const { TeamsAdapter } = require("@microsoft/teams-ai");

const config = require("./config");

const adapter = new TeamsAdapter(config);

// Catch-all for errors.
const onTurnErrorHandler = async (context, error) => {
  // This check writes out errors to console log .vs. app insights.
  // NOTE: In production environment, you should consider logging this to Azure
  //       application insights.
  console.error(`\n [onTurnError] unhandled error: ${error}`);
  console.error(`Stack Trace: ${error.stack}`);

  // Only send error message for user messages, not for other message types so the agent doesn't spam a channel or chat.
  if (context.activity.type === "message") {
    // Send a trace activity
    await context.sendTraceActivity(
      "OnTurnError Trace",
      `${error}`,
      "https://www.botframework.com/schemas/error",
      "TurnError"
    );

    // Send a message to the user
    await context.sendActivity("Your message has causes an error or bug. If the problem persists, please contact support.");
    await context.sendActivity("Please try sending a different message."); 
  }
};

// Set the onTurnError for the singleton TeamsAdapter.
adapter.onTurnError = onTurnErrorHandler;

module.exports = adapter;
