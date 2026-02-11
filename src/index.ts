#!/usr/bin/env node

/**
 * AI Books MCP Server
 * Universal LLM Context Extension via Gravitational Memory
 * 
 * @author Daouda Abdoul Anzize <anzizdaouda0@gmail.com>
 * @description Extends any LLM context 15-60× while maintaining 100% data integrity
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';

/**
 * Initialize MCP Server
 */
const server = new McpServer({
  name: 'ai-books-mcp-server',
  version: '1.0.0'
});

/**
 * Register all tools
 */
registerTools(server);

/**
 * Start server with stdio transport
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('AI Books MCP Server running on stdio');
  console.error('Created by Daouda Abdoul Anzize');
  console.error('Gravitational Memory: Extending LLM context 15-60×');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
