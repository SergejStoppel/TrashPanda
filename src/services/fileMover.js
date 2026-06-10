const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PILES_FOLDER_NAME } = require('./fileCategorizer');

function normalizeForCompare(value) {
  return path.resolve(value).toLowerCase();
}

function isDirectChildOfFolder(filePath, folderPath) {
  return normalizeForCompare(path.dirname(filePath)) === normalizeForCompare(folderPath);
}

function isInsideRaccoonPiles(filePath, watchedFolder) {
  const pilesRoot = normalizeForCompare(path.join(watchedFolder, PILES_FOLDER_NAME));
  const resolvedFile = normalizeForCompare(filePath);
  return resolvedFile === pilesRoot || resolvedFile.startsWith(`${pilesRoot}${path.sep}`);
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getUniqueDestination(destinationFolder, fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);

  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? '' : ` ${index}`;
    const candidate = path.join(destinationFolder, `${baseName}${suffix}${extension}`);

    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error('Could not find an unused destination name.');
}

async function moveFiles({ files, watchedFolder }) {
  const moves = [];
  let movedCount = 0;
  let skippedCount = 0;
  let totalBytesMoved = 0;

  for (const file of files) {
    const sourcePath = file.fullPath;
    const destinationFolder = file.destinationFolder;

    const moveRecord = {
      sourcePath,
      destinationPath: null,
      fileName: file.fileName,
      categoryName: file.categoryName,
      sizeBytes: file.sizeBytes,
      status: 'skipped',
      errorMessage: null
    };

    try {
      if (!sourcePath || !destinationFolder) {
        throw new Error('Missing source or destination.');
      }

      if (!isDirectChildOfFolder(sourcePath, watchedFolder)) {
        throw new Error('Source is not a direct child of the watched folder.');
      }

      if (isInsideRaccoonPiles(sourcePath, watchedFolder)) {
        throw new Error('Source is already inside Raccoon Piles.');
      }

      const currentStats = await fsp.stat(sourcePath);

      if (!currentStats.isFile()) {
        throw new Error('Source is no longer a file.');
      }

      await fsp.mkdir(destinationFolder, { recursive: true });
      const destinationPath = await getUniqueDestination(destinationFolder, file.fileName);
      await fsp.rename(sourcePath, destinationPath);

      moveRecord.destinationPath = destinationPath;
      moveRecord.status = 'moved';
      moveRecord.sizeBytes = currentStats.size;
      movedCount += 1;
      totalBytesMoved += currentStats.size;
    } catch (error) {
      skippedCount += 1;
      moveRecord.errorMessage = error.message;
    }

    moves.push(moveRecord);
  }

  return {
    movedCount,
    skippedCount,
    totalBytesMoved,
    moves
  };
}

module.exports = {
  getUniqueDestination,
  moveFiles
};
