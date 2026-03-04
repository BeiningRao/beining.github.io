/* global Zotero, PathUtils, IOUtils */

const PREF_BRANCH = "extensions.zotero-auto-ingest-organizer.";
const VERSION = "0.2.2";

const DEFAULTS = {
  enabled: true,
  scanIntervalSec: 30,
  downloadDir: PathUtils.join(PathUtils.homeDir, "Downloads"),
  metadataProvider: "crossref", // crossref | none
  summarySentences: 3,
  classifyRulesJSON: JSON.stringify({
    llm: "AI/LLM",
    "large language": "AI/LLM",
    transformer: "AI/NLP",
    nlp: "AI/NLP",
    multimodal: "AI/Multimodal",
    graph: "Graph/GNN",
    gnn: "Graph/GNN",
    medical: "Medical/Clinical",
    biomedical: "Medical/Clinical",
    vision: "CV",
    diffusion: "CV/Generation"
  })
};

const SUPPORTED_EXTENSIONS = new Set(["pdf"]);

let timerId = null;
let observerId = null;

function getPref(key, fallback) {
  try {
    const value = Zotero.Prefs.get(PREF_BRANCH + key, true);
    return value === undefined || value === null ? fallback : value;
  } catch (_err) {
    return fallback;
  }
}

function setPref(key, value) {
  Zotero.Prefs.set(PREF_BRANCH + key, value, true);
}

function ensureDefaultPrefs() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (getPref(key, null) === null) {
      setPref(key, value);
    }
  }
}

function getDownloadDir() {
  return String(getPref("downloadDir", DEFAULTS.downloadDir));
}

function getScanInterval() {
  return Number(getPref("scanIntervalSec", DEFAULTS.scanIntervalSec)) || DEFAULTS.scanIntervalSec;
}

function getMetadataProvider() {
  return String(getPref("metadataProvider", DEFAULTS.metadataProvider)).toLowerCase();
}

function getSummarySentenceCount() {
  const count = Number(getPref("summarySentences", DEFAULTS.summarySentences));
  return Number.isFinite(count) && count > 0 ? Math.min(count, 10) : DEFAULTS.summarySentences;
}

function getClassificationMap() {
  const raw = String(getPref("classifyRulesJSON", DEFAULTS.classifyRulesJSON));
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("classifyRulesJSON 不是对象");
    }

    const cleanedMap = {};
    for (const [keyword, path] of Object.entries(parsed)) {
      if (!keyword || typeof keyword !== "string") continue;
      if (!path || typeof path !== "string") continue;
      cleanedMap[keyword.toLowerCase().trim()] = path
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
        .join("/");
    }
    return cleanedMap;
  } catch (err) {
    Zotero.logError(`[auto-ingest] classifyRulesJSON 解析失败，使用默认规则: ${err}`);
    return JSON.parse(DEFAULTS.classifyRulesJSON);
  }
}

async function startup() {
  Zotero.debug(`[auto-ingest] startup v${VERSION}`);
  ensureDefaultPrefs();

  observerId = Zotero.Notifier.registerObserver(
    {
      async notify(action, type, ids) {
        if (action !== "add" || type !== "item") return;
        for (const id of ids) {
          const item = await Zotero.Items.getAsync(id);
          if (item?.isRegularItem()) {
            await processItem(item);
          }
        }
      }
    },
    ["item"],
    "auto-ingest-organizer-observer"
  );

  await scanAndImportDownloads();
  timerId = setInterval(scanAndImportDownloads, getScanInterval() * 1000);
}

function shutdown() {
  Zotero.debug("[auto-ingest] shutdown");
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  if (observerId) {
    Zotero.Notifier.unregisterObserver(observerId);
    observerId = null;
  }
}

async function processItem(item) {
  await enrichItemByMetadata(item);
  await autoClassifyItem(item);
  await createSummaryNote(item);
}

async function scanAndImportDownloads() {
  if (!getPref("enabled", DEFAULTS.enabled)) return;

  const dir = getDownloadDir();
  const importedSet = new Set(safeParseJSONArray(getPref("importedFiles", "[]")));

  let entries = [];
  try {
    entries = await IOUtils.getChildren(dir);
  } catch (err) {
    Zotero.logError(`[auto-ingest] 无法读取下载目录: ${dir} -> ${err}`);
    return;
  }

  for (const path of entries) {
    const ext = path.split(".").pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    if (importedSet.has(path)) continue;

    try {
      const attachment = await Zotero.Attachments.importFromFile({
        file: path,
        libraryID: Zotero.Libraries.userLibraryID
      });

      let parent = attachment.parentItemID ? await Zotero.Items.getAsync(attachment.parentItemID) : null;
      if (!parent) {
        parent = new Zotero.Item("journalArticle");
        parent.setField("title", fileNameToTitle(path));
        await parent.saveTx();
        attachment.parentID = parent.id;
        await attachment.saveTx();
      }

      await processItem(parent);
      importedSet.add(path);
    } catch (err) {
      Zotero.logError(`[auto-ingest] 导入失败: ${path} -> ${err}`);
    }
  }

  setPref("importedFiles", JSON.stringify([...importedSet]));
}

