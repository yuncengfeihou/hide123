import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { getContext } from "../../../extensions.js";
import { hideChatMessageRange } from "../../../chats.js";

const extensionName = "hide-helper";
const defaultSettings = {
    hideLastN: 0,
    lastAppliedSettings: null,
    enablePerformanceMonitoring: false
};

// Worker实例和缓存状态
let messageWorker = null;
let stateCache = {
    lastHideN: -1,
    chatLength: -1,
    messageStates: []
};

// 性能监控数据
let performanceStats = {
    lastRunTime: 0,
    averageRunTime: 0,
    runCount: 0,
    lastChangeCount: 0
};

// 初始化插件设置
function loadSettings() {
    // 确保插件设置存在
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    
    // 填充默认值
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    // 确保所有必要设置都存在
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    
    // 初始化界面
    updateUI();
}

// 更新界面元素以反映当前设置
function updateUI() {
    const hideLastNInput = document.getElementById('hide-last-n');
    if (hideLastNInput) {
        hideLastNInput.value = extension_settings[extensionName].hideLastN || '';
    }
    
    const perfToggle = document.getElementById('enable-perf-monitoring');
    if (perfToggle) {
        perfToggle.checked = !!extension_settings[extensionName].enablePerformanceMonitoring;
    }
    
    // 更新性能面板可见性
    const perfPanel = document.getElementById('hide-helper-performance');
    if (perfPanel) {
        perfPanel.style.display = extension_settings[extensionName].enablePerformanceMonitoring ? 'block' : 'none';
    }
}

// 创建插件UI
function createUI() {
    const hideHelperPanel = document.createElement('div');
    hideHelperPanel.id = 'hide-helper-panel';
    hideHelperPanel.className = 'hide-helper-container';
    hideHelperPanel.innerHTML = `
        <div class="hide-helper-header">隐藏助手</div>
        <div class="hide-helper-section">
            <label for="hide-last-n">隐藏除了最新的N层之外的所有消息:</label>
            <div class="hide-helper-input-row">
                <input type="number" id="hide-last-n" min="0" placeholder="例如: 20">
                <button id="hide-apply-btn" class="hide-helper-btn">应用</button>
            </div>
            <div class="hide-helper-actions">
                <button id="unhide-all-btn" class="hide-helper-btn">显示全部</button>
                <button id="hide-save-settings-btn" class="hide-helper-btn success">保存设置</button>
            </div>
            <div class="hide-helper-checkbox-row">
                <input type="checkbox" id="enable-perf-monitoring">
                <label for="enable-perf-monitoring">启用性能监控</label>
            </div>
        </div>
    `;
    
    document.body.appendChild(hideHelperPanel);
    
    // 创建性能监控面板
    addPerformancePanel();
    
    // 设置事件监听器
    setupUIEventListeners();
}

// 设置UI元素的事件监听器
function setupUIEventListeners() {
    // 应用按钮
    const applyBtn = document.getElementById('hide-apply-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            const hideLastNInput = document.getElementById('hide-last-n');
            const value = parseInt(hideLastNInput.value) || 0;
            extension_settings[extensionName].hideLastN = value;
            applyHideSettings();
        });
    }
    
    // 显示全部按钮
    const unhideAllBtn = document.getElementById('unhide-all-btn');
    if (unhideAllBtn) {
        unhideAllBtn.addEventListener('click', () => {
            extension_settings[extensionName].hideLastN = 0;
            document.getElementById('hide-last-n').value = '0';
            applyHideSettings();
        });
    }
    
    // 保存设置按钮
    const saveBtn = document.getElementById('hide-save-settings-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveCurrentSettings);
    }
    
    // 性能监控复选框
    const perfToggle = document.getElementById('enable-perf-monitoring');
    if (perfToggle) {
        perfToggle.addEventListener('change', function() {
            extension_settings[extensionName].enablePerformanceMonitoring = this.checked;
            updateUI();
            saveSettingsDebounced();
        });
    }
}

// 初始化Web Worker
function initWorker() {
    if (window.Worker) {
        // 终止旧Worker（如果存在）
        if (messageWorker) {
            messageWorker.terminate();
        }
        
        try {
            messageWorker = new Worker(`scripts/extensions/third-party/${extensionName}/message-worker.js`);
            console.log('隐藏助手: Web Worker初始化成功');
        } catch (error) {
            console.error('隐藏助手: Web Worker初始化失败', error);
            messageWorker = null;
        }
    } else {
        console.warn('隐藏助手: 此浏览器不支持Web Workers');
    }
}

