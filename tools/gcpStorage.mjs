import { Storage } from "@google-cloud/storage";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check if running against emulator
const isEmulator = process.env.STORAGE_EMULATOR_HOST;

// example emulator config
// export STORAGE_EMULATOR_HOST=http://localhost:9003
// export GCLOUD_PROJECT=mess-booking-app-serverless

let storage;

if (isEmulator) {
  if (typeof isEmulator === "string" && !isEmulator.startsWith('http')) {
    console.error('Variable STORAGE_EMULATOR_HOST should contain HTTP(s) schema');
    process.exit(1);
  }
  if (!process.env.GCLOUD_PROJECT) {
    console.error('Missing GCLOUD_PROJECT environment variable. Required for emulator.');
    process.exit(1);
  }
  console.log(`🔧 Using Storage Emulator at: ${process.env.STORAGE_EMULATOR_HOST}`);
  console.log(`   Project ID: ${process.env.GCLOUD_PROJECT}\n`);

  // For emulator, create storage client without credentials
  storage = new Storage({
    apiEndpoint: process.env.STORAGE_EMULATOR_HOST,
    projectId: process.env.GCLOUD_PROJECT,
  });
} else {
  console.log('🌐 Using Production Google Cloud Storage');
  
  // Load the credentials from the JSON key file for production
  const keyFilename = path.join(__dirname, "creds.json");
  storage = new Storage({ keyFilename });
}

/**
 * @param {string} bucketName
 * @param {string} cloudPathPrefix
 */
async function countFiles(bucketName, cloudPathPrefix = "") {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: cloudPathPrefix });
  console.log(`Number of files with prefix '${cloudPathPrefix}':`, files.length);
}

/**
 * @param {string} bucketName
 * @param {string} cloudPathPrefix
 */
async function listFiles(bucketName, cloudPathPrefix = "") {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: cloudPathPrefix });
  console.log("Files:");
  const table = [];
  files.forEach((file) => {
    table.push({
      Name: file.name,
      "Size (Bytes)": file.metadata.size,
      "Content Type": file.metadata.contentType,
    });
  });
  console.table(table);
}

/**
 * @param {string} bucketName
 * @param {string} cloudPath
 */
async function removeFile(bucketName, cloudPath) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!cloudPath) {
    throw new Error("Cloud path is required.");
  }
  const file = storage.bucket(bucketName).file(cloudPath);
  await file.delete();
  console.log(`${cloudPath} deleted successfully.`);
}

/**
 * @param {string} bucketName
 * @param {string} oldPath
 * @param {string} newPath
 */
async function moveFile(bucketName, oldPath, newPath) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!oldPath) {
    throw new Error("Old path is required.");
  }
  if (!newPath) {
    throw new Error("New path is required.");
  }
  const bucket = storage.bucket(bucketName);
  const sourceFile = bucket.file(oldPath);
  const destinationFile = bucket.file(newPath);
  const [exists] = await sourceFile.exists();
  if (!exists) {
    throw new Error(`Source file '${oldPath}' does not exist.`);
  }
  await sourceFile.copy(destinationFile);
  await sourceFile.delete();
  console.log(`Moved file from ${oldPath} to ${newPath} successfully.`);
}

/**
 * @param {string} bucketName
 * @param {string} oldPrefix
 * @param {string} newPrefix
 */
async function moveByPrefix(bucketName, oldPrefix, newPrefix) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!oldPrefix) {
    throw new Error("Old prefix is required.");
  }
  if (!newPrefix) {
    throw new Error("New prefix is required.");
  }
  
  const bucket = storage.bucket(bucketName);
  
  // Get all files with the old prefix
  const [files] = await bucket.getFiles({ prefix: oldPrefix });
  
  if (files.length === 0) {
    console.log(`No files found with prefix '${oldPrefix}'.`);
    return;
  }
  
  console.log(`Found ${files.length} files to move...`);
  
  // Move each file
  const movePromises = files.map(async (file) => {
    const oldPath = file.name;
    // Replace the old prefix with the new prefix
    const newPath = oldPath.replace(new RegExp(`^${escapeRegExp(oldPrefix)}`), newPrefix);
    
    try {
      const destinationFile = bucket.file(newPath);
      await file.copy(destinationFile);
      await file.delete();
      console.log(`Moved: ${oldPath} → ${newPath}`);
    } catch (error) {
      console.error(`Failed to move ${oldPath}: ${error.message}`);
      throw error;
    }
  });
  
  // Wait for all moves to complete
  await Promise.all(movePromises);
  
  console.log(`Successfully moved ${files.length} files from prefix '${oldPrefix}' to '${newPrefix}'.`);
}