function safeParseJSONArray(raw) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function fileNameToTitle(path) {
  const name = path.split("/").pop()?.replace(/\.pdf$/i, "") || "Untitled";
  return name.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

async function enrichItemByMetadata(item) {
  const provider = getMetadataProvider();
  if (provider === "none") return;

  const title = item.getField("title")?.trim();
  if (!title) return;

  try {
    const query = encodeURIComponent(title);
    const response = await fetch(`https://api.crossref.org/works?query.title=${query}&rows=1`);
    if (!response.ok) return;

    const data = await response.json();
    const work = data?.message?.items?.[0];
    if (!work) return;

    const abstract = cleanupAbstract(work.abstract || "");
    const officialTitle = work.title?.[0]?.trim();
    const journal = work["container-title"]?.[0]?.trim();
    const doi = work.DOI?.trim();

    if (officialTitle && officialTitle.length > title.length / 2) {
      item.setField("title", officialTitle);
    }
    if (abstract && !item.getField("abstractNote")) {
      item.setField("abstractNote", abstract);
    }
    if (journal && !item.getField("publicationTitle")) {
      item.setField("publicationTitle", journal);
    }
    if (doi && !item.getField("DOI")) {
      item.setField("DOI", doi);
    }

    await item.saveTx();
  } catch (err) {
    Zotero.logError(`[auto-ingest] 元数据补全失败: ${title} -> ${err}`);
  }
}

function cleanupAbstract(abstract) {
  return String(abstract || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function autoClassifyItem(item) {
  const classificationMap = getClassificationMap();
  const content = `${item.getField("title") || ""} ${item.getField("abstractNote") || ""}`.toLowerCase();
  if (!content.trim()) return;

  const collectionPaths = new Set();
  for (const [keyword, pathString] of Object.entries(classificationMap)) {
    if (content.includes(keyword)) {
      collectionPaths.add(pathString);
    }
  }

  for (const pathStr of collectionPaths) {
    if (!pathStr) continue;
    const collection = await ensureCollectionPath(pathStr);
    if (!item.inCollection(collection.id)) {
      item.addToCollection(collection.id);
    }
  }

  if (collectionPaths.size > 0) {
    await item.saveTx();
  }
}

async function ensureCollectionPath(pathStr) {
  const parts = pathStr.split("/").filter(Boolean);
  let parentID = null;
  let current = null;

  for (const name of parts) {
    const collections = Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID);
    current = collections.find((c) => c.name === name && c.parentID === parentID);

    if (!current) {
      current = new Zotero.Collection();
      current.libraryID = Zotero.Libraries.userLibraryID;
      current.name = name;
      current.parentID = parentID;
      await current.saveTx();
    }

    parentID = current.id;
  }

  return current;
}

async function createSummaryNote(item) {
  const abstract = item.getField("abstractNote")?.trim();
  if (!abstract) return;

  const sentenceCount = getSummarySentenceCount();
  const firstSentences = abstract
    .split(/(?<=[.!?。！？])\s+/)
    .slice(0, sentenceCount)
    .join(" ");

  const noteText = [
    `<h2>自动摘要</h2>`,
    `<p>${escapeHtml(firstSentences || abstract)}</p>`,
    `<h3>关键信息</h3>`,
    `<ul>`,
    `<li><b>标题：</b>${escapeHtml(item.getField("title") || "")}</li>`,
    `<li><b>来源：</b>${escapeHtml(item.getField("publicationTitle") || "待补全")}</li>`,
    `<li><b>DOI：</b>${escapeHtml(item.getField("DOI") || "待补全")}</li>`,
    `</ul>`
  ].join("\n");

  const existingNotes = item.getNotes();
  for (const noteID of existingNotes) {
    const note = await Zotero.Items.getAsync(noteID);
    if (note?.getNote()?.includes("<h2>自动摘要</h2>")) {
      return;
    }
  }

  const note = new Zotero.Item("note");
  note.libraryID = item.libraryID;
  note.parentID = item.id;
  note.setNote(noteText);
  await note.saveTx();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.startup = startup;
window.shutdown = shutdown;