// 应用隐藏设置（主函数）
async function applyHideSettings() {
    const context = getContext();
    const chat = context.chat;
    const chatLength = chat?.length || 0;
    
    if (chatLength === 0) {
        toastr.warning('没有消息可以隐藏');
        return;
    }
    
    const startTime = performance.now();
    const hideLastN = extension_settings[extensionName].hideLastN || 0;
    
    // 处理全部显示的特殊情况
    if (hideLastN === 0) {
        const allUnhideStartTime = performance.now();
        await hideChatMessageRange(0, chatLength - 1, true);
        const allUnhideEndTime = performance.now();
        
        // 更新统计数据
        performanceStats.lastRunTime = allUnhideEndTime - allUnhideStartTime;
        performanceStats.lastChangeCount = chatLength;
        updatePerformanceStats(performanceStats.lastRunTime);
        
        // 更新缓存
        stateCache = {
            lastHideN: 0,
            chatLength: chatLength,
            messageStates: new Array(chatLength).fill(false)
        };
        
        extension_settings[extensionName].lastAppliedSettings = null;
        saveSettingsDebounced();
        
        // 更新性能监控
        if (extension_settings[extensionName].enablePerformanceMonitoring) {
            updatePerfPanel(performanceStats.lastRunTime, chatLength, chatLength);
        }
        
        toastr.success('所有消息已设为可见');
        return;
    }
    
    // 验证hideLastN是否合理
    if (hideLastN < 0 || hideLastN >= chatLength) {
        toastr.error(`无效的值: ${hideLastN}. 应在 0 到 ${chatLength-1} 之间`);
        return;
    }
    
    // 使用Worker处理（如果可用）
    if (messageWorker && hideLastN > 0 && hideLastN < chatLength) {
        try {
            // Worker计算开始
            const workerStartTime = performance.now();
            
            // 使用Promise包装Worker通信
            const result = await new Promise((resolve, reject) => {
                // 设置超时保护
                const timeoutId = setTimeout(() => {
                    reject(new Error('Worker处理超时'));
                }, 2000);
                
                // 监听Worker消息
                messageWorker.onmessage = function(e) {
                    clearTimeout(timeoutId);
                    resolve(e.data);
                };
                
                // 监听Worker错误
                messageWorker.onerror = function(error) {
                    clearTimeout(timeoutId);
                    reject(error);
                };
                
                // 发送数据到Worker
                messageWorker.postMessage({
                    chat: chat.map(msg => ({ is_system: !!msg.is_system })), // 只发送必要数据
                    hideLastN,
                    currentCache: stateCache
                });
            });
            
            // 处理Worker结果
            const { toChange, newCache, computeTime, manualChangesCount } = result;
            
            // 更新性能统计
            performanceStats.lastRunTime = performance.now() - workerStartTime;
            performanceStats.lastChangeCount = toChange.length;
            updatePerformanceStats(performanceStats.lastRunTime);
            
            // 更新缓存
            stateCache = newCache;
            
            // 批量更新数据模型和DOM
            if (toChange.length > 0) {
                // 更新数据模型
                for (const item of toChange) {
                    if (chat[item.index]) {
                        chat[item.index].is_system = item.hide;
                    }
                }
                
                // 批量更新DOM
                await new Promise(resolve => {
                    requestAnimationFrame(() => {
                        for (const item of toChange) {
                            const messageBlock = $(`.mes[mesid="${item.index}"]`);
                            if (messageBlock.length) {
                                messageBlock.attr('is_system', String(item.hide));
                            }
                        }
                        resolve();
                    });
                });
            }
            
            // 保存设置
            extension_settings[extensionName].lastAppliedSettings = {
                type: 'lastN',
                value: hideLastN
            };
            saveSettingsDebounced();
            
            // 更新性能面板
            if (extension_settings[extensionName].enablePerformanceMonitoring) {
                updatePerfPanel(performanceStats.lastRunTime, chatLength, toChange.length);
            }
            
            const endTime = performance.now();
            console.log(`隐藏助手: 处理 ${chatLength} 条消息，变更 ${toChange.length} 条，耗时 ${(endTime - startTime).toFixed(2)}ms (计算: ${computeTime.toFixed(2)}ms)`);
            
            // 显示成功消息
            if (toChange.length > 0) {
                toastr.success(`已隐藏 ${toChange.filter(i => i.hide).length} 条消息，显示 ${toChange.filter(i => !i.hide).length} 条消息`);
            } else {
                toastr.info('消息状态已经符合设置，无需更改');
            }
            
            return;
        } catch (error) {
            console.error('Worker处理失败，回退到同步处理:', error);
            toastr.warning('快速处理失败，使用标准处理...');
            // 继续使用同步处理作为回退
        }
    }
    
    // 同步处理（Worker不可用或失败时）
    console.time('同步处理');
    const syncStartTime = performance.now();
    
    try {
        if (hideLastN > 0 && hideLastN < chatLength) {
            const visibleStart = chatLength - hideLastN;
            
            // 计算需要隐藏和显示的范围
            await hideChatMessageRange(0, visibleStart - 1, false); // 隐藏前面的消息
            await hideChatMessageRange(visibleStart, chatLength - 1, true); // 显示后面的消息
            
            // 更新缓存
            stateCache = {
                lastHideN: hideLastN,
                chatLength: chatLength,
                messageStates: chat.map(msg => !!msg.is_system)
            };
            
            extension_settings[extensionName].lastAppliedSettings = {
                type: 'lastN',
                value: hideLastN
            };
            saveSettingsDebounced();
            
            const syncEndTime = performance.now();
            const syncTime = syncEndTime - syncStartTime;
            
            // 更新性能统计
            performanceStats.lastRunTime = syncTime;
            performanceStats.lastChangeCount = chatLength; // 同步模式下无法精确计算，使用总数
            updatePerformanceStats(syncTime);
            
            // 更新性能面板
            if (extension_settings[extensionName].enablePerformanceMonitoring) {
                updatePerfPanel(syncTime, chatLength, chatLength);
            }
            
            console.log(`隐藏助手(同步): 处理完成，耗时 ${syncTime.toFixed(2)}ms`);
            toastr.success(`已保留最新的 ${hideLastN} 条消息，隐藏其余消息`);
        }
    } catch (error) {
        console.error('同步处理出错:', error);
        toastr.error('处理失败: ' + error.message);
    }
    
    console.timeEnd('同步处理');
}

