/**
 * Claude Skills Sync — Background Service Worker
 *
 * Receives ZIP blobs from popup, opens Claude.ai skills page,
 * injects a content script, and uploads via the file input.
 */

const CLAUDE_SKILLS_URL = "https://claude.ai/customize/skills";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "uploadSkill") {
    handleUpload(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

});

async function handleUpload({ skillName, zipBase64 }) {
  try {
    // 1. Find or open Claude.ai skills settings tab
    let tab = await findClaudeSkillsTab();

    if (!tab) {
      tab = await chrome.tabs.create({ url: CLAUDE_SKILLS_URL, active: false });
      await waitForTabLoad(tab.id);
      await sleep(3000);
    } else if (!tab.url.includes("/customize/skills")) {
      // Tab exists but is on a different Claude page — navigate it
      await chrome.tabs.update(tab.id, { url: CLAUDE_SKILLS_URL });
      await waitForTabLoad(tab.id);
      await sleep(3000);
    }

    // 2. Inject content script and upload
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: uploadZipToClaudeAI,
      args: [skillName, zipBase64],
    });

    const result = results?.[0]?.result;
    return result || { success: false, error: "No result from content script" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// This function runs IN the Claude.ai page context
function uploadZipToClaudeAI(skillName, zipBase64) {
  return new Promise((resolve) => {
    try {
      // Convert base64 to File
      const byteChars = atob(zipBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "application/zip" });
      const file = new File([blob], `${skillName}.zip`, {
        type: "application/zip",
      });

      // Strategy 1: Find existing file input
      let fileInput = document.querySelector('input[type="file"]');

      if (!fileInput) {
        // Strategy 2: Click the "+" / "Upload" button to reveal file input
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
          const text = btn.textContent.trim().toLowerCase();
          const label = (btn.getAttribute("aria-label") || "").toLowerCase();
          if (
            text === "+" ||
            text.includes("upload") ||
            text.includes("add") ||
            label.includes("upload") ||
            label.includes("add skill")
          ) {
            btn.click();
            break;
          }
        }

        // Wait for file input to appear
        setTimeout(() => {
          fileInput = document.querySelector('input[type="file"]');
          if (fileInput) {
            setFileAndDispatch(fileInput, file);
            resolve({ success: true, skillName });
          } else {
            resolve({
              success: false,
              error: "No file input found after clicking upload button",
            });
          }
        }, 1000);
        return;
      }

      setFileAndDispatch(fileInput, file);
      resolve({ success: true, skillName });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }

    function setFileAndDispatch(input, f) {
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files"
      );
      if (nativeInputValueSetter?.set) {
        nativeInputValueSetter.set.call(input, dt.files);
      }

      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}


async function findClaudeSkillsTab() {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  // Prefer a tab already on the skills page
  const skillsTab = tabs.find((t) => t.url.includes("/customize/skills"));
  if (skillsTab) return skillsTab;
  // Otherwise any Claude tab
  return tabs[0] || null;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
