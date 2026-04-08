/**
 * Claude Skills Sync — Popup
 *
 * 1. User picks their skills folder via <input type="file" webkitdirectory>
 * 2. Extension scans for SKILL.md in each top-level subfolder
 * 3. Click "Sync All" → zips each skill → uploads to Claude.ai
 *
 * Why webkitdirectory instead of File System Access API?
 *   showDirectoryPicker() is gated/disabled in Brave (and some other Chromium
 *   forks) and even when enabled it dismisses the action popup on focus loss.
 *   <input webkitdirectory> works in every Chromium browser with no flags.
 */

// DOM
const $folderPath = document.getElementById("folderPath");
const $btnFolder = document.getElementById("btnFolder");
const $folderInput = document.getElementById("folderInput");
const $skillsList = document.getElementById("skillsList");
const $skillsCount = document.getElementById("skillsCount");
const $btnSync = document.getElementById("btnSync");
const $progress = document.getElementById("progress");
const $progressFill = document.getElementById("progressFill");
const $progressLabel = document.getElementById("progressLabel");
const $toast = document.getElementById("toast");

let skills = []; // [{ name, files: [{ relativePath, file }] }]

// ── Platform-aware default path hint ──

(function setDefaultPathHint() {
  const hint = document.getElementById("defaultPathHint");
  if (!hint) return;
  const isWindows = /Win/i.test(navigator.platform) ||
    (navigator.userAgentData && navigator.userAgentData.platform === "Windows");
  hint.textContent = isWindows
    ? "%USERPROFILE%\\.claude\\skills"
    : "~/.claude/skills";
})();

// ── Folder Picker ──

$btnFolder.addEventListener("click", () => {
  // Reset so picking the same folder twice still fires `change`.
  $folderInput.value = "";
  $folderInput.click();
});

$folderInput.addEventListener("change", () => {
  const fileList = $folderInput.files;
  if (!fileList || fileList.length === 0) return;

  try {
    scanSkills(fileList);
  } catch (err) {
    console.error("Folder scan failed:", err);
    showToast(`Could not read folder: ${err.message || err}`, "error");
  }
});

// ── Scan Skills ──

function scanSkills(fileList) {
  // Each File has a `webkitRelativePath` like "skills/my-skill/SKILL.md".
  // The first path segment is the folder the user picked; we group by the
  // *second* segment (the skill folder name).
  const filesArr = Array.from(fileList);

  // Determine the root folder name from the first file.
  const firstPath = filesArr[0].webkitRelativePath || "";
  const rootName = firstPath.split("/")[0] || "skills";

  $folderPath.textContent = rootName;
  $folderPath.classList.remove("empty");

  // Group files by top-level skill folder, skipping hidden entries.
  const groups = new Map(); // skillName -> [{ relativePath, file }]
  for (const file of filesArr) {
    const path = file.webkitRelativePath;
    if (!path) continue;
    const parts = path.split("/");
    if (parts.length < 3) continue; // need root/skill/file at minimum
    if (parts.some((p) => p.startsWith("."))) continue; // skip hidden

    const skillName = parts[1];
    const relativePath = parts.slice(2).join("/"); // path inside the skill folder

    if (!groups.has(skillName)) groups.set(skillName, []);
    groups.get(skillName).push({ relativePath, file });
  }

  // Keep only folders that contain a SKILL.md at their root.
  skills = [];
  for (const [name, files] of groups.entries()) {
    const hasSkillMd = files.some((f) => f.relativePath === "SKILL.md");
    if (!hasSkillMd) continue;
    skills.push({ name, files });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  renderSkills();
}

// ── Render ──

function renderSkills() {
  $skillsCount.textContent = `${skills.length} skill${skills.length !== 1 ? "s" : ""}`;

  if (skills.length === 0) {
    $skillsList.innerHTML = `
      <div class="empty-msg">
        <p>No skills with SKILL.md found</p>
      </div>
    `;
    $btnSync.disabled = true;
    return;
  }

  $skillsList.innerHTML = skills
    .map(
      (s) => `
    <div class="skill-item">
      <div class="skill-icon"></div>
      <div class="skill-name">${s.name}</div>
      <div class="skill-size">${s.files.length} file${s.files.length !== 1 ? "s" : ""}</div>
    </div>
  `
    )
    .join("");

  $btnSync.disabled = false;
  $btnSync.textContent = `Sync All ${skills.length} Skills to Claude.ai`;
}

// ── Sync ──

$btnSync.addEventListener("click", startSync);

async function startSync() {
  if (skills.length === 0) return;

  $btnSync.disabled = true;
  $progress.classList.add("active");

  let completed = 0;
  let failed = 0;

  for (const skill of skills) {
    $progressLabel.textContent = `Zipping ${skill.name}...`;
    $progressFill.style.width = `${(completed / skills.length) * 100}%`;

    try {
      // 1. Create ZIP in memory
      const zip = new JSZip();
      const folder = zip.folder(skill.name);

      for (const f of skill.files) {
        const content = await f.file.arrayBuffer();
        folder.file(f.relativePath, content);
      }

      const blob = await zip.generateAsync({ type: "blob" });

      // 2. Upload to Claude.ai via background script
      $progressLabel.textContent = `Uploading ${skill.name}...`;

      const base64 = await blobToBase64(blob);

      const response = await chrome.runtime.sendMessage({
        action: "uploadSkill",
        skillName: skill.name,
        zipBase64: base64,
      });

      if (response?.success) {
        completed++;
      } else {
        failed++;
        console.error(`Failed: ${skill.name}`, response?.error);
      }
    } catch (err) {
      failed++;
      console.error(`Error syncing ${skill.name}:`, err);
    }

    // Brief pause between uploads to not overwhelm the page
    await sleep(2000);
  }

  $progressFill.style.width = "100%";
  $progressLabel.textContent = "Done!";

  setTimeout(() => {
    $progress.classList.remove("active");
    $progressFill.style.width = "0%";

    if (failed === 0) {
      showToast(`✓ Synced ${completed} skill${completed !== 1 ? "s" : ""} to Claude.ai`, "success");
    } else {
      showToast(`Synced ${completed}, failed ${failed}`, "warning");
    }

    $btnSync.disabled = false;
  }, 1200);
}


// ── Helpers ──

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showToast(text, type = "success") {
  $toast.textContent = text;
  $toast.className = `toast show ${type}`;
  setTimeout(() => ($toast.className = "toast"), 5000);
}