// 保存当前设置为默认值
function saveCurrentSettings() {
    extension_settings[extensionName].lastAppliedSettings = {
        type: 'lastN',
        value: extension_settings[extensionName].hideLastN || 0
    };
    saveSettingsDebounced();
    toastr.success('隐藏设置已保存');
}

// 应用上次保存的设置
async function applyLastSettings() {
    const lastSettings = extension_settings[extensionName].lastAppliedSettings;
    
    if (!lastSettings) return;
    
    if (lastSettings.type === 'lastN') {
        extension_settings[extensionName].hideLastN = lastSettings.value;
        updateUI();
        await applyHideSettings();
    }
}

// 更新性能统计
function updatePerformanceStats(runTime) {
    performanceStats.runCount++;
    performanceStats.averageRunTime = 
        ((performanceStats.averageRunTime * (performanceStats.runCount - 1)) + runTime) / 
        performanceStats.runCount;
}

// 添加性能监控面板
function addPerformancePanel() {
    const panel = document.createElement('div');
    panel.id = 'hide-helper-performance';
    panel.className = 'hide-helper-perf-panel';
    panel.innerHTML = `
        <div class="hide-helper-perf-header">隐藏助手性能</div>
        <div class="hide-helper-perf-row">处理时间: <span id="hide-helper-perf-time">0</span>ms</div>
        <div class="hide-helper-perf-row">消息总数: <span id="hide-helper-msg-count">0</span></div>
        <div class="hide-helper-perf-row">变更数量: <span id="hide-helper-change-count">0</span></div>
        <div class="hide-helper-perf-row">平均处理: <span id="hide-helper-avg-time">0</span>ms</div>
    `;
    document.body.appendChild(panel);
    
    // 默认隐藏
    panel.style.display = 'none';
}

// 更新性能面板数据
function updatePerfPanel(time, msgCount, changeCount) {
    document.getElementById('hide-helper-perf-time').textContent = time.toFixed(2);
    document.getElementById('hide-helper-msg-count').textContent = msgCount;
    document.getElementById('hide-helper-change-count').textContent = changeCount;
    document.getElementById('hide-helper-avg-time').textContent = performanceStats.averageRunTime.toFixed(2);
}

// 设置应用事件监听器
function setupEventListeners() {
    // 聊天切换事件
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // 重置缓存
        stateCache = {
            lastHideN: -1,
            chatLength: -1,
            messageStates: []
        };
        
        // 如果有上次设置，延迟应用
        if (extension_settings[extensionName].lastAppliedSettings) {
            setTimeout(applyLastSettings, 500);
        }
    });
    
    // 消息更新事件
    eventSource.on(event_types.MESSAGE_UPDATED, () => {
        // 下次应用时会重新计算
    });
    
    // 新消息接收事件
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        // 如果有应用的设置，检查是否需要重新应用
        if (extension_settings[extensionName].lastAppliedSettings) {
            // 获取当前chat长度
            const context = getContext();
            const chat = context.chat;
            const chatLength = chat?.length || 0;
            
            // 如果长度变了，重新应用设置
            if (chatLength !== stateCache.chatLength) {
                // 短暂延迟确保DOM已更新
                setTimeout(applyLastSettings, 100);
            }
        }
    });
    
    // 加载更多消息事件
    eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
        // 如果有上次设置，延迟应用
        if (extension_settings[extensionName].lastAppliedSettings) {
            setTimeout(applyLastSettings, 500);
        }
    });
}

// 插件初始化
jQuery(async () => {
    // 加载设置
    loadSettings();
    
    // 创建UI和性能面板
    createUI();
    
    // 初始化Worker
    initWorker();
    
    // 设置事件监听器
    setupEventListeners();
    setupUIEventListeners();
    
    // 应用上次保存的设置
    if (extension_settings[extensionName].lastAppliedSettings) {
        // 延迟应用，等待聊天完全加载
        setTimeout(applyLastSettings, 1000);
    }
    
    console.log('隐藏助手: 插件初始化完成');
});
