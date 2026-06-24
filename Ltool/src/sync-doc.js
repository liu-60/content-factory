import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { markdownToHtml, htmlToPlainText } from './markdown.js';

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm', '.txt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function resolveSyncDocDir(dirArg, root = process.cwd()) {
  if (dirArg) return resolve(dirArg);
  return resolve(root, 'sync-doc');
}

export function collectSyncDocs(dir) {
  if (!existsSync(dir)) throw new Error(`sync-doc directory not found: ${dir}`);
  const files = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(dir, entry.name));
  const cover = findCoverImage(dir);
  return files
    .filter((file) => DOC_EXTENSIONS.has(extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((filePath) => parseDocument(filePath, cover));
}

export function parseDocument(filePath, folderCover) {
  const ext = extname(filePath).toLowerCase();
  const raw = readFileSync(filePath, 'utf8');
  const dir = dirname(filePath);
  const title = titleFromFileName(filePath);
  const markdown = ext === '.html' || ext === '.htm' ? undefined : convertLocalImagesToDataUris(raw, dir);
  const html = ext === '.html' || ext === '.htm' ? convertLocalImagesToDataUris(raw, dir) : markdownToHtml(markdown);
  const coverPath = folderCover || firstReferencedImage(raw, dir);
  const cover = coverPath ? readImageDataUri(coverPath) : undefined;
  return {
    filePath,
    title,
    coverPath,
    article: {
      sourcePath: filePath,
      title,
      markdown,
      html,
      content: html,
      text: htmlToPlainText(html),
      cover,
      coverPath,
      coverSource: coverPath ? 'folder-image-data-uri' : 'none',
    },
  };
}

export function titleFromFileName(filePath) {
  return basename(filePath, extname(filePath)).trim();
}

export function findCoverImage(dir) {
  const images = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(dir, entry.name));
  if (!images.length) return null;
  return images.find((file) => /cover|封面|thumb|thumbnail/i.test(basename(file))) || images.sort((a, b) => a.localeCompare(b))[0];
}

export function readImageDataUri(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return undefined;
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
}

export function convertLocalImagesToDataUris(content, baseDir) {
  return String(content)
    .replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (full, prefix, imgPath, suffix) => {
      if (/^(https?:|data:)/i.test(imgPath)) return full;
      const imagePath = resolve(baseDir, imgPath);
      const dataUri = existsSync(imagePath) ? readImageDataUri(imagePath) : '';
      return dataUri ? `${prefix}${dataUri}${suffix}` : full;
    })
    .replace(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (full, prefix, imgPath, suffix) => {
      if (/^(https?:|data:)/i.test(imgPath)) return full;
      const imagePath = resolve(baseDir, imgPath);
      const dataUri = existsSync(imagePath) ? readImageDataUri(imagePath) : '';
      return dataUri ? `${prefix}${dataUri}${suffix}` : full;
    });
}

function firstReferencedImage(content, baseDir) {
  const match = String(content).match(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/i);
  const ref = match?.[1] || match?.[2];
  if (!ref || /^(https?:|data:)/i.test(ref)) return null;
  const filePath = resolve(baseDir, ref);
  return existsSync(filePath) ? filePath : null;
}

export function formatDocSummary(doc) {
  return [`- ${basename(doc.filePath)}`, `title="${doc.article.title}"`, `coverSource=${doc.article.coverSource}`, doc.coverPath ? `cover=${basename(doc.coverPath)}` : ''].filter(Boolean).join(' ');
}
