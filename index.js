import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { getContext } from "../../../extensions.js";
import { hideChatMessageRange } from "../../../chats.js";

const extensionName = "hide-helper";
const defaultSettings = {
    hideLastN: 0,
    lastAppliedSettings: null
};

// Initialize extension settings
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// Create UI panel
function createUI() {
    const hideHelperPanel = document.createElement('div');
    hideHelperPanel.id = 'hide-helper-panel';
    hideHelperPanel.innerHTML = `
        <h4>隐藏助手</h4>
        <div class="hide-helper-section">
            <label for="hide-last-n">隐藏楼层:</label>
            <input type="number" id="hide-last-n" min="0" placeholder="隐藏最后N层之前的消息">
            <div class="hide-helper-buttons">
                <button id="hide-apply-btn">应用</button>
            </div>
        </div>
        <button class="save-settings-btn" id="hide-save-settings-btn">保存当前设置</button>
    `;
    document.body.appendChild(hideHelperPanel);

    // Setup event listeners
    setupEventListeners();
}

// Setup event listeners for UI elements
function setupEventListeners() {
    // Last N hide input
    const hideLastNInput = document.getElementById('hide-last-n');
    hideLastNInput.value = extension_settings[extensionName].hideLastN || '';
    hideLastNInput.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) || 0;
        extension_settings[extensionName].hideLastN = value;
        saveSettingsDebounced();
    });

    // Apply button
    document.getElementById('hide-apply-btn').addEventListener('click', applyHideSettings);

    // Save settings button
    document.getElementById('hide-save-settings-btn').addEventListener('click', saveCurrentSettings);

    // Listen for new messages to reapply settings if needed
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (extension_settings[extensionName].lastAppliedSettings) {
            applyLastSettings();
        }
    });
}

// Apply hide settings based on "hide last N" option
async function applyHideSettings() {
    const context = getContext();
    const chatLength = context.chat?.length || 0;
    
    if (chatLength === 0) return;
    
    const hideLastN = extension_settings[extensionName].hideLastN || 0;
    
    if (hideLastN > 0 && hideLastN < chatLength) {
        const visibleStart = chatLength - hideLastN;
        // First unhide all messages
        await hideChatMessageRange(0, chatLength - 1, true);
        // Then hide the range we want to hide
        await hideChatMessageRange(0, visibleStart - 1, false);
        
        extension_settings[extensionName].lastAppliedSettings = {
            type: 'lastN',
            value: hideLastN
        };
        saveSettingsDebounced();
    } else if (hideLastN === 0) {
        // Unhide all messages
        await hideChatMessageRange(0, chatLength - 1, true);
        extension_settings[extensionName].lastAppliedSettings = null;
        saveSettingsDebounced();
    }
}

// Save current settings
function saveCurrentSettings() {
    const hideLastN = extension_settings[extensionName].hideLastN || 0;
    
    if (hideLastN >= 0) {
        applyHideSettings();
    }
    
    toastr.success('隐藏设置已保存并应用');
}

// Apply last saved settings
async function applyLastSettings() {
    const lastSettings = extension_settings[extensionName].lastAppliedSettings;
    
    if (!lastSettings) return;
    
    if (lastSettings.type === 'lastN') {
        await applyHideSettings();
    }
}

// Initialize extension
jQuery(async () => {
    loadSettings();
    createUI();
    
    // Apply last settings if any
    if (extension_settings[extensionName].lastAppliedSettings) {
        setTimeout(applyLastSettings, 1000); // Slight delay to ensure chat is loaded
    }
});
