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

// Function to list files in a bucket
async function listFiles(bucketName, prefix = "") {
  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
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

// Function to remove a file or folder from a bucket
async function removeFileOrFolder(bucketName, filename) {
  const file = storage.bucket(bucketName).file(filename);
  await file.delete();
  console.log(`${filename} deleted successfully.`);
}

// Function to remove files or folders by prefix
async function removeFilesByPrefix(bucketName, prefix) {
  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
  const delPromises = [];
  if (files.length === 0) {
    console.log(`No files found with prefix '${prefix}'.`);
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

// Function to copy a local file to a bucket
async function copyToLocal(bucketName, srcFilename, destFilename) {
  await storage.bucket(bucketName).upload(srcFilename, {
    destination: destFilename,
  });
  console.log(`${srcFilename} uploaded to ${destFilename}.`);
}

// Parse command line arguments
const [, , bucketName, command, ...args] = process.argv;

// Execute the specified command
async function executeCommand() {
  switch (command) {
    case "ls":
      await listFiles(bucketName, ...args);
      break;
    case "rm":
      await removeFileOrFolder(bucketName, ...args);
      break;
    case "rmp":
      await removeFilesByPrefix(bucketName, ...args);
      break;
    case "cp":
      await copyToLocal(bucketName, ...args);
      break;
    default:
      console.error("Invalid command");
      console.error("Usage: node gfs.js <bucketName> <command> [args]");
      console.error("Commands:");
      console.error(
        "  ls  [prefix]        List files in the bucket with the given prefix"
      );
      console.error(
        "  rm  [fullName]      Remove the file or folder with the given name"
      );
      console.error(
        "  rmp [prefix]        Remove files or folders with the given prefix"
      );
      console.error("  cp  [local] [cloud] Copy a local file to the bucket");
      process.exit(1);
  }
}

await executeCommand();
