const fs = require('fs').promises;
const path = require('path');
const { OpenAI } = require('openai');
const { PATHS } = require('../config/config');

class KnowledgeService {
  constructor() {
    this.knowledgeBasePath = PATHS.KNOWLEDGE_BASE_DIR;
    this.processedFilesPath = path.join(this.knowledgeBasePath, '.processed');
    this.vectorStorePath = path.join(this.knowledgeBasePath, '.vectors');
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.supportedFormats = ['.txt', '.md', '.doc', '.docx', '.pdf'];
    this.initialize();
  }

  async initialize() {
    try {
      // Create necessary directories
      await fs.mkdir(this.knowledgeBasePath, { recursive: true });
      await fs.mkdir(this.processedFilesPath, { recursive: true });
      await fs.mkdir(this.vectorStorePath, { recursive: true });

      // Load processed files record
      this.processedFiles = await this.loadProcessedFiles();

      // Start watching for file changes
      this.watchKnowledgeBase();
    } catch (error) {
      console.error('❌ Error initializing knowledge service:', error);
    }
  }

  async loadProcessedFiles() {
    try {
      const filePath = path.join(this.processedFilesPath, 'processed.json');
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  }

  async saveProcessedFiles() {
    const filePath = path.join(this.processedFilesPath, 'processed.json');
    await fs.writeFile(filePath, JSON.stringify(this.processedFiles, null, 2));
  }

  watchKnowledgeBase() {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(this.knowledgeBasePath, {
      ignored: [
        this.processedFilesPath,
        this.vectorStorePath,
        /(^|[\/\\])\../  // Ignore dot files
      ],
      persistent: true
    });

    watcher
      .on('add', path => this.processNewFile(path))
      .on('change', path => this.processNewFile(path))
      .on('unlink', path => this.removeProcessedFile(path));
  }

  async processNewFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const lastModified = stats.mtime.getTime();

      // Check if file was already processed and hasn't changed
      if (this.processedFiles[filePath] && this.processedFiles[filePath].lastModified === lastModified) {
        return;
      }

      // Read and process file content
      const content = await this.readFile(filePath);
      if (!content) return;

      // Convert content to AI-friendly format
      const processedContent = await this.convertToAIFormat(content, filePath);

      // Store processed content
      const vectorFileName = path.basename(filePath) + '.vectors.json';
      await fs.writeFile(
        path.join(this.vectorStorePath, vectorFileName),
        JSON.stringify(processedContent, null, 2)
      );

      // Update processed files record
      this.processedFiles[filePath] = {
        lastModified,
        vectorFile: vectorFileName
      };
      await this.saveProcessedFiles();

      console.log(`✅ Processed knowledge base file: ${filePath}`);
    } catch (error) {
      console.error(`❌ Error processing file ${filePath}:`, error);
    }
  }

  async readFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!this.supportedFormats.includes(ext)) {
      console.log(`⚠️ Unsupported file format: ${ext}`);
      return null;
    }

    try {
      // For now, just read as text. In production, use appropriate libraries for each format
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      console.error(`❌ Error reading file ${filePath}:`, error);
      return null;
    }
  }

  async convertToAIFormat(content, filePath) {
    try {
      // Use OpenAI to structure the content
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `Convert the following document content into a structured format for AI learning. 
            Extract key concepts, FAQs, rules, and important information. 
            Format as JSON with sections for:
            - main_topics
            - key_concepts
            - faqs
            - rules
            - important_details`
          },
          {
            role: "user",
            content: content
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      return {
        source: path.basename(filePath),
        processed_at: new Date().toISOString(),
        content: JSON.parse(response.choices[0].message.content)
      };

    } catch (error) {
      console.error('❌ Error converting content to AI format:', error);
      return null;
    }
  }

  async removeProcessedFile(filePath) {
    try {
      // Remove from processed files record
      if (this.processedFiles[filePath]) {
        const vectorFile = path.join(
          this.vectorStorePath,
          this.processedFiles[filePath].vectorFile
        );
        await fs.unlink(vectorFile).catch(() => { });
        delete this.processedFiles[filePath];
        await this.saveProcessedFiles();
      }
    } catch (error) {
      console.error(`❌ Error removing processed file ${filePath}:`, error);
    }
  }

  async queryKnowledge(question) {
    try {
      // Load all processed knowledge
      const vectors = await this.loadAllVectors();

      // Query OpenAI with context
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a knowledgeable assistant for a chauffeur service.
            Use the provided knowledge base to answer questions accurately.
            If you're not sure about something, say so.
            Knowledge base context: ${JSON.stringify(vectors)}`
          },
          {
            role: "user",
            content: question
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      return response.choices[0].message.content;

    } catch (error) {
      console.error('❌ Error querying knowledge base:', error);
      return "I apologize, but I'm having trouble accessing the knowledge base right now.";
    }
  }

  async loadAllVectors() {
    try {
      const vectors = [];
      const files = await fs.readdir(this.vectorStorePath);

      for (const file of files) {
        if (file.endsWith('.vectors.json')) {
          const content = await fs.readFile(
            path.join(this.vectorStorePath, file),
            'utf8'
          );
          vectors.push(JSON.parse(content));
        }
      }

      return vectors;
    } catch (error) {
      console.error('❌ Error loading vectors:', error);
      return [];
    }
  }
}

module.exports = new KnowledgeService();