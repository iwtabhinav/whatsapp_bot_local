const fs = require('fs');
const path = require('path');

/**
 * Load JSON data from a file
 * @param {string} filePath - Path to the JSON file
 * @param {*} defaultValue - Default value if file doesn't exist or is invalid
 * @returns {*} Parsed JSON data or default value
 */
function loadJsonFile(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }

        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error loading JSON file ${filePath}:`, error.message);
        return defaultValue;
    }
}

/**
 * Save JSON data to a file
 * @param {string} filePath - Path to save the JSON file
 * @param {*} data - Data to save
 * @param {boolean} createDir - Whether to create directory if it doesn't exist
 * @returns {boolean} Success status
 */
function saveJsonFile(filePath, data, createDir = true) {
    try {
        if (createDir) {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error saving JSON file ${filePath}:`, error.message);
        return false;
    }
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {boolean} Whether file exists
 */
function fileExists(filePath) {
    return fs.existsSync(filePath);
}

/**
 * Create directory if it doesn't exist
 * @param {string} dirPath - Directory path
 * @returns {boolean} Success status
 */
function ensureDirectoryExists(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return true;
    } catch (error) {
        console.error(`Error creating directory ${dirPath}:`, error.message);
        return false;
    }
}

/**
 * Read file content as string
 * @param {string} filePath - Path to file
 * @param {string} encoding - File encoding (default: 'utf8')
 * @returns {string|null} File content or null if error
 */
function readFile(filePath, encoding = 'utf8') {
    try {
        return fs.readFileSync(filePath, encoding);
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Write content to file
 * @param {string} filePath - Path to file
 * @param {string} content - Content to write
 * @param {boolean} createDir - Whether to create directory if it doesn't exist
 * @returns {boolean} Success status
 */
function writeFile(filePath, content, createDir = true) {
    try {
        if (createDir) {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        fs.writeFileSync(filePath, content);
        return true;
    } catch (error) {
        console.error(`Error writing file ${filePath}:`, error.message);
        return false;
    }
}

/**
 * Delete a file
 * @param {string} filePath - Path to file
 * @returns {boolean} Success status
 */
function deleteFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return true;
    } catch (error) {
        console.error(`Error deleting file ${filePath}:`, error.message);
        return false;
    }
}

/**
 * Get file stats
 * @param {string} filePath - Path to file
 * @returns {Object|null} File stats or null if error
 */
function getFileStats(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (error) {
        console.error(`Error getting file stats ${filePath}:`, error.message);
        return null;
    }
}

/**
 * List files in directory
 * @param {string} dirPath - Directory path
 * @param {string} extension - File extension filter (optional)
 * @returns {string[]} Array of file names
 */
function listFiles(dirPath, extension = null) {
    try {
        if (!fs.existsSync(dirPath)) {
            return [];
        }

        const files = fs.readdirSync(dirPath);

        if (extension) {
            return files.filter(file => file.endsWith(extension));
        }

        return files;
    } catch (error) {
        console.error(`Error listing files in ${dirPath}:`, error.message);
        return [];
    }
}

module.exports = {
    loadJsonFile,
    saveJsonFile,
    fileExists,
    ensureDirectoryExists,
    readFile,
    writeFile,
    deleteFile,
    getFileStats,
    listFiles
};