/**
 * Helper function to escape special regex characters in a string
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
  // Replace each special regex character with its escaped version
  return string
    .replace(/\\/g, '\\\\')  // Backslash must be first
    .replace(/\./g, '\\.')   // Dot
    .replace(/\*/g, '\\*')   // Asterisk
    .replace(/\+/g, '\\+')   // Plus
    .replace(/\?/g, '\\?')   // Question mark
    .replace(/\^/g, '\\^')   // Caret
    .replace(/\$/g, '\\$')   // Dollar sign
    .replace(/\{/g, '\\{')   // Opening brace
    .replace(/\}/g, '\\}')   // Closing brace
    .replace(/\(/g, '\\(')   // Opening parenthesis
    .replace(/\)/g, '\\)')   // Closing parenthesis
    .replace(/\|/g, '\\|')   // Pipe
    .replace(/\[/g, '\\[')   // Opening bracket
    .replace(/\]/g, '\\]');  // Closing bracket
}

/**
 * @param {string} bucketName
 * @param {string} cloudPathPrefix
 */
async function removeFilesByPrefix(bucketName, cloudPathPrefix) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!cloudPathPrefix) {
    throw new Error("Cloud path prefix is required.");
  }
  await storage.bucket(bucketName).deleteFiles({ prefix: cloudPathPrefix });
  console.log(`Files with prefix '${cloudPathPrefix}' deleted successfully.`);
}

/**
 * 
 * @param {string} bucketName
 * @param {string} srcLocalPath
 * @param {string} destCloudPath
 */
async function uploadToBucket(bucketName, srcLocalPath, destCloudPath) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!srcLocalPath) {
    throw new Error("Source local path is required.");
  }
  if (!destCloudPath) {
    throw new Error("Destination cloud path is required.");
  }
  await storage.bucket(bucketName).upload(srcLocalPath, {
    destination: destCloudPath,
  });
  console.log(`${srcLocalPath} uploaded to ${destCloudPath}.`);
}

/**
 * 
 * @param {string} bucketName
 * @param {string} srcLocalPath
 * @param {string} destCloudPath
 */
async function downloadFromBucket(bucketName, srcLocalPath, destCloudPath) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!srcLocalPath) {
    throw new Error("Source cloud path is required.");
  }
  if (!destCloudPath) {
    throw new Error("Destination local path is required.");
  }
  const options = {
    destination: destCloudPath,
  };
  await storage.bucket(bucketName).file(srcLocalPath).download(options);
  console.log(`${srcLocalPath} saved as ${destCloudPath}.`);
}

/**
 * @param {string} execFile
 */
function showHelpText(execFile) {

  const cwdAbsolute = process.cwd();
  const execFileAbsolute = path.resolve(cwdAbsolute, execFile);
  const execFileRelative = path.relative(cwdAbsolute, execFileAbsolute);

  console.error(`\nUsage: node ${execFileRelative} <bucketName> <command> [args]`);
  console.error("Commands:");
  console.error("  ls       [prefix]        List files in the bucket with the given prefix");
  console.error("  count    [prefix]        Count files in the bucket with the given prefix");
  console.error("  rm       [fullName]      Remove the file or folder with the given name");
  console.error("  rmp      [prefix]        Remove files or folders with the given prefix");
  console.error("  mv       [old] [new]     Move the file from old to new");
  console.error("  mvp      [old] [new]     Move all files or folders with prefix from old to new");
  console.error("  upload   [local] [cloud] Copy a local file to the bucket");
  console.error("  download [cloud] [local] Copy a file from the bucket to the local file system");
}

// Parse command line arguments
const [, execFile, bucketName, command, ...args] = process.argv;

if (!bucketName) {
  console.error("Bucket name is required");
  showHelpText(execFile);
  process.exit(1);
}

// Execute the specified command
async function executeCommand() {
  switch (command) {
    case "ls": {
      const [ prefix ] = args;
      await listFiles(bucketName, prefix);
      break;
    }
    case "count": {
      const [ prefix ] = args;
      await countFiles(bucketName, prefix);
      break;
    }
    case "rm": {
      const [ path ] = args;
      await removeFile(bucketName, path);
      break;
    }
    case "mv": {
      const [ oldPath, newPath ] = args;
      await moveFile(bucketName, oldPath, newPath);
      break;
    }
    case "mvp": {
      const [ oldPrefix, newPrefix ] = args;
      await moveByPrefix(bucketName, oldPrefix, newPrefix);
      break;
    }
    case "rmp": {
      const [ prefix ] = args;
      await removeFilesByPrefix(bucketName, prefix);
      break;
    }
    case "upload": {
      const [ srcLocalPath, destCloudPath ] = args;
      await uploadToBucket(bucketName, srcLocalPath, destCloudPath);
      break;
    }
    case "download": {
      const [ srcCloudPath, destLocalPath ] = args;
      await downloadFromBucket(bucketName, srcCloudPath, destLocalPath);
      break;
    }
    default:
      console.error("Invalid command");
      showHelpText(execFile);
      process.exit(1);
  }
}

executeCommand().catch((err) => {
  console.error(err);
  process.exit(1);
});
