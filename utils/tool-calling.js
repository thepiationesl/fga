/**
 * Tool Calling Translation Layer for FGA
 * 
 * Handles conversion between OpenAI tool calling format and upstream formats.
 * Supports:
 * - Native tool calling (upstreams that support it, e.g., v6/Chat Smith)
 * - Simulated tool calling via prompt engineering (for upstreams without native support)
 */

const crypto = require('crypto');

/**
 * OpenAI tool definition format:
 * {
 *   type: 'function',
 *   function: {
 *     name: string,
 *     description: string,
 *     parameters: JSONSchema
 *   }
 * }
 */

/**
 * Tool call in OpenAI response format:
 * {
 *   id: 'call_xxx',
 *   type: 'function',
 *   function: { name: string, arguments: string }
 * }
 */

/**
 * Generate a unique tool call ID
 */
function generateToolCallId() {
  return `call_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Convert OpenAI tools to a system prompt for simulated tool calling
 * Used for upstreams that don't natively support function calling
 */
function toolsToSystemPrompt(tools) {
  if (!tools || !tools.length) return '';
  
  const functionDefs = tools.map(t => {
    const fn = t.function;
    return `## ${fn.name}
Description: ${fn.description}
Parameters: ${JSON.stringify(fn.parameters, null, 2)}`;
  }).join('\n\n');
  
  return `You have access to the following functions. When you need to call a function, output a JSON object in the following format:

\`\`\`json
{
  "tool_calls": [
    {
      "id": "call_xxx",
      "type": "function",
      "function": {
        "name": "function_name",
        "arguments": "{...}"
      }
    }
  ]
}
\`\`\`

Available functions:
${functionDefs}

Only call functions when necessary. If you call a function, do not include any other text in your response.`;
}

/**
 * Parse simulated tool calls from model response text
 * Returns { content: string, tool_calls: Array } or null if no tool calls found
 */
function parseSimulatedToolCalls(text) {
  if (!text || typeof text !== 'string') return null;
  
  // Try to find JSON block with tool_calls
  const jsonBlockMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        // Extract any text content before the tool call block
        const content = text.slice(0, jsonBlockMatch.index).trim();
        return { content: content || null, tool_calls: parsed.tool_calls };
      }
    } catch (e) {
      // Not valid JSON, continue
    }
  }
  
  // Try to find bare JSON object with tool_calls
  const bareMatch = text.match(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/);
  if (bareMatch) {
    try {
      const parsed = JSON.parse(bareMatch[0]);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        const content = text.slice(0, bareMatch.index).trim();
        return { content: content || null, tool_calls: parsed.tool_calls };
      }
    } catch (e) {
      // Not valid JSON
    }
  }
  
  return null;
}

/**
 * Convert upstream tool call response to OpenAI format
 * Upstream formats vary - this handles common patterns
 */
function normalizeToolCalls(upstreamResponse, upstreamType) {
  const toolCalls = [];
  
  // Pattern 1: OpenAI-style tool_calls array
  if (upstreamResponse.tool_calls && Array.isArray(upstreamResponse.tool_calls)) {
    for (const tc of upstreamResponse.tool_calls) {
      toolCalls.push({
        id: tc.id || generateToolCallId(),
        type: 'function',
        function: {
          name: tc.function?.name || tc.name,
          arguments: typeof tc.function?.arguments === 'string' 
            ? tc.function.arguments 
            : JSON.stringify(tc.function?.arguments || tc.arguments || {})
        }
      });
    }
    return toolCalls;
  }
  
  // Pattern 2: Single function_call (legacy)
  if (upstreamResponse.function_call) {
    const fc = upstreamResponse.function_call;
    toolCalls.push({
      id: generateToolCallId(),
      type: 'function',
      function: {
        name: fc.name,
        arguments: typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments || {})
      }
    });
    return toolCalls;
  }
  
  // Pattern 3: Tool calls in message content (simulated)
  const content = upstreamResponse.content || upstreamResponse.reply || upstreamResponse.message;
  if (content) {
    const parsed = parseSimulatedToolCalls(content);
    if (parsed && parsed.tool_calls.length > 0) {
      return parsed.tool_calls;
    }
  }
  
  return null;
}

/**
 * Build the messages array for upstream, injecting tool definitions if needed
 */
function buildUpstreamMessages(messages, tools, toolChoice, upstreamSupportsTools) {
  if (upstreamSupportsTools) {
    // Upstream supports native tool calling - pass tools in payload separately
    return messages;
  }
  
  // Upstream doesn't support tools - inject as system prompt
  const systemPrompt = toolsToSystemPrompt(tools);
  if (!systemPrompt) return messages;
  
  const hasSystem = messages.some(m => m.role === 'system' || m.role === 'developer');
  if (hasSystem) {
    // Append to existing system message
    return messages.map(m => {
      if (m.role === 'system' || m.role === 'developer') {
        return { ...m, content: (m.content || '') + '\n\n' + systemPrompt };
      }
      return m;
    });
  } else {
    // Prepend new system message
    return [{ role: 'system', content: systemPrompt }, ...messages];
  }
}

/**
 * Determine if an upstream version supports native tool calling
 */
function upstreamSupportsTools(version) {
  // v6 (Chat Smith) sends tools to upstream
  // Others may or may not - conservative default
  return ['v6'].includes(version);
}

/**
 * Process upstream response and convert to OpenAI format
 */
function processUpstreamResponse(upstreamResponse, version, originalTools) {
  const supportsTools = upstreamSupportsTools(version);
  const toolCalls = normalizeToolCalls(upstreamResponse, version);
  
  let content = upstreamResponse.reply || upstreamResponse.content || upstreamResponse.message || '';
  
  // If we got tool calls via simulation, remove the tool call block from content
  if (toolCalls && !supportsTools) {
    const parsed = parseSimulatedToolCalls(content);
    if (parsed) {
      content = parsed.content || '';
    }
  }
  
  return {
    content: content || null,
    tool_calls: toolCalls,
    finish_reason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop'
  };
}

module.exports = {
  generateToolCallId,
  toolsToSystemPrompt,
  parseSimulatedToolCalls,
  normalizeToolCalls,
  buildUpstreamMessages,
  upstreamSupportsTools,
  processUpstreamResponse
};