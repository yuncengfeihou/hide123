import { getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";
// 注意：saveChatDebounced 通常由 getContext().saveChatDebounced 访问，如果需要直接导入，请确认路径
// import { saveChatDebounced } from "../../../../script.js";

const extensionName = "hide-helper"; // 用于在 chat_metadata 中存储设置的键名

// --- Helper Functions ---

/**
 * 从当前聊天元数据加载设置，如果不存在则使用默认值
 * @returns {object} 加载的设置对象 { hideLastN, lastProcessedLength }
 */
function loadCharacterSettings() {
    const context = getContext();
    const chatMetadata = context.chatMetadata || {};
    const defaultSettings = { hideLastN: 0, lastProcessedLength: 0 };

    let settings = chatMetadata[extensionName];

    if (!settings || typeof settings !== 'object') {
        console.log(`[${extensionName}] No settings found for this chat, using defaults.`);
        settings = { ...defaultSettings };
        // 将默认设置写入元数据，但不立即保存，等待后续操作触发保存
        context.updateChatMetadata({ [extensionName]: settings });
    } else {
        // 确保所有必需的键都存在
        settings = { ...defaultSettings, ...settings };
    }

    // 更新 UI 输入框的值
    const hideLastNInput = document.getElementById('hide-last-n');
    if (hideLastNInput) {
        hideLastNInput.value = settings.hideLastN || 0;
    }

    console.log(`[${extensionName}] Loaded settings:`, settings);
    return settings;
}

/**
 * 将设置保存到当前聊天元数据中
 * 注意：这只更新内存中的元数据，需要后续调用 context.saveChatDebounced() 或类似机制来持久化
 * @param {object} settings 要保存的设置对象 { hideLastN, lastProcessedLength }
 */
function saveCharacterSettings(settings) {
    const context = getContext();
    // 只更新内存中的 chatMetadata
    context.updateChatMetadata({ [extensionName]: settings });
    console.log(`[${extensionName}] Updated settings in metadata (pending save):`, settings);
    // 持久化将在 runFullHideCheck 或 runIncrementalHideCheck 修改 chat 后调用 saveChatDebounced 时发生
    // 或者可以通过 context.saveMetadata() (如果可用且合适)
}


// --- Core Logic Functions ---

/**
 * 增量隐藏检查 (用于新消息到达)
 * 仅处理从上次处理长度到现在新增的、需要隐藏的消息
 */
function runIncrementalHideCheck() {
    const context = getContext();
    const chat = context.chat;
    const currentChatLength = chat?.length || 0;
    const settings = loadCharacterSettings(); // 获取当前设置和上次处理长度
    const { hideLastN, lastProcessedLength } = settings;

    // --- 前置条件检查 ---
    if (currentChatLength === 0 || hideLastN <= 0) {
        // 如果 N=0 或无消息，增量无意义。但如果长度变长了，需要更新 lastProcessedLength
        if (currentChatLength > lastProcessedLength) {
            settings.lastProcessedLength = currentChatLength;
            saveCharacterSettings(settings); // 保存更新后的长度
        }
        console.log(`[${extensionName}] Incremental check skipped: No chat, hideLastN<=0.`);
        return;
    }

    if (currentChatLength <= lastProcessedLength) {
        // 长度未增加或减少，说明可能发生删除或其他异常，应由 Full Check 处理
        console.log(`[${extensionName}] Incremental check skipped: Chat length did not increase (${lastProcessedLength} -> ${currentChatLength}). Might be a delete.`);
        // 这里不主动调用 Full Check，依赖 MESSAGE_DELETED 事件或下次 CHAT_CHANGED 处理
        return;
    }

    // --- 计算范围 ---
    const targetVisibleStart = currentChatLength - hideLastN;
    const previousVisibleStart = lastProcessedLength > 0 ? lastProcessedLength - hideLastN : 0; // 处理首次的情况

    // 必须目标 > 先前才有新增隐藏
    if (targetVisibleStart > previousVisibleStart && previousVisibleStart >= 0) {
        const toHideIncrementally = [];
        const startIndex = Math.max(0, previousVisibleStart); // 确保不为负
        const endIndex = Math.min(currentChatLength, targetVisibleStart); // 确保不超过当前长度

        // --- 收集需要隐藏的消息 ---
        for (let i = startIndex; i < endIndex; i++) {
            // 确保消息存在，当前是可见的，且不是用户消息 (通常不隐藏用户消息)
            if (chat[i] && chat[i].is_system === false && !chat[i].is_user) {
                toHideIncrementally.push(i);
            }
        }

        // --- 执行批量更新 ---
        if (toHideIncrementally.length > 0) {
            console.log(`[${extensionName}] Incrementally hiding messages: ${toHideIncrementally.join(', ')}`);

            // 1. 批量更新数据 (chat 数组)
            toHideIncrementally.forEach(idx => {
                if (chat[idx]) chat[idx].is_system = true;
            });

            // 2. 批量更新 DOM
            try {
                const hideSelector = toHideIncrementally.map(id => `.mes[mesid="${id}"]`).join(',');
                if (hideSelector) {
                    $(hideSelector).attr('is_system', 'true');
                }
            } catch (error) {
                console.error(`[${extensionName}] Error updating DOM incrementally:`, error);
            }


            // 3. 保存 Chat (包含 is_system 的修改)
            context.saveChatDebounced?.(); // 调用上下文提供的防抖保存函数
        } else {
             console.log(`[${extensionName}] Incremental check: No messages needed hiding in the new range [${startIndex}, ${endIndex}).`);
        }
    } else {
         console.log(`[${extensionName}] Incremental check: Visible start did not advance or range invalid.`);
    }

    // --- 更新处理长度并保存设置 ---
    settings.lastProcessedLength = currentChatLength;
    saveCharacterSettings(settings);
}


/**
 * 全量隐藏检查 (优化的差异更新)
 * 用于加载、切换、删除、设置更改等情况
 */
function runFullHideCheck() {
    console.log(`[${extensionName}] Running optimized full hide check.`);
    const context = getContext();
    const chat = context.chat;
    const currentChatLength = chat?.length || 0;

    // 加载当前角色的设置，如果 chat 不存在则无法继续
    const settings = loadCharacterSettings();
    if (!chat) {
        console.warn(`[${extensionName}] Full check aborted: Chat data not available.`);
        // 重置处理长度可能不安全，因为不知道状态
        return;
    }
    const { hideLastN } = settings;


    // 1. 优化初始检查 (N=0 或 N >= length -> 全部可见)
    if (hideLastN <= 0 || hideLastN >= currentChatLength) {
        const needsToShowAny = chat.some(msg => msg && msg.is_system === true && !msg.is_user);
        if (!needsToShowAny) {
            console.log(`[${extensionName}] Full check (N=${hideLastN}): No messages are hidden or all should be visible, skipping.`);
            settings.lastProcessedLength = currentChatLength; // 即使跳过也要更新长度
            saveCharacterSettings(settings);
            return; // 无需操作
        }
        // 如果需要显示，则继续执行下面的逻辑，visibleStart 会是 0
    }

    // 2. 计算可见边界
    const visibleStart = (hideLastN > 0 && hideLastN < currentChatLength) ? currentChatLength - hideLastN : 0; // N<=0 或 N>=lengh 都从0开始可见

    // 3. 差异计算 (结合跳跃扫描)
    const toHide = [];
    const toShow = [];
    const SKIP_STEP = 10; // 跳跃扫描步长

    // 检查需要隐藏的部分 (0 to visibleStart - 1)
    for (let i = 0; i < visibleStart; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const isCurrentlyHidden = msg.is_system === true;

        if (!isCurrentlyHidden && !msg.is_user) {
            toHide.push(i);
        } else if (isCurrentlyHidden) {
            // 跳跃扫描逻辑
            let lookAhead = 1;
            const maxLookAhead = Math.min(visibleStart, i + SKIP_STEP); // 检查未来步长或到边界
            while (i + lookAhead < maxLookAhead) {
                 const nextMsg = chat[i + lookAhead];
                 const nextIsHidden = nextMsg && nextMsg.is_system === true;
                 if (!nextIsHidden) break; // 遇到非隐藏的，停止跳跃
                 lookAhead++;
            }
            if (lookAhead > 1) {
                 i += (lookAhead - 1); // 跳过检查过的 hidden 消息
            }
        }
    }
    // 检查需要显示的部分 (visibleStart to currentChatLength - 1)
     for (let i = visibleStart; i < currentChatLength; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const isCurrentlyHidden = msg.is_system === true;

        if (isCurrentlyHidden && !msg.is_user) {
            toShow.push(i);
        } else if (!isCurrentlyHidden) {
             // 跳跃扫描逻辑 (检查 is_system === false)
             let lookAhead = 1;
             const maxLookAhead = Math.min(currentChatLength, i + SKIP_STEP);
             while (i + lookAhead < maxLookAhead) {
                  const nextMsg = chat[i + lookAhead];
                  const nextIsVisible = nextMsg && nextMsg.is_system === false;
                  if (!nextIsVisible) break;
                  lookAhead++;
             }
             if (lookAhead > 1) {
                  i += (lookAhead - 1);
             }
        }
    }

    // 4. 批量处理 (Data & DOM)
    let changed = false;
    // --- 更新数据 ---
    if (toHide.length > 0) {
        changed = true;
        toHide.forEach(idx => { if (chat[idx]) chat[idx].is_system = true; });
    }
    if (toShow.length > 0) {
        changed = true;
        toShow.forEach(idx => { if (chat[idx]) chat[idx].is_system = false; });
    }

    // --- 更新 DOM ---
    try {
        if (toHide.length > 0) {
            const hideSelector = toHide.map(id => `.mes[mesid="${id}"]`).join(',');
            if (hideSelector) $(hideSelector).attr('is_system', 'true');
        }
        if (toShow.length > 0) {
            const showSelector = toShow.map(id => `.mes[mesid="${id}"]`).join(',');
             if (showSelector) $(showSelector).attr('is_system', 'false');
        }
    } catch (error) {
        console.error(`[${extensionName}] Error updating DOM in full check:`, error);
    }


    // 5. 后续处理
    if (changed) {
         console.log(`[${extensionName}] Optimized Full check: Hiding ${toHide.length}, Showing ${toShow.length}`);
         // 保存 Chat (包含 is_system 的修改)
         context.saveChatDebounced?.();
    } else {
         console.log(`[${extensionName}] Optimized Full check: No changes needed.`);
    }

    // 更新处理长度并保存设置
    settings.lastProcessedLength = currentChatLength;
    saveCharacterSettings(settings);
}


// --- UI and Event Listeners ---

// Create UI panel
function createUI() {
    // 确保只添加一次
    if (document.getElementById('hide-helper-panel')) return;

    const hideHelperPanel = document.createElement('div');
    hideHelperPanel.id = 'hide-helper-panel';
    // 移除了 hide-apply-btn
    hideHelperPanel.innerHTML = `
        <h4>隐藏助手 (Hide Helper)</h4>
        <div class="hide-helper-section">
            <label for="hide-last-n">保留最新楼层数:</label>
            <input type="number" id="hide-last-n" min="0" placeholder="0 表示全部保留" style="width: 80px; margin-left: 5px; margin-right: 10px;">
        </div>
        <button class="menu_button" id="hide-save-settings-btn" title="保存设置并立即应用规则">保存当前设置</button>
        <div style="font-size: small; margin-top: 5px; color: grey;">输入数字 N，将只保留最新的 N 条消息，之前的消息将被隐藏。0 表示不隐藏。</div>
    `;
    // 将面板添加到扩展设置区域
    const extensionsSettingsDiv = document.getElementById('extensions_settings');
    if (extensionsSettingsDiv) {
        extensionsSettingsDiv.appendChild(hideHelperPanel);
    } else {
        console.error(`[${extensionName}] Could not find #extensions_settings element to append UI.`);
        // 作为后备，添加到 body，但这可能不是理想的位置
        // document.body.appendChild(hideHelperPanel);
    }
}

// Setup event listeners for UI elements and application events
function setupEventListeners() {
    const hideLastNInput = document.getElementById('hide-last-n');
    const saveSettingsBtn = document.getElementById('hide-save-settings-btn');

    if (!hideLastNInput || !saveSettingsBtn) {
        console.error(`[${extensionName}] UI elements not found, cannot setup listeners.`);
        return;
    }

    // 输入框 'change' 事件 (当值改变且失去焦点时触发)
    hideLastNInput.addEventListener('change', () => {
        const value = parseInt(hideLastNInput.value);
        if (isNaN(value) || value < 0) {
             console.warn(`[${extensionName}] Invalid input value, resetting to 0.`);
             hideLastNInput.value = 0; // 重置为有效值
        }
        const currentValue = parseInt(hideLastNInput.value) || 0;
        const settings = loadCharacterSettings(); // 加载当前设置以比较

        if (settings.hideLastN !== currentValue) {
            console.log(`[${extensionName}] hideLastN changed via input: ${settings.hideLastN} -> ${currentValue}`);
            settings.hideLastN = currentValue;
            // 不需要立即执行 Full Check，由保存按钮触发
            // runFullHideCheck(); // 不在这里触发，避免输入过程中执行
            saveCharacterSettings(settings); // 只更新内存中的值
        }
    });

    // 保存设置按钮
    saveSettingsBtn.addEventListener('click', () => {
        console.log(`[${extensionName}] Save settings button clicked.`);
        const value = parseInt(hideLastNInput.value);
         if (isNaN(value) || value < 0) {
             toastr.error("请输入有效的保留楼层数 (大于等于0的整数)");
             return;
         }
        const currentValue = parseInt(hideLastNInput.value) || 0;
        const settings = loadCharacterSettings();
        settings.hideLastN = currentValue; // 确保保存的是最新的 UI 值
        saveCharacterSettings(settings); // 保存 hideLastN 和可能的 lastProcessedLength
        runFullHideCheck(); // 执行全量检查并应用规则
        toastr.success('隐藏设置已保存并应用');
    });

    // --- Application Event Listeners ---

    // 新消息到达 (主要优化点) - 使用增量检查
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        // 添加一个小的延迟/防抖可能更好，但通常不必要
        setTimeout(runIncrementalHideCheck, 50); // 短暂延迟，确保消息渲染后执行
    });

    // 消息删除 - 必须用完整检查
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        console.log(`[${extensionName}] Event ${event_types.MESSAGE_DELETED} received. Running full check.`);
        // 短暂延迟防抖，防止快速连续删除触发多次
        setTimeout(runFullHideCheck, 200);
    });

    // 聊天切换 - 必须用完整检查，并重新加载设置
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log(`[${extensionName}] Event ${event_types.CHAT_CHANGED} received. Reloading settings and running full check.`);
        // 确保在 Full Check 之前加载新聊天的设置
        loadCharacterSettings();
        // 不需要手动重置 lastProcessedLength，因为 loadCharacterSettings 会加载新聊天的值
        setTimeout(runFullHideCheck, 200); // 延迟确保新聊天数据加载完成
    });
}

// --- Extension Initialization ---
jQuery(async () => {
    console.log(`[${extensionName}] Initializing...`);
    createUI();
    setupEventListeners();

    // 初始加载时，等待 CHAT_CHANGED 事件来首次加载设置和运行检查
    // 因为 CHAT_CHANGED 在应用启动加载第一个聊天时也会触发
    // 不需要在这里直接调用 runFullHideCheck，让 CHAT_CHANGED 处理首次加载
    console.log(`[${extensionName}] Initialization complete. Waiting for CHAT_CHANGED event.`);
});
