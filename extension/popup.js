/**
 * Claude Skills Sync — Popup
 *
 * 1. User picks their skills folder (File System Access API)
 * 2. Extension scans for SKILL.md in each subfolder
 * 3. Click "Sync All" → zips each skill → uploads to Claude.ai
 */

// DOM
const $folderPath = document.getElementById("folderPath");
const $btnFolder = document.getElementById("btnFolder");
const $skillsList = document.getElementById("skillsList");
const $skillsCount = document.getElementById("skillsCount");
const $btnSync = document.getElementById("btnSync");
const $progress = document.getElementById("progress");
const $progressFill = document.getElementById("progressFill");
const $progressLabel = document.getElementById("progressLabel");
const $toast = document.getElementById("toast");

let skills = []; // [{ name, handle (DirectoryHandle), files: [{path, handle}] }]
let rootHandle = null;

// ── Folder Picker ──

$btnFolder.addEventListener("click", async () => {
  try {
    rootHandle = await window.showDirectoryPicker({ mode: "read" });
    $folderPath.textContent = rootHandle.name;
    $folderPath.classList.remove("empty");

    await scanSkills();
  } catch (err) {
    if (err.name !== "AbortError") {
      showToast("Could not access folder", "error");
    }
  }
});

// ── Scan Skills ──

async function scanSkills() {
  skills = [];

  for await (const [name, handle] of rootHandle.entries()) {
    // Skip hidden folders/files
    if (name.startsWith(".")) continue;
    if (handle.kind !== "directory") continue;

    // Check if it has a SKILL.md
    try {
      await handle.getFileHandle("SKILL.md");
    } catch {
      continue; // No SKILL.md, skip
    }

    // Collect all files in the skill folder (recursive)
    const files = await collectFiles(handle, name);
    skills.push({ name, handle, files });
  }

  // Sort alphabetically
  skills.sort((a, b) => a.name.localeCompare(b.name));

  renderSkills();
}

async function collectFiles(dirHandle, basePath) {
  const files = [];

  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith(".")) continue;

    const fullPath = `${basePath}/${name}`;

    if (handle.kind === "file") {
      files.push({ path: fullPath, handle });
    } else if (handle.kind === "directory") {
      const subFiles = await collectFiles(handle, fullPath);
      files.push(...subFiles);
    }
  }

  return files;
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
        const file = await f.handle.getFile();
        const content = await file.arrayBuffer();
        // Path relative to skill folder: remove "skillName/" prefix
        const relativePath = f.path.substring(skill.name.length + 1);
        folder.file(relativePath, content);
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
