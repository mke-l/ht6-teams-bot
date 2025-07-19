const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { AzureAISearchDataSource } = require("./azureAISearchDataSource");

class GeminiModelAdapter {
    constructor(apiKey, modelName = "gemini-2.0-flash") {
        this.genAI = new GoogleGenerativeAI(INSERT GEMINI API KEY);
        this.model = this.genAI.getGenerativeModel({ model: modelName });
        
        // Store reference to the data source for direct access
        this.dataSource = null;
    }
    
    // Allow setting the data source after construction
    setDataSource(dataSource) {
        this.dataSource = dataSource;
    }

    async completePrompt(context, memory, functions, tokenizer, prompt) {
        try {
            console.log('=== GeminiModelAdapter Debug ===');
            
            let messages = [];
            let config = prompt.config || {};
            
            // Get the user's query
            const userQuery = context.activity.text || memory.getValue("temp.input") || "";
            console.log('User query:', userQuery);
            
            // Load the exact system prompt from skprompt.txt
            let systemPrompt = '';
            try {
                const promptPath = path.join(__dirname, '..', 'prompts', 'chat', 'skprompt.txt');
                systemPrompt = fs.readFileSync(promptPath, 'utf8');
                console.log('Loaded system prompt template from file');
            } catch (error) {
                console.error('Error loading prompt file:', error);
                throw new Error('Failed to load system prompt');
            }
            
            // Directly retrieve Azure AI Search results if we have a data source
            let searchContext = '';
            if (this.dataSource && userQuery) {
                console.log('Retrieving search results directly from Azure AI Search...');
                
                // Set the query in memory where the data source expects it
                memory.setValue("temp.input", userQuery);
                
                // Call renderData to get search results
                const searchResult = await this.dataSource.renderData(
                    context, 
                    memory, 
                    tokenizer, 
                    3000 // Max tokens for context
                );
                
                if (searchResult.output) {
                    searchContext = searchResult.output;
                    console.log('Retrieved search context, length:', searchContext.length);
                    console.log('Context preview:', searchContext.substring(0, 200) + '...');
                } else {
                    console.log('No search results found');
                }
            }
            
            // The prompt expects context to be provided in <context> tags
            // Simply append the context to the system prompt
            if (searchContext) {
                // The search context already includes <context> tags from formatDocument
                systemPrompt = systemPrompt + '\n\n' + searchContext;
                console.log('Appended search context to system prompt');
            } else {
                // Add empty context if no results found
                systemPrompt = systemPrompt + '\n\n<context>\nNo relevant documents found.\n</context>';
                console.log('Added empty context tags');
            }
            
            console.log('Final system prompt length:', systemPrompt.length);
            console.log('System prompt includes <context>:', systemPrompt.includes('<context>'));
            
            // Build the messages array
            messages.push({ role: 'system', content: systemPrompt });
            
            // Add conversation history (excluding current message)
            const conversation = memory.getValue('conversation');
            if (conversation && conversation.history && Array.isArray(conversation.history)) {
                for (const entry of conversation.history) {
                    if (entry.role && entry.content) {
                        // Skip the current user message
                        if (entry.role === 'user' && entry.content === userQuery) {
                            continue;
                        }
                        
                        // For assistant messages, extract just the answer from JSON
                        let messageContent = entry.content;
                        if (entry.role === 'assistant') {
                            try {
                                const parsed = JSON.parse(entry.content);
                                if (parsed.results && Array.isArray(parsed.results)) {
                                    // Extract all answers and join them
                                    messageContent = parsed.results.map(r => r.answer).join('\n\n');
                                }
                            } catch (e) {
                                // Not JSON, use as-is
                            }
                        }
                        
                        messages.push({
                            role: entry.role,
                            content: messageContent
                        });
                    }
                }
            }
            
            // Add current user message
            if (userQuery) {
                messages.push({ role: 'user', content: userQuery });
            }
            
            // Filter and validate
            messages = messages.filter(m => m && m.content && m.content.trim().length > 0);
            
            if (messages.length === 0) {
                throw new Error('No valid messages found');
            }
            
            console.log('Message structure:');
            console.log('- Total messages:', messages.length);
            console.log('- System prompt length:', messages[0].content.length);
            console.log('- Contains context:', messages[0].content.includes('<context>'));
            
            // Send to Gemini
            const result = await this.sendToGemini(messages, config);
            
            // Ensure JSON response
            if (result.status === 'success' && result.message && result.message.content) {
                result.message.content = this.ensureJsonResponse(result.message.content);
            }
            
            return result;
            
        } catch (error) {
            console.error('GeminiModelAdapter Error:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }
    
    ensureJsonResponse(content) {
        // Remove any markdown code blocks
        content = content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
        
        try {
            // Try to parse as JSON
            const jsonResponse = JSON.parse(content);
            
            // Validate structure matches the expected format from skprompt.txt
            if (!jsonResponse.results || !Array.isArray(jsonResponse.results)) {
                throw new Error('Invalid response structure');
            }
            
            // Ensure required fields match the format in skprompt.txt
            jsonResponse.results = jsonResponse.results.map(result => ({
                answer: result.answer || '',
                citationTitle: result.citationTitle || '',
                citationContent: result.citationContent || ''
            }));
            
            return JSON.stringify(jsonResponse);
        } catch (e) {
            console.log('Response is not valid JSON, wrapping in expected format');
            // Wrap plain text in expected format from skprompt.txt
            const wrappedResponse = {
                results: [{
                    answer: content,
                    citationTitle: "",
                    citationContent: ""
                }]
            };
            return JSON.stringify(wrappedResponse);
        }
    }

    async sendToGemini(messages, config) {
        // Convert to Gemini format
        const history = [];
        let systemContext = '';
        let lastUserMessage = null;
        
        // Process messages
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            
            if (msg.role === 'system') {
                systemContext = msg.content;
            } else if (msg.role === 'user') {
                // If this is the last message, save it separately
                if (i === messages.length - 1) {
                    lastUserMessage = msg.content;
                } else {
                    // Add to history with corresponding assistant response
                    history.push({
                        role: 'user',
                        parts: [{ text: msg.content }]
                    });
                    
                    // Look for the next assistant message
                    if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
                        history.push({
                            role: 'model',
                            parts: [{ text: messages[i + 1].content }]
                        });
                        i++; // Skip the assistant message in next iteration
                    }
                }
            }
        }
        
        // Prepare final prompt - ALWAYS include system context with each message
        let finalPrompt = lastUserMessage || messages[messages.length - 1].content;
        
        // Always prepend the full system prompt (including context) to ensure Gemini has all information
        if (systemContext) {
            finalPrompt = systemContext + '\n\nUser Question: ' + finalPrompt;
        }
        
        // Configure chat
        const chatConfig = {
            history: history,
            generationConfig: {
                maxOutputTokens: config.max_tokens || 4000,
                temperature: config.temperature !== undefined ? config.temperature : 0.2,
                topP: config.top_p !== undefined ? config.top_p : 0.95,
                responseMimeType: "text/plain" // Ensure we get plain text that we can parse as JSON
            }
        };
        
        console.log('Sending to Gemini:');
        console.log('- History entries:', history.length);
        console.log('- Final prompt length:', finalPrompt.length);
        console.log('- Temperature:', chatConfig.generationConfig.temperature);
        
        try {
            const chat = this.model.startChat(chatConfig);
            const result = await chat.sendMessage(finalPrompt);
            const response = await result.response;
            const text = response.text();
            
            console.log('Gemini response received, length:', text.length);
            
            return {
                status: 'success',
                message: {
                    role: 'assistant',
                    content: text
                }
            };
        } catch (error) {
            console.error('Gemini API error:', error);
            throw error;
        }
    }
}

module.exports = { GeminiModelAdapter };