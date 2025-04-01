import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { getContext } from "../../../extensions.js";
import { hideChatMessageRange } from "../../../chats.js";

const extensionName = "hide-helper";
const defaultSettings = {
    // 保留全局默认设置用于向后兼容
    hideLastN: 0,
    lastAppliedSettings: null
};

// 初始化扩展设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// 创建UI面板
function createUI() {
    const hideHelperPanel = document.createElement('div');
    hideHelperPanel.id = 'hide-helper-panel';
    hideHelperPanel.innerHTML = `
        <h4>隐藏助手</h4>
        <div class="hide-helper-section">
            <label for="hide-last-n">隐藏楼层:</label>
            <input type="number" id="hide-last-n" min="0" placeholder="隐藏最后N层之前的消息">
            <div class="hide-helper-buttons">
                <button id="hide-save-settings-btn">保存设置</button>
            </div>
        </div>
        <div class="hide-helper-current">
            <strong>当前隐藏设置:</strong> <span id="hide-current-value">无</span>
        </div>
    `;
    document.body.appendChild(hideHelperPanel);

    // 设置事件监听器
    setupEventListeners();
}

// 获取当前角色/群组的隐藏设置
function getCurrentHideSettings() {
    const context = getContext();
    const isGroup = !!context.groupId;
    const target = isGroup 
        ? context.groups.find(x => x.id == context.groupId)
        : context.characters[context.characterId];
    
    if (!target) return null;
    
    // 检查是否有保存的设置
    if (target.data?.hideHelperSettings) {
        return target.data.hideHelperSettings;
    }
    
    // 没有则返回null
    return null;
}

// 保存当前角色/群组的隐藏设置
function saveCurrentHideSettings(hideLastN) {
    const context = getContext();
    const isGroup = !!context.groupId;
    const target = isGroup 
        ? context.groups.find(x => x.id == context.groupId)
        : context.characters[context.characterId];
    
    if (!target) return false;
    
    // 初始化data对象如果不存在
    target.data = target.data || {};
    target.data.hideHelperSettings = target.data.hideHelperSettings || {};
    
    // 保存设置
    target.data.hideHelperSettings.hideLastN = hideLastN;
    return true;
}

// 更新当前设置显示
function updateCurrentHideSettingsDisplay() {
    const currentSettings = getCurrentHideSettings();
    const displayElement = document.getElementById('hide-current-value');
    
    if (!currentSettings || currentSettings.hideLastN === 0) {
        displayElement.textContent = '无';
    } else {
        displayElement.textContent = currentSettings.hideLastN;
    }
}

// 设置UI元素的事件监听器
function setupEventListeners() {
    const hideLastNInput = document.getElementById('hide-last-n');
    
    // 监听输入变化
    hideLastNInput.addEventListener('input', (e) => {
        const value = parseInt(e.target.value) || 0;
        hideLastNInput.value = value >= 0 ? value : '';
    });

    // 保存设置按钮
    document.getElementById('hide-save-settings-btn').addEventListener('click', () => {
        const value = parseInt(hideLastNInput.value) || 0;
        if (saveCurrentHideSettings(value)) {
            applyHideSettings();
            updateCurrentHideSettingsDisplay();
            toastr.success('隐藏设置已保存');
        } else {
            toastr.error('无法保存设置');
        }
    });

    // 监听聊天切换事件
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const currentSettings = getCurrentHideSettings();
        hideLastNInput.value = currentSettings?.hideLastN || '';
        updateCurrentHideSettingsDisplay();
    });

    // 监听新消息事件
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        const currentSettings = getCurrentHideSettings();
        if (currentSettings?.hideLastN > 0) {
            applyHideSettings();
        }
    });
}

// 应用隐藏设置
async function applyHideSettings() {
    const context = getContext();
    const chatLength = context.chat?.length || 0;
    const currentSettings = getCurrentHideSettings();
    const hideLastN = currentSettings?.hideLastN || 0;
    
    if (chatLength === 0) return;
    
    if (hideLastN > 0 && hideLastN < chatLength) {
        const visibleStart = chatLength - hideLastN;
        // 先取消隐藏所有消息
        await hideChatMessageRange(0, chatLength - 1, true);
        // 然后隐藏指定范围
        await hideChatMessageRange(0, visibleStart - 1, false);
    } else if (hideLastN === 0) {
        // 取消隐藏所有消息
        await hideChatMessageRange(0, chatLength - 1, true);
    }
}

// 初始化扩展
jQuery(async () => {
    loadSettings();
    createUI();
    
    // 初始加载时更新显示
    setTimeout(() => {
        const currentSettings = getCurrentHideSettings();
        const hideLastNInput = document.getElementById('hide-last-n');
        hideLastNInput.value = currentSettings?.hideLastN || '';
        updateCurrentHideSettingsDisplay();
    }, 1000);
});
