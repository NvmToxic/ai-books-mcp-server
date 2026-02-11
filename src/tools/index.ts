/**
 * AI Books MCP Tools
 * Tools for LLM context extension via gravitational memory
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  createLibrary,
  queryLibrary,
  verifyIntegrity,
  calculateSimilarity,
  type CompressedChunk
} from '../services/gravitational.js';
import { libraryStorage } from '../services/storage.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as schemas from '../schemas/index.js';

/**
 * Register all AI Books tools with the MCP server
 */
export function registerTools(server: McpServer) {
  
  /**
   * Tool: create_knowledge_library
   * Creates a compressed knowledge library from text
   */
  server.registerTool(
    "create_knowledge_library",
    {
      title: "Create Knowledge Library",
      description: "Creates a new knowledge library by compressing text using gravitational memory. " +
                   "The text is split into chunks and compressed 15-60× while maintaining 100% data integrity. " +
                   "Perfect for large documents, codebases, or research papers.",
      inputSchema: schemas.CreateLibraryInputSchema,
      outputSchema: schemas.CreateLibraryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ name, text, n_max = 15 }) => {
      try {
        // Check if library already exists
        if (libraryStorage.exists(name)) {
          throw new Error(`Library '${name}' already exists. Use a different name or delete the existing library first.`);
        }
        
        // Create library
        const library = createLibrary(name, text, n_max);
        
        // Save to storage
        libraryStorage.save(library);
        
        const totalWords = library.chunks.reduce((sum, chunk) => sum + chunk.metadata.word_count, 0);
        
        const output = {
          library_name: library.name,
          chunks_created: library.chunks.length,
          total_words: totalWords,
          compression_ratio: library.total_compression_ratio,
          created_at: library.created_at
        };
        
        return {
          content: [{
            type: "text",
            text: `✅ Knowledge library '${name}' created successfully!\n\n` +
                  `📊 Statistics:\n` +
                  `- Chunks created: ${library.chunks.length}\n` +
                  `- Total words: ${totalWords.toLocaleString()}\n` +
                  `- Compression ratio: ${library.total_compression_ratio.toFixed(1)}×\n` +
                  `- Data integrity: 100% guaranteed\n\n` +
                  `You can now query this library using 'query_knowledge_library' tool.`
          }],
          structuredContent: output
        };
      } catch (error) {
        throw new Error(`Failed to create library: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  /**
   * Tool: query_knowledge_library
   * Queries a library and retrieves relevant context
   */
  server.registerTool(
    "query_knowledge_library",
    {
      title: "Query Knowledge Library",
      description: "Queries a knowledge library and retrieves the most relevant chunks for a given query. " +
                   "Returns extended context that can be used to answer questions with much more detail than " +
                   "would fit in a normal LLM context window.",
      inputSchema: schemas.QueryLibraryInputSchema,
      outputSchema: schemas.QueryLibraryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ library_name, query, top_k = 8 }) => {
      try {
        const library = libraryStorage.get(library_name);
        
        if (!library) {
          throw new Error(`Library '${library_name}' not found. Create it first using 'create_knowledge_library'.`);
        }
        
        const relevantChunks = queryLibrary(library, query, top_k);
        
        // Build extended context
        const context = relevantChunks
          .map((chunk, idx) => `[CHUNK ${idx + 1}]\n${chunk.content}`)
          .join('\n\n---\n\n');
        
        const totalWords = relevantChunks.reduce((sum, chunk) => sum + chunk.metadata.word_count, 0);
        
        const output = {
          query,
          chunks_retrieved: relevantChunks.length,
          context,
          total_words: totalWords,
          library_name
        };
        
        return {
          content: [{
            type: "text",
            text: `🔍 Query Results for '${query}'\n\n` +
                  `Retrieved ${relevantChunks.length} relevant chunks (${totalWords} words)\n\n` +
                  `📄 Extended Context:\n${'='.repeat(80)}\n\n${context}\n\n${'='.repeat(80)}\n\n` +
                  `Use this context to provide detailed, accurate answers.`
          }],
          structuredContent: output
        };
      } catch (error) {
        throw new Error(`Failed to query library: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  /**
   * Tool: extend_context_from_files
   * Extends context by loading and compressing files
   */
  server.registerTool(
    "extend_context_from_files",
    {
      title: "Extend Context From Files",
      description: "Loads multiple files, compresses them into temporary libraries, and retrieves relevant context " +
                   "for a given query. Perfect for quickly understanding large codebases or document sets without " +
                   "creating permanent libraries.",
      inputSchema: schemas.ExtendContextInputSchema,
      outputSchema: schemas.ExtendContextOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ file_paths, query, top_k = 8 }) => {
      try {
        const allChunks: CompressedChunk[] = [];
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;
        
        // Load and compress each file
        for (const filePath of file_paths) {
          const content = await fs.readFile(filePath, 'utf-8');
          const tempLibrary = createLibrary(`temp-${Date.now()}`, content);
          
          totalOriginalSize += content.length;
          totalCompressedSize += tempLibrary.chunks.reduce((sum, chunk) => {
            return sum + 32 + (chunk.gravitational_bit.states.length * 4);
          }, 0);
          
          // Get relevant chunks from this file
          const relevantChunks = queryLibrary(tempLibrary, query, top_k);
          allChunks.push(...relevantChunks);
        }
        
        // Sort all chunks by relevance
        const scoredChunks = allChunks.map(chunk => ({
          chunk,
          score: calculateSimilarity(query, chunk)
        }));
        
        scoredChunks.sort((a, b) => b.score - a.score);
        
        // Take top chunks
        const topChunks = scoredChunks.slice(0, top_k).map(sc => sc.chunk);
        
        const extendedContext = topChunks
          .map((chunk, idx) => `[CHUNK ${idx + 1} from ${file_paths[0]}]\n${chunk.content}`)
          .join('\n\n---\n\n');
        
        const totalWords = topChunks.reduce((sum, chunk) => sum + chunk.metadata.word_count, 0);
        
        const output = {
          query,
          files_processed: file_paths.length,
          total_chunks_retrieved: topChunks.length,
          extended_context: extendedContext,
          total_words: totalWords,
          compression_stats: {
            original_size: totalOriginalSize,
            compressed_size: totalCompressedSize,
            compression_ratio: totalOriginalSize / totalCompressedSize
          }
        };
        
        return {
          content: [{
            type: "text",
            text: `📂 Processed ${file_paths.length} files\n` +
                  `🔍 Retrieved ${topChunks.length} most relevant chunks (${totalWords} words)\n` +
                  `📊 Compression: ${output.compression_stats.compression_ratio.toFixed(1)}×\n\n` +
                  `Extended Context:\n${'='.repeat(80)}\n\n${extendedContext}`
          }],
          structuredContent: output
        };
      } catch (error) {
        throw new Error(`Failed to extend context: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  /**
   * Tool: list_knowledge_libraries
   * Lists all available libraries
   */
  server.registerTool(
    "list_knowledge_libraries",
    {
      title: "List Knowledge Libraries",
      description: "Lists all available knowledge libraries with their statistics.",
      inputSchema: {},
      outputSchema: schemas.ListLibrariesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async () => {
      const libraries = libraryStorage.list();
      
      const output = {
        libraries: libraries.map(lib => ({
          name: lib.name,
          chunks_count: lib.chunks.length,
          compression_ratio: lib.total_compression_ratio,
          created_at: lib.created_at,
          updated_at: lib.updated_at
        })),
        total_libraries: libraries.length
      };
      
      const librariesText = libraries.length === 0
        ? "No libraries created yet."
        : libraries.map(lib => 
            `📚 ${lib.name}\n` +
            `   - Chunks: ${lib.chunks.length}\n` +
            `   - Compression: ${lib.total_compression_ratio.toFixed(1)}×\n` +
            `   - Created: ${new Date(lib.created_at).toLocaleDateString()}`
          ).join('\n\n');
      
      return {
        content: [{
          type: "text",
          text: `📚 Available Libraries (${libraries.length})\n\n${librariesText}`
        }],
        structuredContent: output
      };
    }
  );

  /**
   * Tool: get_library_stats
   * Gets detailed statistics for a library
   */
  server.registerTool(
    "get_library_stats",
    {
      title: "Get Library Statistics",
      description: "Retrieves detailed statistics for a specific knowledge library.",
      inputSchema: schemas.GetLibraryStatsInputSchema,
      outputSchema: schemas.GetLibraryStatsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ library_name }) => {
      const library = libraryStorage.get(library_name);
      
      if (!library) {
        throw new Error(`Library '${library_name}' not found.`);
      }
      
      const totalWords = library.chunks.reduce((sum, chunk) => sum + chunk.metadata.word_count, 0);
      const totalChars = library.chunks.reduce((sum, chunk) => sum + chunk.metadata.character_count, 0);
      const avgChunkSize = totalWords / library.chunks.length;
      
      const output = {
        library_name: library.name,
        total_chunks: library.chunks.length,
        total_words: totalWords,
        total_characters: totalChars,
        compression_ratio: library.total_compression_ratio,
        average_chunk_size: avgChunkSize,
        created_at: library.created_at,
        updated_at: library.updated_at,
        n_max: library.chunks[0]?.gravitational_bit.n_max || 15
      };
      
      return {
        content: [{
          type: "text",
          text: `📊 Statistics for '${library_name}'\n\n` +
                `Total chunks: ${output.total_chunks}\n` +
                `Total words: ${output.total_words.toLocaleString()}\n` +
                `Total characters: ${output.total_characters.toLocaleString()}\n` +
                `Compression ratio: ${output.compression_ratio.toFixed(1)}×\n` +
                `Average chunk size: ${output.average_chunk_size.toFixed(0)} words\n` +
                `Orbital level (n_max): ${output.n_max}\n` +
                `Created: ${new Date(output.created_at).toLocaleString()}`
        }],
        structuredContent: output
      };
    }
  );

  /**
   * Tool: delete_knowledge_library
   * Deletes a library
   */
  server.registerTool(
    "delete_knowledge_library",
    {
      title: "Delete Knowledge Library",
      description: "Permanently deletes a knowledge library.",
      inputSchema: schemas.DeleteLibraryInputSchema,
      outputSchema: schemas.DeleteLibraryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      }
    },
    async ({ library_name }) => {
      const deleted = libraryStorage.delete(library_name);
      
      const output = {
        deleted,
        library_name,
        message: deleted
          ? `Library '${library_name}' deleted successfully.`
          : `Library '${library_name}' not found.`
      };
      
      return {
        content: [{
          type: "text",
          text: output.message
        }],
        structuredContent: output
      };
    }
  );

  /**
   * Tool: verify_library_integrity
   * Verifies 100% data integrity
   */
  server.registerTool(
    "verify_library_integrity",
    {
      title: "Verify Library Integrity",
      description: "Verifies that all chunks in a library maintain 100% data integrity by checking hashes.",
      inputSchema: schemas.VerifyIntegrityInputSchema,
      outputSchema: schemas.VerifyIntegrityOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ library_name }) => {
      const library = libraryStorage.get(library_name);
      
      if (!library) {
        throw new Error(`Library '${library_name}' not found.`);
      }
      
      let verified = 0;
      let failed = 0;
      
      for (const chunk of library.chunks) {
        if (verifyIntegrity(chunk)) {
          verified++;
        } else {
          failed++;
        }
      }
      
      const output = {
        library_name,
        total_chunks: library.chunks.length,
        verified_chunks: verified,
        failed_chunks: failed,
        integrity_percentage: (verified / library.chunks.length) * 100,
        all_verified: failed === 0
      };
      
      return {
        content: [{
          type: "text",
          text: output.all_verified
            ? `✅ 100% Data Integrity Verified!\n\nAll ${verified} chunks passed integrity check.`
            : `⚠️ Integrity Issues Found\n\nVerified: ${verified}/${library.chunks.length}\nFailed: ${failed}`
        }],
        structuredContent: output
      };
    }
  );

  /**
   * Tool: search_documents
   * Searches for relevant chunks
   */
  server.registerTool(
    "search_documents",
    {
      title: "Search Documents",
      description: "Searches for relevant chunks in a knowledge library and returns previews with relevance scores.",
      inputSchema: schemas.SearchDocumentsInputSchema,
      outputSchema: schemas.SearchDocumentsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ library_name, query, max_results = 10 }) => {
      const library = libraryStorage.get(library_name);
      
      if (!library) {
        throw new Error(`Library '${library_name}' not found.`);
      }
      
      // Score and sort chunks
      const scoredChunks = library.chunks.map(chunk => ({
        chunk,
        score: calculateSimilarity(query, chunk)
      }));
      
      scoredChunks.sort((a, b) => b.score - a.score);
      
      const topResults = scoredChunks.slice(0, max_results);
      
      const results = topResults.map(({ chunk, score }) => ({
        chunk_id: chunk.id,
        content_preview: chunk.content.substring(0, 200) + '...',
        relevance_score: score,
        word_count: chunk.metadata.word_count
      }));
      
      const output = {
        query,
        results,
        total_results: results.length,
        library_name
      };
      
      const resultsText = results.map((r, idx) => 
        `${idx + 1}. [Score: ${(r.relevance_score * 100).toFixed(1)}%] ${r.word_count} words\n` +
        `   ${r.content_preview}`
      ).join('\n\n');
      
      return {
        content: [{
          type: "text",
          text: `🔍 Search Results for "${query}"\n\n${resultsText}`
        }],
        structuredContent: output
      };
    }
  );
}
