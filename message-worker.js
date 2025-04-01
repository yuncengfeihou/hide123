// 消息处理Worker
self.onmessage = function(e) {
    const { chat, hideLastN, currentCache } = e.data;
    const chatLength = chat.length;
    
    // 开始计时
    const startTime = performance.now();
    
    // 计算分界点
    const visibleStart = chatLength - hideLastN;
    
    // 使用位图算法计算期望状态
    const expectedStates = new Array(chatLength);
    for (let i = 0; i < chatLength; i++) {
        expectedStates[i] = i < visibleStart; // 前面的消息应该隐藏
    }
    
    // 检测手动修改
    let manualChanges = [];
    if (currentCache && currentCache.messageStates && 
        currentCache.messageStates.length === chatLength && 
        currentCache.lastHideN === hideLastN) {
        
        for (let i = 0; i < chatLength; i++) {
            const currentState = chat[i].is_system;
            // 如果当前状态与上次缓存不一致，可能是手动修改
            if (currentState !== currentCache.messageStates[i]) {
                manualChanges.push({
                    index: i,
                    state: currentState
                });
            }
        }
    }
    
    // 保留手动修改
    for (const change of manualChanges) {
        expectedStates[change.index] = change.state;
    }
    
    // 找出需要变更的消息
    const toChange = [];
    for (let i = 0; i < chatLength; i++) {
        const currentState = !!chat[i].is_system;
        if (currentState !== expectedStates[i]) {
            toChange.push({
                index: i,
                hide: expectedStates[i]
            });
        }
    }
    
    // 计算执行时间
    const endTime = performance.now();
    const computeTime = endTime - startTime;
    
    // 返回计算结果和新的缓存状态
    self.postMessage({
        toChange,
        newCache: {
            lastHideN: hideLastN,
            chatLength: chatLength,
            messageStates: expectedStates
        },
        computeTime,
        manualChangesCount: manualChanges.length
    });
};
