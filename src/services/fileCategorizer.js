const path = require('path');
const crypto = require('crypto');

const PILES_FOLDER_NAME = 'Raccoon Piles';

const CATEGORY_DEFINITIONS = [
  {
    categoryName: 'Images',
    cuteLabel: 'shiny picture pile',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'heic']
  },
  {
    categoryName: 'Documents',
    cuteLabel: 'paper pile',
    extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'md', 'csv', 'xls', 'xlsx', 'ppt', 'pptx']
  },
  {
    categoryName: 'Archives',
    cuteLabel: 'zip snack pile',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz']
  },
  {
    categoryName: 'Installers',
    cuteLabel: 'installer snacks',
    extensions: ['exe', 'msi', 'msix', 'appx']
  },
  {
    categoryName: 'Audio',
    cuteLabel: 'sound crumbs',
    extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg']
  },
  {
    categoryName: 'Video',
    cuteLabel: 'movie crumbs',
    extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv']
  },
  {
    categoryName: 'Code',
    cuteLabel: 'code scraps',
    extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'cs', 'java', 'cpp', 'c', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'sql']
  },
  {
    categoryName: 'Other',
    cuteLabel: 'mystery crumbs',
    extensions: []
  }
];

const TEMPORARY_EXTENSIONS = new Set(['crdownload', 'tmp', 'part', 'download']);

const EXTENSION_TO_CATEGORY = new Map();

for (const definition of CATEGORY_DEFINITIONS) {
  for (const extension of definition.extensions) {
    EXTENSION_TO_CATEGORY.set(extension, definition);
  }
}

function getExtension(fileName) {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase();
  return extension;
}

function isTemporaryDownload(fileName) {
  return TEMPORARY_EXTENSIONS.has(getExtension(fileName));
}

function isHiddenFileName(fileName) {
  return fileName.startsWith('.') || fileName.toLowerCase() === 'desktop.ini';
}

function categorizeFileName(fileName) {
  const extension = getExtension(fileName);
  return EXTENSION_TO_CATEGORY.get(extension) || CATEGORY_DEFINITIONS[CATEGORY_DEFINITIONS.length - 1];
}

function getDestinationFolder(watchedFolder, ...destinationParts) {
  return path.join(watchedFolder, PILES_FOLDER_NAME, ...destinationParts.filter(Boolean));
}

function makeCategoryBuckets(watchedFolder) {
  return CATEGORY_DEFINITIONS.map((definition) => ({
    categoryName: definition.categoryName,
    cuteLabel: definition.cuteLabel,
    destinationFolder: getDestinationFolder(watchedFolder, definition.categoryName),
    fileCount: 0,
    totalBytes: 0,
    files: []
  }));
}

function createFileId(fullPath, stats) {
  return crypto
    .createHash('sha1')
    .update(path.resolve(fullPath).toLowerCase())
    .update(String(stats.size))
    .update(String(stats.mtimeMs))
    .digest('hex');
}

module.exports = {
  CATEGORY_DEFINITIONS,
  PILES_FOLDER_NAME,
  TEMPORARY_EXTENSIONS,
  categorizeFileName,
  createFileId,
  getDestinationFolder,
  getExtension,
  isHiddenFileName,
  isTemporaryDownload,
  makeCategoryBuckets
};
