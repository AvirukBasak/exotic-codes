import { Storage } from "@google-cloud/storage";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the credentials from the JSON key file
const keyFilename = path.join(
  __dirname,
  "creds.json"
);
const storage = new Storage({ keyFilename });

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
 * @param {string} cloudPathPrefix
 */
async function removeFilesByPrefix(bucketName, cloudPathPrefix) {
  if (!bucketName) {
    throw new Error("Bucket name is required.");
  }
  if (!cloudPathPrefix) {
    throw new Error("Cloud path prefix is required.");
  }
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: cloudPathPrefix });
  const delPromises = [];
  if (files.length === 0) {
    console.log(`No files found with prefix '${cloudPathPrefix}'.`);
  } else {
    for (const file of files) {
      delPromises.push(
        file
          .delete()
          .then(() => {
            console.log(`${file.name} deleted successfully.`);
          })
          .catch((err) => {
            console.error(`Error deleting ${file.name}:`, err.toString());
          })
      );
    }
  }
  await Promise.allSettled(delPromises);
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
  console.error("  rm       [fullName]      Remove the file or folder with the given name");
  console.error("  rmp      [prefix]        Remove files or folders with the given prefix");
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
    case "rm": {
      const [ path ] = args;
      await removeFile(bucketName, path);
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
  console.error(err.toString());
  process.exit(1);
});
